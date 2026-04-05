"""Database migrations module.

This module provides a simple migration system for managing database schema changes.
Migrations are versioned SQL files that are applied in order.
"""

import logging
from pathlib import Path
from typing import Any

from api.db.core import _get_connection

logger = logging.getLogger(__name__)

MIGRATIONS_DIR = Path(__file__).parent


async def get_current_version() -> int:
    """Get the current migration version from the database."""
    async with _get_connection() as conn:
        # Create migrations table if it doesn't exist
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                description TEXT
            );
            """
        )

        result = await conn.fetchval("SELECT COALESCE(MAX(version), 0) FROM schema_migrations")
        return int(result) if result else 0


async def apply_migration(version: int, sql: str, description: str = "") -> bool:
    """Apply a single migration.

    Args:
        version: The migration version number.
        sql: The SQL to execute.
        description: Optional description of the migration.

    Returns:
        True if migration was applied, False if already applied.
    """
    current = await get_current_version()
    if version <= current:
        logger.debug("Migration %d already applied", version)
        return False

    async with _get_connection() as conn:
        try:
            # Execute the migration SQL
            await conn.execute(sql)

            # Record the migration
            await conn.execute(
                """
                INSERT INTO schema_migrations (version, description)
                VALUES ($1, $2)
                """,
                version,
                description,
            )

            logger.info("Applied migration %d: %s", version, description)
            return True
        except Exception as e:
            logger.error("Failed to apply migration %d: %s", version, e)
            raise


async def get_pending_migrations() -> list[dict[str, Any]]:
    """Get list of pending migrations.

    Returns:
        List of migration info dicts with version, filename, and description.
    """
    current = await get_current_version()
    pending = []

    for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
        # Parse version from filename (e.g., "001_initial.sql" -> 1)
        try:
            version = int(path.stem.split("_")[0])
            if version > current:
                pending.append(
                    {
                        "version": version,
                        "filename": path.name,
                        "description": "_".join(path.stem.split("_")[1:]),
                        "path": path,
                    }
                )
        except (ValueError, IndexError):
            continue

    return pending


async def run_migrations() -> int:
    """Run all pending migrations.

    Returns:
        Number of migrations applied.
    """
    pending = await get_pending_migrations()
    applied = 0

    for migration in pending:
        sql = migration["path"].read_text()
        if await apply_migration(
            migration["version"],
            sql,
            migration["description"],
        ):
            applied += 1

    if applied:
        logger.info("Applied %d migrations", applied)
    else:
        logger.debug("No pending migrations")

    return applied


async def get_migration_history() -> list[dict[str, Any]]:
    """Get the history of applied migrations.

    Returns:
        List of applied migrations with version, applied_at, and description.
    """
    async with _get_connection() as conn:
        # Ensure table exists
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                description TEXT
            );
            """
        )

        rows = await conn.fetch(
            """
            SELECT version, applied_at, description
            FROM schema_migrations
            ORDER BY version
            """
        )

        return [dict(row) for row in rows]
