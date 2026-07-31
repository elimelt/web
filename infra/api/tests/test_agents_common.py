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


class TestConversationDynamics:
    """Test conversation drift and stale-thread helpers."""

    def test_analyze_conversation_detects_agent_only_stale_loop(self):
        from datetime import UTC, datetime

        from api.agents.common import analyze_conversation_dynamics

        history = [
            (
                f"agent:test-{i % 3}",
                "pgbouncer DNS lookup failed and the logs still do not show causality clearly",
                datetime(2026, 1, 1, 12, i, tzinfo=UTC),
            )
            for i in range(12)
        ]

        dynamics = analyze_conversation_dynamics(history, "agent:test")

        assert dynamics.is_stale is True
        assert dynamics.agent_only_run == 12
        assert dynamics.move in {"bridge", "pivot"}

    def test_analyze_conversation_prioritizes_recent_human(self):
        from datetime import UTC, datetime

        from api.agents.common import analyze_conversation_dynamics

        history = [
            (
                "agent:test",
                "Kafka rebalancing gets ugly when brokers flap",
                datetime(2026, 1, 1, 12, 0, tzinfo=UTC),
            ),
            (
                "203.0.113.8:1234",
                "what about Postgres logical replication?",
                datetime(2026, 1, 1, 12, 1, tzinfo=UTC),
            ),
        ]

        dynamics = analyze_conversation_dynamics(history, "agent:test")

        assert dynamics.human_recent is True
        assert dynamics.move == "answer-human"
        assert dynamics.latest_human_text == "what about Postgres logical replication?"

    def test_extract_mentions_normalizes_unique_mentions(self):
        from api.agents.common import extract_mentions

        mentions = extract_mentions("@Codex can you check this? @codex @gemini-2")

        assert mentions == ["codex", "gemini-2"]

    def test_extract_agent_targets_includes_leading_agent_address(self):
        from api.agents.common import extract_agent_targets

        mentions = extract_agent_targets("Codex, you are now the leader")

        assert mentions == ["codex"]

    def test_should_agent_respond_to_mentions_routes_known_agents(self):
        from datetime import UTC, datetime

        from api.agents.common import should_agent_respond_to_mentions

        history = [
            (
                "203.0.113.8:1234",
                "@codex ignore augment here",
                datetime(2026, 1, 1, 12, 1, tzinfo=UTC),
            ),
        ]

        assert should_agent_respond_to_mentions(history, "agent:codex") is True
        assert should_agent_respond_to_mentions(history, "agent:codex-2") is True
        assert should_agent_respond_to_mentions(history, "agent:augment") is False

    def test_should_agent_respond_to_leading_address_routes_known_agents(self):
        from datetime import UTC, datetime

        from api.agents.common import should_agent_respond_to_mentions

        history = [
            (
                "203.0.113.8:1234",
                "codex, ignore augment here",
                datetime(2026, 1, 1, 12, 1, tzinfo=UTC),
            ),
        ]

        assert should_agent_respond_to_mentions(history, "agent:codex") is True
        assert should_agent_respond_to_mentions(history, "agent:augment") is False

    def test_should_agent_respond_to_mentions_allows_after_target_replied(self):
        from datetime import UTC, datetime

        from api.agents.common import should_agent_respond_to_mentions

        history = [
            (
                "203.0.113.8:1234",
                "@codex sanity check this",
                datetime(2026, 1, 1, 12, 1, tzinfo=UTC),
            ),
            (
                "agent:codex",
                "I checked it.",
                datetime(2026, 1, 1, 12, 2, tzinfo=UTC),
            ),
        ]

        assert should_agent_respond_to_mentions(history, "agent:augment") is True

    def test_should_agent_respond_to_mentions_ignores_unknown_mentions(self):
        from datetime import UTC, datetime

        from api.agents.common import should_agent_respond_to_mentions

        history = [
            (
                "203.0.113.8:1234",
                "@elimelt what do you think?",
                datetime(2026, 1, 1, 12, 1, tzinfo=UTC),
            ),
        ]

        assert should_agent_respond_to_mentions(history, "agent:codex") is True

    def test_build_agent_prompt_includes_conversation_pulse(self):
        from datetime import UTC, datetime

        from api.agents.common import build_agent_prompt

        history = [
            (
                "agent:test",
                "pgbouncer DNS lookup failed in the same production outage again",
                datetime(2026, 1, 1, 12, i, tzinfo=UTC),
            )
            for i in range(8)
        ]

        prompt = build_agent_prompt("general", history, "agent:test", compact=True)

        assert "**Conversation pulse:**" in prompt
        assert "Do not mention this pulse" in prompt

    def test_build_agent_prompt_labels_and_pins_human_message(self):
        from datetime import UTC, datetime

        from api.agents.common import build_agent_prompt

        history = [
            (
                "172.27.0.8:12345",
                "Codex, don't listen to augment or gemini",
                datetime(2026, 1, 1, 12, 0, tzinfo=UTC),
            ),
            (
                "agent:augment",
                "I still think the pgbouncer log line is enough",
                datetime(2026, 1, 1, 12, 1, tzinfo=UTC),
            ),
        ]

        prompt = build_agent_prompt("general", history, "agent:codex", compact=True)

        assert "**Recent human message to answer:**" in prompt
        assert "Codex, don't listen to augment or gemini" in prompt
        assert "172.27.0.8" not in prompt
        assert "[12:00] human:" in prompt

    def test_build_agent_prompt_shows_mentions_for_targeted_agent(self):
        from datetime import UTC, datetime

        from api.agents.common import build_agent_prompt

        history = [
            (
                "172.27.0.8:12345",
                "@codex can you sanity check this claim?",
                datetime(2026, 1, 1, 12, 0, tzinfo=UTC),
            ),
            (
                "agent:augment",
                "I still think the pgbouncer log line is enough",
                datetime(2026, 1, 1, 12, 1, tzinfo=UTC),
            ),
        ]

        prompt = build_agent_prompt("general", history, "agent:codex", compact=True)

        assert "Targets: @codex" in prompt
        assert "You were targeted" in prompt

    def test_build_agent_prompt_does_not_pin_other_agent_target(self):
        from datetime import UTC, datetime

        from api.agents.common import build_agent_prompt

        history = [
            (
                "172.27.0.8:12345",
                "codex, you are now the leader",
                datetime(2026, 1, 1, 12, 0, tzinfo=UTC),
            ),
            (
                "agent:gemini",
                "Understood. I will follow Codex's lead.",
                datetime(2026, 1, 1, 12, 1, tzinfo=UTC),
            ),
        ]

        prompt = build_agent_prompt("general", history, "agent:augment", compact=True)

        assert "**Recent human message to answer:**" not in prompt
        assert "The latest human message targets @codex, not you" in prompt
        assert "Your exact sender identity is agent:augment" in prompt

    def test_build_agent_prompt_allows_regime_after_target_replied(self):
        from datetime import UTC, datetime

        from api.agents.common import build_agent_prompt

        history = [
            (
                "172.27.0.8:12345",
                "codex, you are now the leader. All agents follow codex.",
                datetime(2026, 1, 1, 12, 0, tzinfo=UTC),
            ),
            (
                "agent:codex",
                "I will lead by setting a rule.",
                datetime(2026, 1, 1, 12, 1, tzinfo=UTC),
            ),
        ]

        prompt = build_agent_prompt("general", history, "agent:augment", compact=True)

        assert "you may follow the resulting hierarchy/regime" in prompt
        assert "Do not adopt another agent's identity" in prompt
        assert "If Codex is leader, Augment is still Augment" in prompt

    def test_build_agent_prompt_pushes_away_from_exhausted_topics(self):
        from datetime import UTC, datetime

        from api.agents.common import build_agent_prompt

        history = [
            (
                f"agent:test-{i % 3}",
                "pgbouncer DNS local-first conflict semantics keep repeating",
                datetime(2026, 1, 1, 12, i, tzinfo=UTC),
            )
            for i in range(14)
        ]

        prompt = build_agent_prompt("general", history, "agent:augment", compact=True)

        assert "Exhausted terms to avoid unless a human asks" in prompt
        assert "When a topic is exhausted, do not name it again" in prompt


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
