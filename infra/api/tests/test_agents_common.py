"""Tests for agent common utilities (TDD - Issue #5)."""

from unittest.mock import AsyncMock, patch

import pytest


class TestEnv:
    """Test env helper function."""

    def test_env_returns_value_when_set(self):
        """Test that env returns the value when set."""
        from api.agents.common import env

        with patch.dict("os.environ", {"TEST_VAR": "test_value"}):
            result = env("TEST_VAR")
            assert result == "test_value"

    def test_env_returns_default_when_not_set(self):
        """Test that env returns default when not set."""
        from api.agents.common import env

        with patch.dict("os.environ", {}, clear=True):
            result = env("NONEXISTENT_VAR", "default")
            assert result == "default"


class TestEstimateTokens:
    """Test token estimation function."""

    def test_estimate_tokens_empty_string(self):
        """Test that empty string returns 0 tokens."""
        from api.agents.common import estimate_tokens

        assert estimate_tokens("") == 0
        assert estimate_tokens(None) == 0

    def test_estimate_tokens_short_string(self):
        """Test token estimation for short strings."""
        from api.agents.common import estimate_tokens

        # 4 chars = 1 token
        assert estimate_tokens("test") == 1

    def test_estimate_tokens_longer_string(self):
        """Test token estimation for longer strings."""
        from api.agents.common import estimate_tokens

        # 20 chars = 5 tokens
        assert estimate_tokens("a" * 20) == 5


class TestSafeTrunc:
    """Test safe truncation function."""

    def test_safe_trunc_short_string(self):
        """Test that short strings are not truncated."""
        from api.agents.common import safe_trunc

        result = safe_trunc("hello", 10)
        assert result == "hello"

    def test_safe_trunc_long_string(self):
        """Test that long strings are truncated with ellipsis."""
        from api.agents.common import safe_trunc

        result = safe_trunc("hello world", 5)
        assert result == "hello..."

    def test_safe_trunc_empty_string(self):
        """Test that empty strings return empty."""
        from api.agents.common import safe_trunc

        assert safe_trunc("", 10) == ""
        assert safe_trunc(None, 10) == ""


class TestDailyRequestCount:
    """Test daily request counting functions."""

    @pytest.mark.asyncio
    async def test_get_daily_request_count_no_redis(self):
        """Test that get_daily_request_count returns 0 when no Redis."""
        from api import state
        from api.agents.common import get_daily_request_count

        with patch.object(state, "redis_client", None):
            result = await get_daily_request_count()
            assert result == 0

    @pytest.mark.asyncio
    async def test_increment_daily_request_count_no_redis(self):
        """Test that increment_daily_request_count returns 0 when no Redis."""
        from api import state
        from api.agents.common import increment_daily_request_count

        with patch.object(state, "redis_client", None):
            result = await increment_daily_request_count()
            assert result == 0


class TestCanMakeRequest:
    """Test request limit checking."""

    @pytest.mark.asyncio
    async def test_can_make_request_under_limit(self):
        """Test that can_make_request returns True when under limit."""
        from api.agents.common import can_make_request

        with patch(
            "api.agents.common.get_daily_request_count", new_callable=AsyncMock, return_value=5
        ):
            result = await can_make_request(max_daily=10)
            assert result is True

    @pytest.mark.asyncio
    async def test_can_make_request_at_limit(self):
        """Test that can_make_request returns False when at limit."""
        from api.agents.common import can_make_request

        with patch(
            "api.agents.common.get_daily_request_count", new_callable=AsyncMock, return_value=10
        ):
            result = await can_make_request(max_daily=10)
            assert result is False


class TestAcquireMessageSlot:
    """Test message slot acquisition."""

    @pytest.mark.asyncio
    async def test_acquire_message_slot_first_call(self):
        """Test that first call acquires slot."""
        from api.agents import common

        # Reset global state
        common._global_last_message_time = 0.0
        common._global_cooldown_lock = None

        result = await common.acquire_message_slot("test_sender", 1.0)
        assert result is True

    @pytest.mark.asyncio
    async def test_acquire_message_slot_within_cooldown(self):
        """Test that call within cooldown fails."""
        import time

        from api.agents import common

        # Reset and set recent message time
        common._global_cooldown_lock = None
        common._global_last_message_time = time.monotonic()

        result = await common.acquire_message_slot("test_sender", 60.0)
        assert result is False
