"""Database schema management module.

This module provides schema initialization using a migration-based approach.
Migrations are stored in the migrations/ subdirectory as versioned SQL files.
"""

import logging

from api.db.migrations import get_current_version, get_migration_history, run_migrations

logger = logging.getLogger(__name__)


async def _ensure_schema() -> None:
    """Ensure the database schema is up to date by running pending migrations.

    This function is idempotent - it can be called multiple times safely.
    It will only apply migrations that haven't been applied yet.
    """
    current_version = await get_current_version()
    logger.info("Current schema version: %d", current_version)

    applied = await run_migrations()

    if applied > 0:
        new_version = await get_current_version()
        logger.info("Schema updated from version %d to %d", current_version, new_version)
    else:
        logger.debug("Schema is up to date at version %d", current_version)


async def get_schema_info() -> dict:
    """Get information about the current schema state.

    Returns:
        Dict with current_version and migration_history.
    """
    return {
        "current_version": await get_current_version(),
        "migration_history": await get_migration_history(),
    }
