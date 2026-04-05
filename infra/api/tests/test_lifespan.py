"""Tests for lifespan management (TDD - Issue #3)."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest


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

        with patch("api.lifespan.os.path.exists", return_value=False):
            with patch("api.lifespan.get_settings") as mock_settings:
                mock_settings.return_value.geoip.db_path = "/nonexistent/path.mmdb"

                result = init_geoip()

                assert result is None

    def test_init_geoip_returns_reader_when_file_exists(self):
        """Test that init_geoip returns reader when file exists."""
        from api.lifespan import init_geoip

        mock_reader = MagicMock()

        with patch("api.lifespan.os.path.exists", return_value=True):
            with patch("api.lifespan.geoip2.database.Reader", return_value=mock_reader):
                with patch("api.lifespan.get_settings") as mock_settings:
                    mock_settings.return_value.geoip.db_path = "/app/GeoLite2-City.mmdb"

                    result = init_geoip()

                    assert result is mock_reader


class TestInitDatabase:
    """Test init_database function."""

    @pytest.mark.asyncio
    async def test_init_database_returns_false_when_disabled(self):
        """Test that init_database returns False when disabled."""
        from api.lifespan import init_database

        with patch.dict("os.environ", {"ENABLE_CHAT_DB": "0"}):
            result = await init_database()
            assert result is False

    @pytest.mark.asyncio
    async def test_init_database_returns_true_when_enabled_and_successful(self):
        """Test that init_database returns True when enabled and successful."""
        from api.lifespan import init_database

        with patch.dict("os.environ", {"ENABLE_CHAT_DB": "1"}):
            with patch("api.lifespan.db.init_pool", new_callable=AsyncMock):
                result = await init_database()
                assert result is True


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
