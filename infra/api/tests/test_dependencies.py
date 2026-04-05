"""Tests for dependency injection (TDD - Issue #1)."""

from unittest.mock import MagicMock, patch

import pytest

from api import state
from api.errors import ServiceUnavailableError


class TestGetRedis:
    """Test get_redis dependency."""

    def test_get_redis_returns_client_when_connected(self):
        """Test that get_redis returns the client when connected."""
        from api.dependencies import get_redis

        mock_redis = MagicMock()
        with patch.object(state, "redis_client", mock_redis):
            result = get_redis()
            assert result is mock_redis

    def test_get_redis_raises_when_not_connected(self):
        """Test that get_redis raises ServiceUnavailableError when not connected."""
        from api.dependencies import get_redis

        with patch.object(state, "redis_client", None):
            with pytest.raises(ServiceUnavailableError) as exc_info:
                get_redis()
            assert "Redis not connected" in str(exc_info.value.detail)


class TestGetOptionalRedis:
    """Test get_optional_redis dependency."""

    def test_get_optional_redis_returns_client_when_connected(self):
        """Test that get_optional_redis returns the client when connected."""
        from api.dependencies import get_optional_redis

        mock_redis = MagicMock()
        with patch.object(state, "redis_client", mock_redis):
            result = get_optional_redis()
            assert result is mock_redis

    def test_get_optional_redis_returns_none_when_not_connected(self):
        """Test that get_optional_redis returns None when not connected."""
        from api.dependencies import get_optional_redis

        with patch.object(state, "redis_client", None):
            result = get_optional_redis()
            assert result is None


class TestGetEventBus:
    """Test get_event_bus dependency."""

    def test_get_event_bus_returns_bus_when_initialized(self):
        """Test that get_event_bus returns the bus when initialized."""
        from api.dependencies import get_event_bus

        mock_bus = MagicMock()
        with patch.object(state, "event_bus", mock_bus):
            result = get_event_bus()
            assert result is mock_bus

    def test_get_event_bus_raises_when_not_initialized(self):
        """Test that get_event_bus raises ServiceUnavailableError when not initialized."""
        from api.dependencies import get_event_bus

        with patch.object(state, "event_bus", None):
            with pytest.raises(ServiceUnavailableError) as exc_info:
                get_event_bus()
            assert "Event bus not initialized" in str(exc_info.value.detail)


class TestGetOptionalEventBus:
    """Test get_optional_event_bus dependency."""

    def test_get_optional_event_bus_returns_bus_when_initialized(self):
        """Test that get_optional_event_bus returns the bus when initialized."""
        from api.dependencies import get_optional_event_bus

        mock_bus = MagicMock()
        with patch.object(state, "event_bus", mock_bus):
            result = get_optional_event_bus()
            assert result is mock_bus

    def test_get_optional_event_bus_returns_none_when_not_initialized(self):
        """Test that get_optional_event_bus returns None when not initialized."""
        from api.dependencies import get_optional_event_bus

        with patch.object(state, "event_bus", None):
            result = get_optional_event_bus()
            assert result is None


class TestGetGeoIPReader:
    """Test get_geoip_reader dependency."""

    def test_get_geoip_reader_returns_reader_when_available(self):
        """Test that get_geoip_reader returns the reader when available."""
        from api.dependencies import get_geoip_reader

        mock_reader = MagicMock()
        with patch.object(state, "geoip_reader", mock_reader):
            result = get_geoip_reader()
            assert result is mock_reader

    def test_get_geoip_reader_returns_none_when_not_available(self):
        """Test that get_geoip_reader returns None when not available."""
        from api.dependencies import get_geoip_reader

        with patch.object(state, "geoip_reader", None):
            result = get_geoip_reader()
            assert result is None


class TestTypeAliases:
    """Test that type aliases are properly defined."""

    def test_redis_type_alias_exists(self):
        """Test that Redis type alias is defined."""
        from api.dependencies import Redis

        assert Redis is not None

    def test_bus_type_alias_exists(self):
        """Test that Bus type alias is defined."""
        from api.dependencies import Bus

        assert Bus is not None

    def test_geoip_type_alias_exists(self):
        """Test that GeoIP type alias is defined."""
        from api.dependencies import GeoIP

        assert GeoIP is not None
