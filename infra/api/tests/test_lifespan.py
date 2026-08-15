"""Tests for lifespan management (TDD - Issue #3)."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from api.config import clear_settings_cache


@pytest.fixture(autouse=True)
def _fresh_settings_cache():
    """Isolate the lru_cached Settings singleton per test.

    lifespan.py resolves GEOIP_DB_PATH and ENABLE_CHAT_DB through
    get_settings() now, so tests that patch os.environ need an empty
    cache before the call and must not leak their env into later tests.
    """
    clear_settings_cache()
    yield
    clear_settings_cache()


class TestLifespanResources:
    """Test LifespanResources dataclass."""

    def test_lifespan_resources_defaults(self):
        """Test that LifespanResources has correct defaults."""
        from api.lifespan import LifespanResources

        resources = LifespanResources()
        assert resources.redis_client is None
        assert resources.event_bus is None
        assert resources.geoip_reader is None
        assert resources.stop_event is None
        assert resources.background_tasks == []
        assert resources.db_enabled is False

    def test_lifespan_resources_with_values(self):
        """Test LifespanResources with custom values."""
        from api.lifespan import LifespanResources

        mock_redis = MagicMock()
        mock_bus = MagicMock()

        resources = LifespanResources(
            redis_client=mock_redis,
            event_bus=mock_bus,
            db_enabled=True,
        )

        assert resources.redis_client is mock_redis
        assert resources.event_bus is mock_bus
        assert resources.db_enabled is True


class TestInitRedis:
    """Test init_redis function."""

    @pytest.mark.asyncio
    async def test_init_redis_creates_client(self):
        """Test that init_redis creates a Redis client."""
        from api.lifespan import init_redis

        mock_redis_class = MagicMock()
        mock_client = MagicMock()
        mock_redis_class.return_value = mock_client

        with patch("api.lifespan.redis.Redis", mock_redis_class):
            with patch("api.lifespan.get_settings") as mock_settings:
                mock_settings.return_value.redis.host = "localhost"
                mock_settings.return_value.redis.port = 6379
                mock_settings.return_value.redis.password = ""
                mock_settings.return_value.redis.max_connections = 10
                mock_settings.return_value.redis.pool_timeout_sec = 5.0
                mock_settings.return_value.debug.redis = False

                result = await init_redis()

                assert result is mock_client
                mock_redis_class.assert_called_once()


class TestInitGeoip:
    """Test init_geoip function."""

    def test_init_geoip_returns_none_when_file_missing(self):
        """Test that init_geoip returns None when file doesn't exist."""
        from api.lifespan import init_geoip

        with patch.dict("os.environ", {"GEOIP_DB_PATH": "/nonexistent/path.mmdb"}):
            with patch("api.lifespan.os.path.exists", return_value=False) as mock_exists:
                result = init_geoip()

                assert result is None
                mock_exists.assert_called_once_with("/nonexistent/path.mmdb")

    def test_init_geoip_returns_reader_when_file_exists(self):
        """Test that init_geoip returns reader when file exists."""
        from api.lifespan import init_geoip

        mock_reader = MagicMock()

        with patch.dict("os.environ", {"GEOIP_DB_PATH": "/app/GeoLite2-City.mmdb"}):
            with patch("api.lifespan.os.path.exists", return_value=True):
                with patch(
                    "api.lifespan.geoip2.database.Reader", return_value=mock_reader
                ) as mock_reader_cls:
                    result = init_geoip()

                    assert result is mock_reader
                    mock_reader_cls.assert_called_once_with("/app/GeoLite2-City.mmdb")


class TestInitDatabase:
    """Test init_database function."""

    @pytest.mark.asyncio
    async def test_init_database_skips_pool_when_disabled(self):
        """Test that init_database does not touch the pool when disabled."""
        from api.lifespan import init_database

        with patch.dict("os.environ", {"ENABLE_CHAT_DB": "0"}):
            with patch("api.lifespan.db.init_pool", new_callable=AsyncMock) as mock_init:
                result = await init_database()
                assert result is None
                mock_init.assert_not_called()

    @pytest.mark.asyncio
    async def test_init_database_inits_pool_when_enabled(self):
        """Test that init_database initializes the pool when enabled.

        Also pins that pool init failures are swallowed silently.
        """
        from api.lifespan import init_database

        with patch.dict("os.environ", {"ENABLE_CHAT_DB": "1"}):
            with patch("api.lifespan.db.init_pool", new_callable=AsyncMock) as mock_init:
                result = await init_database()
                assert result is None
                mock_init.assert_called_once()

            with patch(
                "api.lifespan.db.init_pool",
                new_callable=AsyncMock,
                side_effect=RuntimeError("boom"),
            ):
                # Must not raise: failures are ignored (pinned behavior).
                await init_database()


class TestSetupResources:
    """Test setup_resources function."""

    @pytest.mark.asyncio
    async def test_setup_resources_initializes_all(self):
        """Test that setup_resources initializes all resources."""
        from api.lifespan import LifespanResources, setup_resources

        mock_redis = MagicMock()
        mock_bus = MagicMock()

        with patch("api.lifespan.init_redis", new_callable=AsyncMock, return_value=mock_redis):
            with patch("api.lifespan.EventBus", return_value=mock_bus):
                with patch("api.lifespan.init_geoip", return_value=None):
                    with patch(
                        "api.lifespan.init_database", new_callable=AsyncMock, return_value=False
                    ):
                        resources = await setup_resources()

                        assert isinstance(resources, LifespanResources)
                        assert resources.redis_client is mock_redis
                        assert resources.event_bus is mock_bus


class TestCleanupResources:
    """Test cleanup_resources function."""

    @pytest.mark.asyncio
    async def test_cleanup_resources_closes_redis(self):
        """Test that cleanup_resources closes Redis."""
        from api.lifespan import LifespanResources, cleanup_resources

        mock_redis = MagicMock()
        mock_redis.aclose = AsyncMock()

        resources = LifespanResources(redis_client=mock_redis)

        await cleanup_resources(resources)

        mock_redis.aclose.assert_called_once()

    @pytest.mark.asyncio
    async def test_cleanup_resources_closes_geoip(self):
        """Test that cleanup_resources closes GeoIP reader."""
        from api.lifespan import LifespanResources, cleanup_resources

        mock_geoip = MagicMock()

        resources = LifespanResources(geoip_reader=mock_geoip)

        await cleanup_resources(resources)

        mock_geoip.close.assert_called_once()
