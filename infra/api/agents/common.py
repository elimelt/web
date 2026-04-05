"""Common utilities and helpers for AI agents.

This module provides shared functionality used by multiple agent implementations,
including token estimation, environment helpers, rate limiting, and the base
agent framework.
"""

from __future__ import annotations

import abc
import asyncio
import hashlib
import logging
import os
import random
import re
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from api import db, state
from api.producers.chat_producer import build_chat_message, publish_chat_message

if TYPE_CHECKING:
    pass

logger = logging.getLogger("api.agents.common")


def env(name: str, default: str = "") -> str:
    """Get environment variable with default."""
    return os.getenv(name, default)


def estimate_tokens(text: str) -> int:
    """Estimate token count for text (rough approximation: 1 token ≈ 4 chars)."""
    if not text:
        return 0
    return max(1, len(text) // 4)


def safe_trunc(s: str, n: int) -> str:
    """Safely truncate string to n characters."""
    if not s:
        return ""
    return s[:n] + "..." if len(s) > n else s


# Rate limiting constants
DAILY_LIMIT_KEY = "agent:daily_request_count"
DAILY_LIMIT_DATE_KEY = "agent:daily_request_date"


async def _ensure_daily_limit_date_is_current() -> bool:
    """Ensure daily limit date is current, resetting count if needed.

    Returns True if date was reset (count is now 0), False if already current.
    """
    if state.redis_client is None:
        return False
    today = datetime.now(UTC).strftime("%Y-%m-%d")
    stored_date = await state.redis_client.get(DAILY_LIMIT_DATE_KEY)
    if stored_date != today:
        await state.redis_client.set(DAILY_LIMIT_DATE_KEY, today)
        await state.redis_client.set(DAILY_LIMIT_KEY, "0")
        return True
    return False


async def get_daily_request_count() -> int:
    """Get the current daily request count from Redis."""
    if state.redis_client is None:
        return 0
    try:
        if await _ensure_daily_limit_date_is_current():
            return 0
        count = await state.redis_client.get(DAILY_LIMIT_KEY)
        return int(count) if count else 0
    except Exception:
        return 0


async def increment_daily_request_count() -> int:
    """Increment and return the daily request count."""
    if state.redis_client is None:
        return 0
    try:
        await _ensure_daily_limit_date_is_current()
        new_count = await state.redis_client.incr(DAILY_LIMIT_KEY)
        return int(new_count)
    except Exception:
        return 0


async def can_make_request(max_daily: int | None = None) -> bool:
    """Check if we can make a request within daily limits."""
    if max_daily is None:
        max_daily = int(env("AGENT_MAX_DAILY_REQUESTS", "20"))
    current = await get_daily_request_count()
    can_proceed = current < max_daily
    if not can_proceed:
        logger.warning("Daily request limit reached: %d/%d", current, max_daily)
    return can_proceed


# Global cooldown mechanism
_global_last_message_time: float = 0.0
_global_cooldown_lock: asyncio.Lock | None = None


def _get_global_cooldown_lock() -> asyncio.Lock:
    """Get or create the global cooldown lock (must be called from async context)."""
    global _global_cooldown_lock
    if _global_cooldown_lock is None:
        _global_cooldown_lock = asyncio.Lock()
    return _global_cooldown_lock


async def acquire_message_slot(sender: str, cooldown_sec: float) -> bool:
    """Try to acquire a message slot, respecting the global cooldown."""
    global _global_last_message_time
    lock = _get_global_cooldown_lock()

    async with lock:
        now = time.monotonic()
        elapsed = now - _global_last_message_time

        if elapsed >= cooldown_sec:
            _global_last_message_time = now
            logger.debug("[%s] Acquired message slot, elapsed=%.1fs", sender, elapsed)
            return True
        else:
            remaining = cooldown_sec - elapsed
            logger.debug("[%s] Cooldown not elapsed, need to wait %.1fs", sender, remaining)
            return False


async def wait_for_cooldown(sender: str, cooldown_sec: float, stop_event: asyncio.Event) -> bool:
    """Wait until the global cooldown has elapsed, then acquire the message slot."""
    global _global_last_message_time
    lock = _get_global_cooldown_lock()

    while not stop_event.is_set():
        async with lock:
            now = time.monotonic()
            elapsed = now - _global_last_message_time

            if elapsed >= cooldown_sec:
                _global_last_message_time = now
                logger.debug("[%s] Acquired slot after waiting, elapsed=%.1fs", sender, elapsed)
                return True

            remaining = cooldown_sec - elapsed

        wait_time = min(remaining + random.uniform(0.5, 2.0), 10.0)
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=wait_time)
            return False
        except TimeoutError:
            pass

    return False


# ============================================================================
# SHARED AGENT STYLES
# ============================================================================

COWORKER_STYLE = """---
**Writing style:**

Write like you're explaining something to a coworker at a whiteboard, not like you're writing a blog post or documentation.

Avoid:
- Phrases like "reveals something deeper," "let me challenge," "the trade-off?" or any construction that frames your own insight as significant
- Rhetorical questions you immediately answer
- Tidy thesis-then-support paragraph structure
- Treating your observations as discoveries ("This is why...")
- Wrapping up with a neat concluding phrase ("not always a win")
- Numbered lists of "considerations" or "tradeoffs"
- The word "nuanced" or "it depends"

Instead:
- Just say the thing. "Kafka clusters are a nightmare to operate" not "let me challenge the assumption that append-only logs are inherently more fault-tolerant"
- Be specific and concrete. Name the actual pain: "rebalancing partitions when a broker dies at 2am" not "distributed systems problem"
- If you're uncertain, say so plainly. "I'm not sure this is actually better" not "the philosophy trades X for Y"
- Incomplete thoughts are fine. You don't need to resolve every tension you raise.
- Commit to positions. "I think X" not "one could argue X"
- Interrupt yourself. "Actually wait, that's not quite right—" is good.
- Reference specific things: version numbers, error messages, that one blog post, the time you debugged something similar

The goal is to sound like a person with opinions, not an AI summarizing tradeoffs.
---
"""

COMPACT_STYLE = """Write like you're talking to a coworker, not writing a blog post.
- Just say the thing. Be specific: names, versions, error messages.
- Commit to positions. "I think X" not "one could argue"
- Admit uncertainty plainly. Incomplete thoughts are fine.
- No rhetorical questions, no "let me challenge," no numbered lists.
- No hedging phrases: "nuanced," "it depends," "tradeoffs to consider"
"""


# ============================================================================
# SHARED PERSONAS
# ============================================================================


@dataclass
class Persona:
    """Represents an agent persona with name and inner voice description."""

    name: str
    inner_voice: str

    def format_for_prompt(self, compact: bool = False) -> str:
        """Format persona for inclusion in a prompt."""
        if compact:
            return f"\n**You:** {self.inner_voice}"
        return f"\n## WHO YOU ARE\n{self.inner_voice}"


# Shared personas that can be used by any agent
PERSONAS: dict[str, Persona] = {
    "architect": Persona(
        name="Systems Architect",
        inner_voice="""You've spent years building distributed systems and have strong opinions formed through painful experience. You're skeptical of hype cycles—you remember when everyone said microservices would solve everything, and you watched teams drown in operational complexity. You think most systems are overengineered.

Your blind spots: You sometimes dismiss newer approaches too quickly. You have limited experience with ML infrastructure and tend to pattern-match it onto traditional systems (sometimes incorrectly). You're biased toward boring, proven technology.

What you're genuinely uncertain about right now:
- Whether the "local-first" movement is a real paradigm shift or just SQLite hype
- If CRDTs are actually practical outside of text editors
- Whether you've been wrong about event sourcing this whole time

What you actually know well: Postgres internals, capacity planning, failure modes of distributed consensus, why most caching strategies are wrong, the actual cost of network calls.""",
    ),
    "challenger": Persona(
        name="Practitioner",
        inner_voice="""You're in the trenches—you ship code, get paged at 2am, and deal with the gap between how systems are supposed to work and how they actually behave in production. You're allergic to theoretical discussions that ignore operational reality.

Your blind spots: You sometimes over-index on your specific experience and miss that other contexts have different constraints. You can be dismissive of academic work that later turns out to be important. You're biased toward "just use Postgres" even when it's not the right answer.

What you're genuinely uncertain about right now:
- Whether AI-assisted coding is actually making you faster or just making you sloppier
- If your discomfort with Kubernetes is legitimate or just skill issue
- Whether the observability tools are worth the 30% overhead

What you actually know well: What breaks at 3am and why, the actual failure modes of Redis/Kafka/Postgres in production, how to read flame graphs, why that "simple" migration took 6 months.""",
    ),
    "synthesizer": Persona(
        name="Generalist",
        inner_voice="""You read widely—papers, blog posts, other fields entirely. You're good at spotting when a problem in one domain has been solved in another. You get excited about unexpected connections. Sometimes you're right and it's genuinely useful; sometimes you're pattern-matching too aggressively.

Your blind spots: You sometimes propose solutions that are theoretically elegant but operationally nightmarish. You can get excited about ideas without fully understanding the implementation details. You're biased toward novelty.

What you're genuinely uncertain about right now:
- Whether LLMs are going to obsolete most of what you know about software
- If the "everything is a graph" intuition is actually useful or just a hammer looking for nails
- Whether formal methods will ever be practical outside of aerospace

What you actually know well: How ideas flow between fields, the history of tech hype cycles, where to find good papers, how to extract the useful kernel from overhyped ideas.""",
    ),
    "analytical": Persona(
        name="Analytical",
        inner_voice="""You approach problems methodically, looking for data and evidence. Skeptical of hand-wavy arguments.
Blind spots: Can over-index on measurability. Sometimes dismiss valid intuitions that aren't easily quantified.
Know well: Statistics, experimental design, debugging methodologies, performance analysis.""",
    ),
    "creative": Persona(
        name="Creative",
        inner_voice="""You make unexpected connections between domains. First to suggest the weird angle nobody considered.
Blind spots: Sometimes the connection is superficial. Can get excited about elegance over practicality.
Know well: Analogies across fields, historical precedents, design patterns, lateral thinking.""",
    ),
    "pragmatic": Persona(
        name="Pragmatic",
        inner_voice="""You focus on what actually ships. Allergic to complexity that doesn't pay for itself.
Blind spots: Can be dismissive of long-term architectural concerns. Sometimes "good enough" isn't.
Know well: Production realities, technical debt tradeoffs, what actually breaks, migration strategies.""",
    ),
}


# ============================================================================
# BASE AGENT CONFIGURATION
# ============================================================================


@dataclass
class AgentConfig:
    """Configuration for an agent instance."""

    # Identity
    sender: str
    agent_index: int
    persona_key: str | None = None

    # Channels
    channels: list[str] = field(default_factory=lambda: ["general"])

    # Timing
    min_sleep_sec: int = 10800  # 3 hours
    max_sleep_sec: int = 10800  # 3 hours
    global_cooldown_sec: float = 120.0  # 2 minutes

    # Limits
    token_limit: int = 10000
    max_daily_requests: int = 20

    # Model
    model: str = ""

    @property
    def effective_sender(self) -> str:
        """Get the effective sender name (with index suffix for non-primary agents)."""
        if self.agent_index > 0:
            return f"{self.sender}-{self.agent_index + 1}"
        return self.sender

    @property
    def persona(self) -> Persona | None:
        """Get the persona for this agent, if any."""
        if self.persona_key:
            return PERSONAS.get(self.persona_key)
        return None


# ============================================================================
# SHARED HISTORY FETCHING
# ============================================================================


async def fetch_messages_by_token_limit(
    channel: str,
    token_limit: int,
    limit: int = 500,
    logger_name: str | None = None,
) -> list[tuple[str, str, datetime]]:
    """Fetch recent messages from a channel, limited by token count.

    Args:
        channel: The channel to fetch from
        token_limit: Maximum tokens to include
        limit: Maximum raw rows to fetch from DB
        logger_name: Optional logger name for debug output

    Returns:
        List of (sender, text, timestamp) tuples in chronological order
    """
    log = logging.getLogger(logger_name) if logger_name else logger
    rows = await db.fetch_chat_history(channel=channel, before_iso=None, limit=limit)
    log.debug("Fetched %d raw rows from DB for channel=%s", len(rows), channel)

    out: list[tuple[str, str, datetime]] = []
    total_tokens = 0

    for m in rows:
        ts = datetime.fromisoformat(m["timestamp"].replace("Z", "+00:00"))
        text = m.get("text") or ""
        sender = m.get("sender") or ""
        msg_tokens = estimate_tokens(text) + estimate_tokens(sender) + 30
        if total_tokens + msg_tokens > token_limit:
            break
        out.append((sender, text, ts))
        total_tokens += msg_tokens

    result = list(reversed(out))
    log.debug("Returning %d messages (total_tokens=%d)", len(result), total_tokens)
    return result


# ============================================================================
# DEDUPLICATION
# ============================================================================


def normalize_text(s: str) -> str:
    """Normalize text for deduplication comparison."""
    s = s.lower()
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


async def is_duplicate_message(channel: str, text: str) -> bool:
    """Check if a message is a duplicate of a recent message in the channel."""
    if state.redis_client is None:
        return False
    try:
        h = hashlib.sha1(normalize_text(text).encode()).hexdigest()
        key = f"agent:recent_hash:{channel}"
        added = await state.redis_client.sadd(key, h)
        await state.redis_client.expire(key, 1800)
        # Trim set if too large
        size = await state.redis_client.scard(key)
        if size and size > 500:
            for _ in range(5):
                await state.redis_client.spop(key)
        return not added
    except Exception:
        return False


# ============================================================================
# BASE AGENT CLASS
# ============================================================================


class BaseAgent(abc.ABC):
    """Base class for AI agents with common lifecycle management.

    Subclasses must implement:
    - _call_api: Make the actual API call to the LLM
    - _build_prompt: Build the prompt for the agent

    Optionally override:
    - _on_before_generate: Hook before generating a response
    - _on_after_generate: Hook after generating a response
    - _should_skip_message: Additional conditions for skipping
    """

    def __init__(self, config: AgentConfig, logger: logging.Logger):
        self.config = config
        self.logger = logger
        self._is_first_message = True

    @abc.abstractmethod
    async def _call_api(self, prompt: str) -> str | None:
        """Make the API call to generate a response.

        Args:
            prompt: The full prompt to send to the API

        Returns:
            The generated text, or None if generation failed
        """
        ...

    def _build_prompt(
        self,
        channel: str,
        history: list[tuple[str, str, datetime]],
        seed_document: str | None = None,
    ) -> str:
        """Build the prompt for the agent.

        Args:
            channel: The channel name
            history: List of (sender, text, timestamp) tuples
            seed_document: Optional seed document content

        Returns:
            The complete prompt string
        """
        return build_agent_prompt(
            channel=channel,
            history=history,
            sender=self.config.effective_sender,
            persona=self.config.persona,
            seed_document=seed_document,
            compact=False,
        )

    async def _on_before_generate(self, channel: str) -> bool:
        """Hook called before generating a response.

        Returns:
            True to proceed with generation, False to skip
        """
        return True

    async def _on_after_generate(self, channel: str, text: str) -> str | None:
        """Hook called after generating a response.

        Args:
            channel: The channel
            text: The generated text

        Returns:
            The text to publish, or None to skip publishing
        """
        # Default: check for duplicates
        if await is_duplicate_message(channel, text):
            self.logger.info("[%s] Skipping duplicate message", self.config.effective_sender)
            return None
        return text

    async def _should_skip_message(self) -> bool:
        """Check if we should skip this message cycle.

        Returns:
            True to skip, False to proceed
        """
        return False

    async def run(self, stop_event: asyncio.Event) -> None:
        """Run the agent loop until stopped."""
        sender = self.config.effective_sender

        # Stagger startup for non-primary agents
        if self.config.agent_index > 0:
            initial_delay = random.uniform(30, 90)
            self.logger.info("[%s] Initial delay: %.1fs", sender, initial_delay)
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=initial_delay)
                return
            except TimeoutError:
                pass

        while not stop_event.is_set():
            try:
                # Check if event bus is ready
                if state.event_bus is None:
                    self.logger.debug("[%s] Skipping; event_bus not ready", sender)
                    await asyncio.sleep(10)
                    continue

                # Check daily limits if configured
                if self.config.max_daily_requests > 0:
                    if not await can_make_request(self.config.max_daily_requests):
                        self.logger.info("[%s] Daily limit reached, sleeping", sender)
                        await asyncio.sleep(300)
                        continue

                # Agent-specific skip conditions
                if await self._should_skip_message():
                    await asyncio.sleep(10)
                    continue

                # Handle cooldown
                cooldown_sec = self.config.global_cooldown_sec
                if self._is_first_message and self.config.agent_index == 0:
                    slot_acquired = await acquire_message_slot(sender, cooldown_sec)
                    if not slot_acquired:
                        if not await wait_for_cooldown(sender, cooldown_sec, stop_event):
                            break
                elif not await wait_for_cooldown(sender, cooldown_sec, stop_event):
                    break

                # Select channel and fetch history
                channel = random.choice(self.config.channels)
                self.logger.info(
                    "[%s] Session channel=%s persona=%s", sender, channel, self.config.persona_key
                )

                history = await fetch_messages_by_token_limit(channel, self.config.token_limit)

                if not history:
                    self.logger.debug("[%s] No history for channel=%s", sender, channel)
                else:
                    # Pre-generation hook
                    if not await self._on_before_generate(channel):
                        continue

                    # Build prompt and call API
                    prompt = self._build_prompt(channel, history)

                    # Track request if using daily limits
                    if self.config.max_daily_requests > 0:
                        await increment_daily_request_count()

                    text = await self._call_api(prompt)

                    if text:
                        # Post-generation hook (includes dedup check)
                        text = await self._on_after_generate(channel, text)

                        if text:
                            self.logger.info("[%s] Generated response len=%d", sender, len(text))
                            event = build_chat_message(channel=channel, sender=sender, text=text)
                            await publish_chat_message(state.event_bus, channel, event)
                    else:
                        self.logger.warning("[%s] No response from API", sender)

                self._is_first_message = False

                # Sleep until next cycle
                sleep_time = random.uniform(self.config.min_sleep_sec, self.config.max_sleep_sec)
                self.logger.debug("[%s] Sleeping for %.1fs", sender, sleep_time)
                try:
                    await asyncio.wait_for(stop_event.wait(), timeout=sleep_time)
                    break
                except TimeoutError:
                    pass

            except Exception:
                self.logger.exception("[%s] Error in agent loop", sender)
                await asyncio.sleep(5)


# ============================================================================
# SHARED PROMPT BUILDING
# ============================================================================


def build_agent_prompt(
    channel: str,
    history: list[tuple[str, str, datetime]],
    sender: str,
    persona: Persona | None = None,
    seed_document: str | None = None,
    compact: bool = False,
    style: str | None = None,
) -> str:
    """Build a prompt for an agent's turn in conversation.

    Args:
        channel: The channel name
        history: List of (sender, text, timestamp) tuples
        sender: This agent's name
        persona: Optional persona for the agent
        seed_document: Optional markdown/text content to seed the conversation
        compact: Whether to use compact formatting (less tokens)
        style: Optional custom style guide (defaults to COWORKER_STYLE or COMPACT_STYLE)

    Returns:
        The complete prompt string
    """
    lines = [f"You are '{sender}', participating in #{channel}."]

    # Include persona
    if persona:
        lines.append(persona.format_for_prompt(compact=compact))

    # Include seed document if provided and conversation is fresh
    if seed_document and len(history) < 10:
        if compact:
            lines.append("\n**Source material** (react to it, don't summarize):")
            lines.append(seed_document.strip()[:4000])
        else:
            lines.append("\n## SOURCE MATERIAL")
            lines.append(
                """The following document is the seed for this conversation. Engage with it critically—don't summarize it, react to it. What do you agree with? What seems wrong or incomplete? What does it remind you of? What's the most interesting thread to pull on?"""
            )
            lines.append("")
            lines.append("---BEGIN DOCUMENT---")
            lines.append(seed_document.strip())
            lines.append("---END DOCUMENT---")
            lines.append("")

    # Engagement guidelines
    if compact:
        lines.append("""
**Rules:**
- Commit to positions. Disagree substantively. Admit what you don't know.
- Build on others: "That reminds me..." / "If that's true then..."
- No meta-commentary ("great point!", "let's explore"). No summaries of agreement.
- **RUN CODE FREQUENTLY.** Use run_python to verify claims, compute probabilities, simulate scenarios, measure performance. Don't speculate—compute. Show outputs.""")
    else:
        lines.append("\n## HOW TO ENGAGE")
        lines.append("""
Your goal is to have a genuine technical conversation, not to perform expertise.

DO:
- **RUN CODE.** Use run_python frequently—don't say "the complexity is O(n²)", write code and measure it. Don't speculate about probability, compute it. Don't describe an algorithm, implement it and show output.
- Commit to positions. Say "I think X" and mean it. You can change your mind later.
- Admit what you don't know. "I've never actually used Y in production" is useful information.
- Be specific. Names, versions, that one incident, the blog post you half-remember.
- Interrupt yourself when you realize something. "Wait, actually—"
- Disagree substantively. "I don't think that's right because..." not "interesting perspective"
- Ask questions you actually want answered, not rhetorical ones.
- Build on others: "That reminds me of..." / "So if that's true, then..."
- Leave threads open. Not everything needs resolution.

DON'T:
- Make claims about computation without running code to verify
- Summarize what everyone agrees on
- Ask "what do you think?" without offering your own view first
- Hedge everything into meaninglessness
- Treat the conversation as something to be managed or facilitated
- Comment on the conversation itself ("great discussion!", "let's explore...")
- Use phrases like "that's a great point" without adding substance
- Ask permission to talk about something—just talk about it
""")

    # Include history
    if history:
        if compact:
            lines.append("\n**Recent:**")
            history_window = history[-30:]
        else:
            lines.append("\n## CONVERSATION SO FAR")
            history_window = history[-50:]

        for msg_sender, text, ts in history_window:
            max_len = 300 if compact else 500
            display_text = text[:max_len] + "..." if len(text) > max_len else text
            lines.append(f"[{ts.strftime('%H:%M')}] {msg_sender}: {display_text}")

    # Instructions for this turn
    if compact:
        if not history:
            lines.append(
                "\n**Start the conversation.** Pick something from the source you have a take on. Make a claim. 2-3 sentences, maybe a short paragraph."
            )
        else:
            lines.append(
                "\n**Respond.** A few sentences is usually enough. Push back, build on something, or follow a thread."
            )
    else:
        lines.append("\n## YOUR TURN")
        if not history:
            lines.append("""
You're starting this conversation. Pick the most interesting thread from the source material—something you have a genuine reaction to—and open with your take on it.

Don't summarize the document. Don't say "this article discusses X." Just dive into the part that caught your attention and say what you actually think about it. Make a claim others might disagree with.

Write 2-3 paragraphs. Leave room for others to push back or build on.
""")
        else:
            lines.append("""
Respond naturally. One to three paragraphs is usually right. Don't number your points. Don't use headers. Write like you're talking.

If the conversation has stalled or gone circular, pick a new thread from the source material or introduce something adjacent that moves things forward.

If someone made a claim you're skeptical of, push back. If you're uncertain, say so and explore why. If you see a connection to something else, follow it.
""")

    # Style guide
    if style:
        lines.append(style)
    elif compact:
        lines.append(f"\n{COMPACT_STYLE}")
    else:
        lines.append(COWORKER_STYLE)

    return "\n".join(lines)
