import asyncio
import logging
import random
import re
from base64 import b64decode
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import httpx
import yaml

from api import db

logger = logging.getLogger(__name__)

GITHUB_REPO = "elimelt/notes"
CONTENT_PATH = "content"
GITHUB_API_BASE = "https://api.github.com"

MAX_RETRIES = 3
BASE_DELAY_SECONDS = 1.0
MAX_DELAY_SECONDS = 30.0
JITTER_FACTOR = 0.25

MAX_ITEM_RETRIES = 3
SKIP_ITEM_AFTER_RETRIES = 5


@dataclass
class RateLimitInfo:
    limit: int
    remaining: int
    reset_at: datetime
    used: int

    @classmethod
    def from_headers(cls, headers: httpx.Headers) -> "RateLimitInfo | None":
        try:
            limit = int(headers.get("x-ratelimit-limit", 0))
            remaining = int(headers.get("x-ratelimit-remaining", 0))
            reset_ts = int(headers.get("x-ratelimit-reset", 0))
            used = int(headers.get("x-ratelimit-used", 0))
            reset_at = (
                datetime.fromtimestamp(reset_ts, tz=UTC)
                if reset_ts
                else datetime.now(UTC)
            )
            return cls(limit=limit, remaining=remaining, reset_at=reset_at, used=used)
        except (ValueError, TypeError):
            return None

    def wait_seconds(self) -> float:
        now = datetime.now(UTC)
        if self.reset_at > now:
            return (self.reset_at - now).total_seconds() + 1.0
        return 0.0


@dataclass
class GitHubResponse:
    status_code: int
    data: Any
    rate_limit: RateLimitInfo | None
    is_rate_limited: bool = False

    @property
    def success(self) -> bool:
        return 200 <= self.status_code < 300


class GitHubClient:
    def __init__(self, token: str | None = None):
        self.token = token
        self._rate_limit: RateLimitInfo | None = None
        self._client: httpx.AsyncClient | None = None

    @property
    def headers(self) -> dict[str, str]:
        headers = {"Accept": "application/vnd.github.v3+json"}
        if self.token:
            headers["Authorization"] = f"token {self.token}"
        return headers

    async def __aenter__(self) -> "GitHubClient":
        self._client = httpx.AsyncClient(timeout=30.0)
        return self

    async def __aexit__(self, *args) -> None:
        if self._client:
            await self._client.aclose()
            self._client = None

    def _calculate_delay(self, attempt: int, rate_limit: RateLimitInfo | None) -> float:
        if rate_limit and rate_limit.remaining == 0:
            wait_time = rate_limit.wait_seconds()
            if wait_time > MAX_DELAY_SECONDS:
                logger.info(
                    f"Rate limit reset in {wait_time:.1f}s (at {rate_limit.reset_at}), capping delay to {MAX_DELAY_SECONDS}s"
                )
                return MAX_DELAY_SECONDS
            logger.info(
                f"Rate limited. Waiting {wait_time:.1f}s until reset at {rate_limit.reset_at}"
            )
            return wait_time

        base_delay = min(BASE_DELAY_SECONDS * (2**attempt), MAX_DELAY_SECONDS)
        jitter = base_delay * JITTER_FACTOR * random.random()
        return base_delay + jitter

    async def get(self, url: str, max_retries: int = MAX_RETRIES) -> GitHubResponse:
        if not self._client:
            raise RuntimeError("Client not initialized. Use async with.")

        last_error: Exception | None = None

        for attempt in range(max_retries + 1):
            try:
                if self._rate_limit and self._rate_limit.remaining == 0:
                    delay = self._rate_limit.wait_seconds()
                    if delay > MAX_DELAY_SECONDS:
                        logger.info(
                            f"Rate limit reset too far in future ({delay:.1f}s), returning rate limited"
                        )
                        return GitHubResponse(
                            status_code=403,
                            data=None,
                            rate_limit=self._rate_limit,
                            is_rate_limited=True,
                        )
                    if delay > 0:
                        logger.info(f"Pre-emptive rate limit wait: {delay:.1f}s")
                        await asyncio.sleep(delay)

                resp = await self._client.get(url, headers=self.headers)
                rate_limit = RateLimitInfo.from_headers(resp.headers)
                self._rate_limit = rate_limit

                if resp.status_code == 429:
                    delay = self._calculate_delay(attempt, rate_limit)
                    logger.warning(
                        f"Rate limited (429). Attempt {attempt + 1}/{max_retries + 1}. Waiting {delay:.1f}s"
                    )
                    if attempt < max_retries:
                        await asyncio.sleep(delay)
                        continue
                    return GitHubResponse(
                        status_code=429,
                        data=None,
                        rate_limit=rate_limit,
                        is_rate_limited=True,
                    )

                if resp.status_code == 403 and rate_limit and rate_limit.remaining == 0:
                    delay = self._calculate_delay(attempt, rate_limit)
                    logger.warning(
                        f"Rate limited (403). Attempt {attempt + 1}/{max_retries + 1}. Waiting {delay:.1f}s"
                    )
                    if attempt < max_retries:
                        await asyncio.sleep(delay)
                        continue
                    return GitHubResponse(
                        status_code=403,
                        data=None,
                        rate_limit=rate_limit,
                        is_rate_limited=True,
                    )

                if resp.status_code >= 500:
                    delay = self._calculate_delay(attempt, None)
                    logger.warning(
                        f"Server error ({resp.status_code}). Attempt {attempt + 1}/{max_retries + 1}. Waiting {delay:.1f}s"
                    )
                    if attempt < max_retries:
                        await asyncio.sleep(delay)
                        continue

                try:
                    data = resp.json()
                except Exception:
                    data = resp.text

                return GitHubResponse(
                    status_code=resp.status_code,
                    data=data,
                    rate_limit=rate_limit,
                )

            except httpx.TimeoutException as e:
                last_error = e
                delay = self._calculate_delay(attempt, None)
                logger.warning(
                    f"Timeout. Attempt {attempt + 1}/{max_retries + 1}. Waiting {delay:.1f}s"
                )
                if attempt < max_retries:
                    await asyncio.sleep(delay)
                    continue

            except httpx.RequestError as e:
                last_error = e
                delay = self._calculate_delay(attempt, None)
                logger.warning(
                    f"Request error: {e}. Attempt {attempt + 1}/{max_retries + 1}. Waiting {delay:.1f}s"
                )
                if attempt < max_retries:
                    await asyncio.sleep(delay)
                    continue

        logger.error(f"All retries exhausted for {url}")
        return GitHubResponse(
            status_code=0,
            data={"error": str(last_error) if last_error else "Unknown error"},
            rate_limit=self._rate_limit,
        )

    @property
    def rate_limit_info(self) -> RateLimitInfo | None:
        return self._rate_limit


def parse_frontmatter(content: str) -> tuple[dict[str, Any], str]:
    frontmatter_pattern = r"^---\s*\n(.*?)\n---\s*\n(.*)$"
    match = re.match(frontmatter_pattern, content, re.DOTALL)

    if not match:
        return {}, content

    try:
        metadata = yaml.safe_load(match.group(1))
        if metadata is None:
            metadata = {}
        body = match.group(2)
        return metadata, body
    except yaml.YAMLError as e:
        logger.warning(f"Failed to parse YAML frontmatter: {e}")
        return {}, content


def parse_tags(tags_value: str | list | None) -> list[str]:
    if not tags_value:
        return []
    if isinstance(tags_value, list):
        return [str(t).strip() for t in tags_value if t]
    if isinstance(tags_value, str):
        return [t.strip() for t in tags_value.split(",") if t.strip()]
    return []


async def get_repo_latest_commit(client: GitHubClient) -> tuple[str | None, str | None]:
    resp = await client.get(f"{GITHUB_API_BASE}/repos/{GITHUB_REPO}/commits/main")
    if not resp.success:
        if resp.is_rate_limited:
            return None, "Rate limited while fetching commit"
        return None, f"Failed to get latest commit: {resp.status_code}"
    return resp.data.get("sha"), None


async def get_content_tree(client: GitHubClient) -> tuple[list[str], str | None]:
    resp = await client.get(f"{GITHUB_API_BASE}/repos/{GITHUB_REPO}/git/trees/main?recursive=1")
    if not resp.success:
        if resp.is_rate_limited:
            return [], "Rate limited while fetching tree"
        return [], f"Failed to get tree: {resp.status_code}"

    tree = resp.data.get("tree", [])

    md_files = [
        item["path"]
        for item in tree
        if item["type"] == "blob"
        and item["path"].startswith(f"{CONTENT_PATH}/")
        and item["path"].endswith(".md")
    ]
    return md_files, None


async def fetch_and_process_file(
    client: GitHubClient,
    path: str,
    commit_sha: str,
) -> tuple[bool, str | None, bool]:
    try:
        resp = await client.get(f"{GITHUB_API_BASE}/repos/{GITHUB_REPO}/contents/{path}")

        if not resp.success:
            if resp.is_rate_limited:
                return False, "Rate limited", True
            return False, f"Failed to fetch from GitHub: HTTP {resp.status_code}", False

        content_b64 = resp.data.get("content", "")
        if not content_b64:
            return False, "Empty content received from GitHub", False

        try:
            content = b64decode(content_b64).decode("utf-8")
        except Exception as e:
            return False, f"Failed to decode base64 content: {e}", False

        metadata, body = parse_frontmatter(content)

        raw_title = metadata.get("title")
        if raw_title is None or (isinstance(raw_title, str) and not raw_title.strip()):
            filename = path.split("/")[-1].replace(".md", "")
            title = filename.replace("-", " ").replace("_", " ").title()
        else:
            title = str(raw_title).strip()

        if not title:
            return False, f"Could not determine title for file (path: {path})", False

        category = metadata.get("category")
        if category is not None:
            category = str(category).strip() or None

        description = metadata.get("description")
        if description is not None:
            description = str(description).strip() or None

        tags = parse_tags(metadata.get("tags"))

        try:
            await db.notes_upsert_document(
                file_path=path,
                title=title,
                category_name=category,
                description=description,
                content=content,
                git_commit_sha=commit_sha,
                tags=tags,
            )
        except Exception as e:
            error_type = type(e).__name__
            return False, f"Database error ({error_type}): {e}", False

        return True, None, False

    except Exception as e:
        error_type = type(e).__name__
        logger.exception(f"Unexpected error processing {path}: {e}")
        return False, f"Unexpected error ({error_type}): {e}", False


async def sync_notes_with_job(
    token: str | None = None,
    force: bool = False,
    resume_job_id: int | None = None,
) -> dict[str, Any]:
    result = {
        "success": True,
        "job_id": None,
        "job_status": None,
        "completed": 0,
        "failed": 0,
        "pending": 0,
        "total": 0,
        "commit_sha": None,
        "rate_limit_info": None,
        "message": None,
    }

    async with GitHubClient(token) as client:
        job_id = resume_job_id
        commit_sha = None
        file_paths: list[str] = []

        if not job_id:
            resumable = await db.sync_job_get_resumable()
            if resumable:
                job_id = resumable["id"]
                commit_sha = resumable["commit_sha"]

                if resumable["status"] == "paused" and resumable.get("rate_limit_reset_at"):
                    reset_at = datetime.fromisoformat(resumable["rate_limit_reset_at"])
                    now = datetime.now(UTC)
                    if reset_at > now:
                        wait_secs = (reset_at - now).total_seconds()
                        if wait_secs > 0:
                            logger.info(
                                f"Resuming paused job {job_id}, waiting {wait_secs:.1f}s for rate limit reset"
                            )
                            await asyncio.sleep(min(wait_secs, 5.0))

                logger.info(f"Resuming existing job {job_id} at commit {commit_sha}")
                result["message"] = f"Resuming job {job_id}"

        if not job_id:
            commit_sha, error = await get_repo_latest_commit(client)
            if error:
                result["success"] = False
                result["message"] = error
                return result

            result["commit_sha"] = commit_sha

            if not force:
                last_sync_sha = await db.notes_get_last_sync_sha()
                if last_sync_sha == commit_sha:
                    result["message"] = f"Already synced to {commit_sha}"
                    result["job_status"] = "skipped"
                    return result

            file_paths, error = await get_content_tree(client)
            if error:
                result["success"] = False
                result["message"] = error
                return result

            if not file_paths:
                result["message"] = "No markdown files found"
                return result

            job_id = await db.sync_job_create(commit_sha, file_paths)
            result["job_id"] = job_id
            result["total"] = len(file_paths)
            logger.info(f"Created sync job {job_id} with {len(file_paths)} files")

        else:
            result["job_id"] = job_id
            job = await db.sync_job_get(job_id)
            if job:
                result["total"] = job["total_items"]
                commit_sha = job["commit_sha"]
                result["commit_sha"] = commit_sha

        await db.sync_job_update_status(job_id, "running")
        result["job_status"] = "running"

        batch_size = 50
        rate_limited = False
        processed_paths: list[str] = []
        items_processed_this_run = 0
        items_failed_this_run = 0

        while True:
            pending_items = await db.sync_job_get_pending_items(job_id, limit=batch_size)
            if not pending_items:
                break

            for item in pending_items:
                item_id = item["id"]
                path = item["file_path"]
                retry_count = item.get("retry_count", 0)

                if retry_count >= SKIP_ITEM_AFTER_RETRIES:
                    logger.info(f"Skipping {path} - exceeded max retries ({retry_count})")
                    await db.sync_job_item_update(
                        item_id, "skipped", f"Exceeded max retries ({retry_count})"
                    )
                    continue

                success, error, is_rate_limited = await fetch_and_process_file(
                    client, path, commit_sha
                )

                if success:
                    await db.sync_job_item_update(item_id, "success")
                    processed_paths.append(path)
                    items_processed_this_run += 1
                    logger.debug(f"Synced: {path}")
                elif is_rate_limited:
                    logger.warning(f"Rate limited while processing {path}, pausing job")
                    rate_limited = True
                    rate_limit = client.rate_limit_info
                    if rate_limit:
                        result["rate_limit_info"] = {
                            "limit": rate_limit.limit,
                            "remaining": rate_limit.remaining,
                            "reset_at": rate_limit.reset_at.isoformat(),
                        }
                        await db.sync_job_update_status(
                            job_id, "paused", rate_limit_reset_at=rate_limit.reset_at
                        )
                    break
                else:
                    await db.sync_job_item_update(item_id, "failed", error)
                    items_failed_this_run += 1

                    if retry_count + 1 >= MAX_ITEM_RETRIES:
                        logger.warning(
                            f"Failed to sync {path} (final attempt {retry_count + 1}): {error}"
                        )
                    else:
                        logger.info(
                            f"Failed to sync {path} (attempt {retry_count + 1}/{MAX_ITEM_RETRIES}): {error}"
                        )

                    continue

            if rate_limited:
                break

            await db.sync_job_update_counts(job_id)

        if items_processed_this_run > 0 or items_failed_this_run > 0:
            logger.info(
                f"Processing run complete: {items_processed_this_run} succeeded, {items_failed_this_run} failed"
            )

        await db.sync_job_update_counts(job_id)
        job = await db.sync_job_get(job_id)
        result["completed"] = job["completed_items"]
        result["failed"] = job["failed_items"]

        skipped_count = await db.sync_job_get_skipped_count(job_id)
        result["skipped_items"] = skipped_count

        result["pending"] = (
            job["total_items"] - job["completed_items"] - job["failed_items"] - skipped_count
        )

        all_items_processed = result["pending"] == 0

        if rate_limited:
            result["job_status"] = "paused"
            result["message"] = (
                f"Paused due to rate limiting. {result['completed']}/{result['total']} completed. Will resume automatically."
            )
        elif all_items_processed and result["failed"] == 0 and skipped_count == 0:
            await db.sync_job_update_status(job_id, "completed")
            result["job_status"] = "completed"
            result["message"] = f"Sync completed. {result['completed']} documents synced."

            if processed_paths:
                all_paths = await db.sync_job_get_all_completed_paths(job_id)
                if all_paths:
                    deleted = await db.notes_delete_documents_not_in(all_paths)
                    if deleted > 0:
                        result["deleted"] = deleted
                        logger.info(f"Deleted {deleted} documents no longer in repository")
        elif all_items_processed:
            error_parts = []
            if result["failed"] > 0:
                error_parts.append(f"{result['failed']} failed")
            if skipped_count > 0:
                error_parts.append(f"{skipped_count} skipped (unrecoverable)")
            error_summary = ", ".join(error_parts)

            await db.sync_job_update_status(job_id, "completed", error_message=error_summary)
            result["job_status"] = "completed_with_errors"
            result["message"] = (
                f"Sync completed with issues: {error_summary}. {result['completed']}/{result['total']} succeeded."
            )

            if processed_paths:
                all_paths = await db.sync_job_get_all_completed_paths(job_id)
                if all_paths:
                    deleted = await db.notes_delete_documents_not_in(all_paths)
                    if deleted > 0:
                        result["deleted"] = deleted
                        logger.info(f"Deleted {deleted} documents no longer in repository")
        else:
            result["job_status"] = "running"

    return result


async def retry_failed_items(job_id: int, token: str | None = None) -> dict[str, Any]:
    reset_count = await db.sync_job_reset_failed_items(job_id, max_retries=MAX_RETRIES)
    if reset_count == 0:
        return {
            "success": False,
            "message": "No items to retry (all at max retries or no failed items)",
        }

    return await sync_notes_with_job(token=token, resume_job_id=job_id)


async def sync_notes(token: str | None = None, force: bool = False) -> dict[str, Any]:
    result = await sync_notes_with_job(token=token, force=force)

    return {
        "success": result.get("job_status") not in ("failed",),
        "added": 0,
        "updated": result.get("completed", 0),
        "deleted": result.get("deleted", 0),
        "errors": [result.get("message")] if result.get("failed", 0) > 0 else [],
        "commit_sha": result.get("commit_sha"),
        "job_id": result.get("job_id"),
        "job_status": result.get("job_status"),
        "skipped": result.get("job_status") == "skipped",
    }
