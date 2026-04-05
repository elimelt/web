"""Sync job database operations."""

from datetime import UTC, datetime
from typing import Any

from api.db.core import _get_connection


async def sync_job_create(commit_sha: str | None, file_paths: list[str]) -> int:
    """Create a new sync job with pending items."""
    async with _get_connection(autocommit=False) as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                INSERT INTO notes_sync_jobs (status, commit_sha, total_items)
                VALUES ('pending', %s, %s)
                RETURNING id
                """,
                (commit_sha, len(file_paths)),
            )
            row = await cur.fetchone()
            job_id = row[0]

            if file_paths:
                await cur.executemany(
                    "INSERT INTO notes_sync_job_items (job_id, file_path) VALUES (%s, %s)",
                    [(job_id, path) for path in file_paths],
                )

            await conn.commit()
            return job_id


async def sync_job_get(job_id: int) -> dict[str, Any] | None:
    """Get a sync job by ID with item counts."""
    async with _get_connection() as conn:
        row = await (
            await conn.execute(
                """
            SELECT id, status, commit_sha, total_items, completed_items, failed_items,
                   created_at, started_at, completed_at, error_message, rate_limit_reset_at,
                   last_activity_at
            FROM notes_sync_jobs WHERE id = %s
            """,
                (job_id,),
            )
        ).fetchone()
        if not row:
            return None
        return {
            "id": row[0],
            "status": row[1],
            "commit_sha": row[2],
            "total_items": row[3],
            "completed_items": row[4],
            "failed_items": row[5],
            "created_at": row[6].astimezone(UTC).isoformat() if row[6] else None,
            "started_at": row[7].astimezone(UTC).isoformat() if row[7] else None,
            "completed_at": row[8].astimezone(UTC).isoformat() if row[8] else None,
            "error_message": row[9],
            "rate_limit_reset_at": row[10].astimezone(UTC).isoformat() if row[10] else None,
            "last_activity_at": row[11].astimezone(UTC).isoformat() if row[11] else None,
        }


async def sync_job_list(limit: int = 20, status: str | None = None) -> list[dict[str, Any]]:
    """List sync jobs, optionally filtered by status."""
    async with _get_connection() as conn:
        if status:
            rows = await conn.execute(
                "SELECT id, status, commit_sha, total_items, completed_items, failed_items, created_at, completed_at FROM notes_sync_jobs WHERE status = %s ORDER BY created_at DESC LIMIT %s",
                (status, limit),
            )
        else:
            rows = await conn.execute(
                "SELECT id, status, commit_sha, total_items, completed_items, failed_items, created_at, completed_at FROM notes_sync_jobs ORDER BY created_at DESC LIMIT %s",
                (limit,),
            )
        result = []
        async for row in rows:
            result.append(
                {
                    "id": row[0],
                    "status": row[1],
                    "commit_sha": row[2],
                    "total_items": row[3],
                    "completed_items": row[4],
                    "failed_items": row[5],
                    "created_at": row[6].astimezone(UTC).isoformat() if row[6] else None,
                    "completed_at": row[7].astimezone(UTC).isoformat() if row[7] else None,
                }
            )
        return result


async def sync_job_update_status(
    job_id: int,
    status: str,
    error_message: str | None = None,
    rate_limit_reset_at: datetime | None = None,
) -> None:
    """Update the status of a sync job."""
    async with _get_connection() as conn:
        now = datetime.now(UTC)
        if status == "running":
            await conn.execute(
                "UPDATE notes_sync_jobs SET status = %s, started_at = %s, last_activity_at = %s WHERE id = %s",
                (status, now, now, job_id),
            )
        elif status in ("completed", "failed"):
            await conn.execute(
                "UPDATE notes_sync_jobs SET status = %s, completed_at = %s, error_message = %s, last_activity_at = %s WHERE id = %s",
                (status, now, error_message, now, job_id),
            )
        elif status == "paused":
            await conn.execute(
                "UPDATE notes_sync_jobs SET status = %s, rate_limit_reset_at = %s, last_activity_at = %s WHERE id = %s",
                (status, rate_limit_reset_at, now, job_id),
            )
        else:
            await conn.execute(
                "UPDATE notes_sync_jobs SET status = %s, last_activity_at = %s WHERE id = %s",
                (status, now, job_id),
            )


async def sync_job_update_counts(job_id: int) -> None:
    """Update the completed/failed counts for a job from its items."""
    async with _get_connection() as conn:
        await conn.execute(
            """
            UPDATE notes_sync_jobs SET
                completed_items = (SELECT COUNT(*) FROM notes_sync_job_items WHERE job_id = %s AND status = 'success'),
                failed_items = (SELECT COUNT(*) FROM notes_sync_job_items WHERE job_id = %s AND status = 'failed'),
                last_activity_at = NOW()
            WHERE id = %s
            """,
            (job_id, job_id, job_id),
        )


async def sync_job_get_pending_items(job_id: int, limit: int = 50) -> list[dict[str, Any]]:
    """Get pending items for a sync job."""
    async with _get_connection() as conn:
        rows = await conn.execute(
            "SELECT id, file_path, retry_count FROM notes_sync_job_items WHERE job_id = %s AND status = 'pending' ORDER BY id LIMIT %s",
            (job_id, limit),
        )
        return [{"id": row[0], "file_path": row[1], "retry_count": row[2]} async for row in rows]


async def sync_job_get_failed_items(job_id: int) -> list[dict[str, Any]]:
    """Get failed items for a sync job (for retry)."""
    async with _get_connection() as conn:
        rows = await conn.execute(
            "SELECT id, file_path, retry_count, last_error FROM notes_sync_job_items WHERE job_id = %s AND status = 'failed' ORDER BY id",
            (job_id,),
        )
        return [
            {"id": row[0], "file_path": row[1], "retry_count": row[2], "last_error": row[3]}
            async for row in rows
        ]


async def sync_job_item_update(
    item_id: int,
    status: str,
    error: str | None = None,
) -> None:
    """Update the status of a sync job item."""
    async with _get_connection() as conn:
        now = datetime.now(UTC)
        if status == "success":
            await conn.execute(
                "UPDATE notes_sync_job_items SET status = %s, completed_at = %s, last_attempt_at = %s WHERE id = %s",
                (status, now, now, item_id),
            )
        elif status == "failed":
            await conn.execute(
                "UPDATE notes_sync_job_items SET status = %s, last_error = %s, last_attempt_at = %s, retry_count = retry_count + 1 WHERE id = %s",
                (status, error, now, item_id),
            )
        else:
            await conn.execute(
                "UPDATE notes_sync_job_items SET status = %s, last_attempt_at = %s WHERE id = %s",
                (status, now, item_id),
            )


async def sync_job_reset_failed_items(job_id: int, max_retries: int = 5) -> int:
    """Reset failed items to pending for retry (up to max_retries)."""
    async with _get_connection() as conn:
        result = await conn.execute(
            "UPDATE notes_sync_job_items SET status = 'pending' WHERE job_id = %s AND status = 'failed' AND retry_count < %s",
            (job_id, max_retries),
        )
        return result.rowcount


async def sync_job_get_resumable() -> dict[str, Any] | None:
    """Get the most recent job that can be resumed (paused or running with pending items)."""
    async with _get_connection() as conn:
        row = await (
            await conn.execute(
                """
            SELECT j.id, j.status, j.commit_sha, j.rate_limit_reset_at
            FROM notes_sync_jobs j
            WHERE j.status IN ('paused', 'running', 'pending')
            AND EXISTS (SELECT 1 FROM notes_sync_job_items i WHERE i.job_id = j.id AND i.status = 'pending')
            ORDER BY j.created_at DESC
            LIMIT 1
            """,
            )
        ).fetchone()
        if not row:
            return None
        return {
            "id": row[0],
            "status": row[1],
            "commit_sha": row[2],
            "rate_limit_reset_at": row[3].astimezone(UTC).isoformat() if row[3] else None,
        }


async def sync_job_get_all_completed_paths(job_id: int) -> list[str]:
    """Get all successfully completed file paths for a job."""
    async with _get_connection() as conn:
        rows = await conn.execute(
            "SELECT file_path FROM notes_sync_job_items WHERE job_id = %s AND status = 'success'",
            (job_id,),
        )
        return [row[0] async for row in rows]


async def sync_job_get_skipped_count(job_id: int) -> int:
    """Get count of skipped items (exceeded max retries) for a job."""
    async with _get_connection() as conn:
        row = await (
            await conn.execute(
                "SELECT COUNT(*) FROM notes_sync_job_items WHERE job_id = %s AND status = 'skipped'",
                (job_id,),
            )
        ).fetchone()
        return row[0] if row else 0


async def sync_job_list_all_failed_items(
    limit: int = 100,
    job_id: int | None = None,
) -> list[dict[str, Any]]:
    """
    List all failed items across jobs (dead letter queue).

    Args:
        limit: Maximum number of items to return
        job_id: Optional filter by specific job

    Returns:
        List of failed items with job info
    """
    async with _get_connection() as conn:
        if job_id:
            rows = await conn.execute(
                """
                SELECT i.id, i.job_id, i.file_path, i.status, i.retry_count,
                       i.last_error, i.last_attempt_at, i.created_at,
                       j.commit_sha
                FROM notes_sync_job_items i
                JOIN notes_sync_jobs j ON j.id = i.job_id
                WHERE i.job_id = %s AND i.status IN ('failed', 'skipped')
                ORDER BY i.last_attempt_at DESC NULLS LAST
                LIMIT %s
                """,
                (job_id, limit),
            )
        else:
            rows = await conn.execute(
                """
                SELECT i.id, i.job_id, i.file_path, i.status, i.retry_count,
                       i.last_error, i.last_attempt_at, i.created_at,
                       j.commit_sha
                FROM notes_sync_job_items i
                JOIN notes_sync_jobs j ON j.id = i.job_id
                WHERE i.status IN ('failed', 'skipped')
                ORDER BY i.last_attempt_at DESC NULLS LAST
                LIMIT %s
                """,
                (limit,),
            )

        result = []
        async for row in rows:
            result.append(
                {
                    "id": row[0],
                    "job_id": row[1],
                    "file_path": row[2],
                    "status": row[3],
                    "retry_count": row[4],
                    "last_error": row[5],
                    "last_attempt_at": row[6].astimezone(UTC).isoformat() if row[6] else None,
                    "created_at": row[7].astimezone(UTC).isoformat() if row[7] else None,
                    "commit_sha": row[8],
                }
            )
        return result


async def sync_job_item_reset_to_pending(item_id: int) -> bool:
    """
    Reset a specific failed/skipped item to pending for manual retry.

    Returns:
        True if item was reset, False if not found or not in failed/skipped status
    """
    async with _get_connection() as conn:
        result = await conn.execute(
            """
            UPDATE notes_sync_job_items
            SET status = 'pending', last_error = NULL
            WHERE id = %s AND status IN ('failed', 'skipped')
            """,
            (item_id,),
        )
        return result.rowcount > 0


async def sync_job_item_skip(item_id: int, reason: str | None = None) -> bool:
    """
    Permanently skip a failed item (mark as unrecoverable).

    Args:
        item_id: The item ID to skip
        reason: Optional reason for skipping

    Returns:
        True if item was skipped, False if not found
    """
    async with _get_connection() as conn:
        error_msg = reason or "Manually skipped"
        result = await conn.execute(
            """
            UPDATE notes_sync_job_items
            SET status = 'skipped', last_error = %s, last_attempt_at = NOW()
            WHERE id = %s AND status IN ('pending', 'failed')
            """,
            (error_msg, item_id),
        )
        return result.rowcount > 0


async def sync_job_item_delete(item_id: int) -> bool:
    """
    Delete a sync job item entirely (removes from job).

    Use with caution - this removes the item from tracking entirely.
    The file won't be synced unless a new job is created.

    Returns:
        True if item was deleted, False if not found
    """
    async with _get_connection() as conn:
        result = await conn.execute(
            "DELETE FROM notes_sync_job_items WHERE id = %s",
            (item_id,),
        )
        return result.rowcount > 0


async def sync_job_reset_all_failed(job_id: int, include_skipped: bool = False) -> int:
    """
    Reset all failed items in a job to pending for retry.

    Args:
        job_id: The job ID
        include_skipped: If True, also reset skipped items

    Returns:
        Number of items reset
    """
    async with _get_connection() as conn:
        if include_skipped:
            result = await conn.execute(
                """
                UPDATE notes_sync_job_items
                SET status = 'pending', retry_count = 0, last_error = NULL
                WHERE job_id = %s AND status IN ('failed', 'skipped')
                """,
                (job_id,),
            )
        else:
            result = await conn.execute(
                """
                UPDATE notes_sync_job_items
                SET status = 'pending', retry_count = 0, last_error = NULL
                WHERE job_id = %s AND status = 'failed'
                """,
                (job_id,),
            )
        return result.rowcount
