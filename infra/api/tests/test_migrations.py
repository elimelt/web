"""Tests for the database migration system."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest


class TestMigrationSystem:
    """Tests for the migration module."""

    @pytest.fixture
    def mock_connection(self):
        """Create a mock database connection."""
        conn = AsyncMock()
        conn.execute = AsyncMock()
        conn.fetchval = AsyncMock(return_value=0)
        conn.fetch = AsyncMock(return_value=[])
        return conn

    @pytest.fixture
    def mock_get_connection(self, mock_connection):
        """Create a mock context manager for _get_connection."""
        cm = MagicMock()
        cm.__aenter__ = AsyncMock(return_value=mock_connection)
        cm.__aexit__ = AsyncMock(return_value=None)
        return cm

    @pytest.mark.asyncio
    async def test_get_current_version_creates_table(self, mock_get_connection, mock_connection):
        """Test that get_current_version creates the migrations table."""
        with patch("api.db.migrations._get_connection", return_value=mock_get_connection):
            from api.db.migrations import get_current_version

            version = await get_current_version()

            # Should have created the table
            assert mock_connection.execute.called
            create_call = mock_connection.execute.call_args_list[0]
            assert "CREATE TABLE IF NOT EXISTS schema_migrations" in create_call[0][0]

            # Should return 0 for empty database
            assert version == 0

    @pytest.mark.asyncio
    async def test_get_current_version_returns_max(self, mock_get_connection, mock_connection):
        """Test that get_current_version returns the max version."""
        mock_connection.fetchval = AsyncMock(return_value=5)

        with patch("api.db.migrations._get_connection", return_value=mock_get_connection):
            from api.db.migrations import get_current_version

            version = await get_current_version()
            assert version == 5

    @pytest.mark.asyncio
    async def test_apply_migration_skips_if_already_applied(
        self, mock_get_connection, mock_connection
    ):
        """Test that apply_migration skips already applied migrations."""
        mock_connection.fetchval = AsyncMock(return_value=5)

        with patch("api.db.migrations._get_connection", return_value=mock_get_connection):
            from api.db.migrations import apply_migration

            result = await apply_migration(3, "SELECT 1;", "test")

            # Should return False (not applied)
            assert result is False

    @pytest.mark.asyncio
    async def test_apply_migration_applies_new_migration(
        self, mock_get_connection, mock_connection
    ):
        """Test that apply_migration applies new migrations."""
        mock_connection.fetchval = AsyncMock(return_value=2)

        with patch("api.db.migrations._get_connection", return_value=mock_get_connection):
            from api.db.migrations import apply_migration

            result = await apply_migration(3, "CREATE TABLE test (id INT);", "test migration")

            # Should return True (applied)
            assert result is True

            # Should have executed the SQL
            execute_calls = mock_connection.execute.call_args_list
            sql_executed = any("CREATE TABLE test" in str(call) for call in execute_calls)
            assert sql_executed

    @pytest.mark.asyncio
    async def test_get_pending_migrations_finds_sql_files(
        self, mock_get_connection, mock_connection
    ):
        """Test that get_pending_migrations finds SQL files."""
        mock_connection.fetchval = AsyncMock(return_value=0)

        with patch("api.db.migrations._get_connection", return_value=mock_get_connection):
            from api.db.migrations import get_pending_migrations

            pending = await get_pending_migrations()

            # Should find the migration files we created
            assert len(pending) >= 2
            versions = [m["version"] for m in pending]
            assert 1 in versions
            assert 2 in versions

    @pytest.mark.asyncio
    async def test_get_pending_migrations_excludes_applied(
        self, mock_get_connection, mock_connection
    ):
        """Test that get_pending_migrations excludes already applied migrations."""
        mock_connection.fetchval = AsyncMock(return_value=1)

        with patch("api.db.migrations._get_connection", return_value=mock_get_connection):
            from api.db.migrations import get_pending_migrations

            pending = await get_pending_migrations()

            # Should not include version 1
            versions = [m["version"] for m in pending]
            assert 1 not in versions
            assert 2 in versions

    @pytest.mark.asyncio
    async def test_run_migrations_applies_pending(self, mock_get_connection, mock_connection):
        """Test that run_migrations applies all pending migrations."""
        mock_connection.fetchval = AsyncMock(return_value=0)

        with patch("api.db.migrations._get_connection", return_value=mock_get_connection):
            from api.db.migrations import run_migrations

            applied = await run_migrations()

            # Should have applied at least 2 migrations
            assert applied >= 2

    @pytest.mark.asyncio
    async def test_get_migration_history_returns_list(self, mock_get_connection, mock_connection):
        """Test that get_migration_history returns applied migrations."""
        mock_connection.fetch = AsyncMock(
            return_value=[
                {"version": 1, "applied_at": "2024-01-01", "description": "initial"},
                {"version": 2, "applied_at": "2024-01-02", "description": "vector"},
            ]
        )

        with patch("api.db.migrations._get_connection", return_value=mock_get_connection):
            from api.db.migrations import get_migration_history

            history = await get_migration_history()

            assert len(history) == 2
            assert history[0]["version"] == 1
            assert history[1]["version"] == 2


class TestSchemaModule:
    """Tests for the schema module."""

    @pytest.mark.asyncio
    async def test_ensure_schema_runs_migrations(self):
        """Test that _ensure_schema runs migrations."""
        with (
            patch("api.db.schema.get_current_version", new_callable=AsyncMock) as mock_version,
            patch("api.db.schema.run_migrations", new_callable=AsyncMock) as mock_run,
        ):
            mock_version.return_value = 0
            mock_run.return_value = 2

            from api.db.schema import _ensure_schema

            await _ensure_schema()

            mock_version.assert_called()
            mock_run.assert_called_once()

    @pytest.mark.asyncio
    async def test_get_schema_info_returns_dict(self):
        """Test that get_schema_info returns schema information."""
        with (
            patch("api.db.schema.get_current_version", new_callable=AsyncMock) as mock_version,
            patch("api.db.schema.get_migration_history", new_callable=AsyncMock) as mock_history,
        ):
            mock_version.return_value = 2
            mock_history.return_value = [{"version": 1}, {"version": 2}]

            from api.db.schema import get_schema_info

            info = await get_schema_info()

            assert info["current_version"] == 2
            assert len(info["migration_history"]) == 2
