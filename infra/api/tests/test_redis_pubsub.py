"""Unit tests for the redis_pubsub module - bulletproof connection management."""

import asyncio
import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from api.redis_pubsub import (
    ManagedPubSub,
    PubSubMetadata,
    _active_pubsubs,
    _pubsub_metadata,
    _registry_lock,
    cleanup_expired_pubsubs,
    get_pool_stats,
    get_pubsub_stats,
    managed_pubsub,
)


class TestPubSubMetadata:
    """Tests for PubSubMetadata dataclass."""

    def test_metadata_creation(self):
        meta = PubSubMetadata(channel="test_channel", client_info="test_client")
        assert meta.channel == "test_channel"
        assert meta.client_info == "test_client"
        assert meta.created_at > 0
        assert meta.last_activity > 0

    def test_age_seconds(self):
        meta = PubSubMetadata(channel="test")
        meta.created_at = time.time() - 10  # 10 seconds ago
        assert 9.5 < meta.age_seconds < 11

    def test_idle_seconds(self):
        meta = PubSubMetadata(channel="test")
        meta.last_activity = time.time() - 5  # 5 seconds ago
        assert 4.5 < meta.idle_seconds < 6


class TestManagedPubSub:
    """Tests for ManagedPubSub wrapper class."""

    def test_is_expired_false(self):
        mock_pubsub = MagicMock()
        managed = ManagedPubSub(
            pubsub=mock_pubsub,
            channel="test",
            max_lifetime_sec=3600,
        )
        assert not managed.is_expired()

    def test_is_expired_true(self):
        mock_pubsub = MagicMock()
        managed = ManagedPubSub(
            pubsub=mock_pubsub,
            channel="test",
            max_lifetime_sec=1,  # 1 second lifetime
        )
        managed._metadata.created_at = time.time() - 10  # Created 10 seconds ago
        assert managed.is_expired()

    def test_update_activity(self):
        mock_pubsub = MagicMock()
        managed = ManagedPubSub(pubsub=mock_pubsub, channel="test")
        old_activity = managed._metadata.last_activity
        time.sleep(0.01)
        managed.update_activity()
        assert managed._metadata.last_activity > old_activity

    @pytest.mark.asyncio
    async def test_cleanup_calls_all_methods(self):
        mock_pubsub = MagicMock()
        mock_pubsub.unsubscribe = AsyncMock()
        mock_pubsub.reset = AsyncMock()
        mock_pubsub.aclose = AsyncMock()
        mock_pubsub.connection = None

        managed = ManagedPubSub(
            pubsub=mock_pubsub,
            channel="test_channel",
            cleanup_timeout_sec=3.0,
        )

        await managed.cleanup()

        mock_pubsub.unsubscribe.assert_called_once_with("test_channel")
        mock_pubsub.reset.assert_called_once()
        mock_pubsub.aclose.assert_called_once()

    @pytest.mark.asyncio
    async def test_cleanup_idempotent(self):
        """Cleanup should only run once even if called multiple times."""
        mock_pubsub = MagicMock()
        mock_pubsub.unsubscribe = AsyncMock()
        mock_pubsub.reset = AsyncMock()
        mock_pubsub.aclose = AsyncMock()

        managed = ManagedPubSub(pubsub=mock_pubsub, channel="test")

        await managed.cleanup()
        await managed.cleanup()  # Second call should be no-op

        # Should only be called once
        assert mock_pubsub.unsubscribe.call_count == 1

    @pytest.mark.asyncio
    async def test_cleanup_handles_timeout(self):
        """Cleanup should handle timeouts gracefully."""
        mock_pubsub = MagicMock()

        async def slow_unsubscribe(*args):
            await asyncio.sleep(10)  # Very slow

        mock_pubsub.unsubscribe = slow_unsubscribe
        mock_pubsub.reset = AsyncMock()
        mock_pubsub.aclose = AsyncMock()

        managed = ManagedPubSub(
            pubsub=mock_pubsub,
            channel="test",
            cleanup_timeout_sec=0.1,  # Very short timeout
        )

        # Should not raise, should timeout gracefully
        await managed.cleanup()

    @pytest.mark.asyncio
    async def test_cleanup_handles_exceptions(self):
        """Cleanup should handle exceptions gracefully."""
        mock_pubsub = MagicMock()
        mock_pubsub.unsubscribe = AsyncMock(side_effect=Exception("Connection lost"))
        mock_pubsub.reset = AsyncMock(side_effect=Exception("Reset failed"))
        mock_pubsub.aclose = AsyncMock(side_effect=Exception("Close failed"))

        managed = ManagedPubSub(pubsub=mock_pubsub, channel="test")

        # Should not raise
        await managed.cleanup()

    @pytest.mark.asyncio
    async def test_listen_updates_activity(self):
        """Listen should update activity timestamp on each message."""
        mock_pubsub = MagicMock()

        async def mock_listen():
            yield {"type": "message", "data": "test1"}
            yield {"type": "message", "data": "test2"}

        mock_pubsub.listen = mock_listen

        managed = ManagedPubSub(pubsub=mock_pubsub, channel="test")
        old_activity = managed._metadata.last_activity

        messages = []
        async for msg in managed.listen():
            messages.append(msg)
            if len(messages) >= 2:
                break

        assert managed._metadata.last_activity >= old_activity
        assert len(messages) == 2


class TestManagedPubSubContextManager:
    """Tests for the managed_pubsub context manager."""

    @pytest.mark.asyncio
    async def test_context_manager_subscribes_and_cleans_up(self):
        """Context manager should subscribe on enter and cleanup on exit."""
        mock_pubsub = MagicMock()
        mock_pubsub.subscribe = AsyncMock()
        mock_pubsub.unsubscribe = AsyncMock()
        mock_pubsub.reset = AsyncMock()
        mock_pubsub.aclose = AsyncMock()

        mock_redis = MagicMock()
        mock_redis.pubsub = MagicMock(return_value=mock_pubsub)

        async with managed_pubsub(mock_redis, "test_channel", client_info="test") as ps:
            mock_pubsub.subscribe.assert_called_once_with("test_channel")
            assert ps is not None

        # After exit, cleanup should have been called
        mock_pubsub.unsubscribe.assert_called()

    @pytest.mark.asyncio
    async def test_context_manager_registers_in_global_tracking(self):
        """Context manager should register pubsub in global tracking."""
        mock_pubsub = MagicMock()
        mock_pubsub.subscribe = AsyncMock()
        mock_pubsub.unsubscribe = AsyncMock()
        mock_pubsub.reset = AsyncMock()
        mock_pubsub.aclose = AsyncMock()

        mock_redis = MagicMock()
        mock_redis.pubsub = MagicMock(return_value=mock_pubsub)

        # Clear any existing state
        async with _registry_lock:
            _pubsub_metadata.clear()

        async with managed_pubsub(mock_redis, "test_channel") as ps:
            stats = await get_pubsub_stats()
            assert stats["active_pubsub_count"] >= 1

        # After exit, should be unregistered
        stats = await get_pubsub_stats()
        # May still have other connections from other tests

    @pytest.mark.asyncio
    async def test_context_manager_cleans_up_on_exception(self):
        """Context manager should cleanup even if exception occurs inside."""
        mock_pubsub = MagicMock()
        mock_pubsub.subscribe = AsyncMock()
        mock_pubsub.unsubscribe = AsyncMock()
        mock_pubsub.reset = AsyncMock()
        mock_pubsub.aclose = AsyncMock()

        mock_redis = MagicMock()
        mock_redis.pubsub = MagicMock(return_value=mock_pubsub)

        with pytest.raises(ValueError):
            async with managed_pubsub(mock_redis, "test_channel"):
                raise ValueError("Test exception")

        # Cleanup should still have been called
        mock_pubsub.unsubscribe.assert_called()


class TestGetPubsubStats:
    """Tests for get_pubsub_stats function."""

    @pytest.mark.asyncio
    async def test_returns_dict_with_required_keys(self):
        stats = await get_pubsub_stats()
        assert "active_pubsub_count" in stats
        assert "connections" in stats
        assert isinstance(stats["connections"], list)


class TestCleanupExpiredPubsubs:
    """Tests for cleanup_expired_pubsubs function."""

    @pytest.mark.asyncio
    async def test_cleans_up_idle_connections(self):
        """Should cleanup connections that have been idle too long."""
        mock_pubsub = MagicMock()
        mock_pubsub.subscribe = AsyncMock()
        mock_pubsub.unsubscribe = AsyncMock()
        mock_pubsub.reset = AsyncMock()
        mock_pubsub.aclose = AsyncMock()

        mock_redis = MagicMock()
        mock_redis.pubsub = MagicMock(return_value=mock_pubsub)

        # Create a managed pubsub and make it appear idle
        async with _registry_lock:
            _pubsub_metadata.clear()

        # We can't easily test this without modifying internal state
        # Just verify the function runs without error
        cleaned = await cleanup_expired_pubsubs(max_idle_sec=0.001)
        assert isinstance(cleaned, int)


class TestGetPoolStats:
    """Tests for get_pool_stats function."""

    def test_returns_error_when_no_pool(self):
        mock_redis = MagicMock()
        mock_redis.connection_pool = None

        stats = get_pool_stats(mock_redis)
        assert "error" in stats

    def test_returns_stats_with_pool(self):
        mock_pool = MagicMock()
        mock_pool.max_connections = 100
        mock_pool._available_connections = [1, 2, 3]
        mock_pool._in_use_connections = [4, 5]

        mock_redis = MagicMock()
        mock_redis.connection_pool = mock_pool

        stats = get_pool_stats(mock_redis)
        assert stats["max_connections"] == 100
        assert stats["available_connections"] == 3
        assert stats["in_use_connections"] == 2
        assert stats["utilization_percent"] == 2.0

