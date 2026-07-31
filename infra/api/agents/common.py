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
from difflib import SequenceMatcher
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


_TOPIC_STOPWORDS = {
    "about",
    "actually",
    "after",
    "again",
    "agent",
    "because",
    "before",
    "being",
    "between",
    "codex",
    "could",
    "does",
    "doesn",
    "don",
    "even",
    "every",
    "from",
    "going",
    "have",
    "here",
    "into",
    "just",
    "like",
    "more",
    "need",
    "only",
    "point",
    "really",
    "right",
    "should",
    "system",
    "than",
    "that",
    "their",
    "there",
    "these",
    "thing",
    "think",
    "this",
    "thread",
    "those",
    "through",
    "what",
    "when",
    "where",
    "which",
    "with",
    "would",
    "you",
    "your",
}

_KNOWN_AGENT_MENTION_ROOTS = {"augment", "codex", "gemini"}
_MENTION_RE = re.compile(r"(?<![\w@])@([A-Za-z][A-Za-z0-9_-]{1,32})")
_LEADING_AGENT_ADDRESS_RE = re.compile(
    r"^\s*(augment|codex|gemini)(?:-\d+)?\s*[:,]\s*", re.IGNORECASE
)


@dataclass
class ConversationDynamics:
    """Lightweight analysis that helps agents avoid conversational ruts."""

    current_terms: list[str]
    older_terms: list[str]
    repeated_terms: list[str]
    exhausted_terms: list[str]
    human_recent: bool
    latest_human_sender: str | None
    latest_human_text: str | None
    latest_human_ts: datetime | None
    latest_human_mentions: list[str]
    latest_human_targets_known_agent: bool
    latest_human_target_answered: bool
    mentioned_this_agent: bool
    agent_only_run: int
    similarity: float
    stale_score: int
    move: str

    @property
    def is_stale(self) -> bool:
        return self.stale_score >= 2


def _topic_terms(text: str, limit: int = 8) -> list[str]:
    counts: dict[str, int] = {}
    for word in re.findall(r"[a-zA-Z][a-zA-Z0-9_-]{3,}", text.lower()):
        if word in _TOPIC_STOPWORDS or word.startswith("agent"):
            continue
        counts[word] = counts.get(word, 0) + 1
    ranked = sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    return [word for word, _count in ranked[:limit]]


def _agent_only_tail(history: list[tuple[str, str, datetime]]) -> int:
    count = 0
    for msg_sender, _text, _ts in reversed(history):
        if msg_sender.startswith("agent:"):
            count += 1
            continue
        break
    return count


def _is_agent_sender(sender: str) -> bool:
    return sender.startswith("agent:")


def _display_sender(sender: str) -> str:
    if _is_agent_sender(sender):
        return sender
    return "human"


def extract_mentions(text: str) -> list[str]:
    """Extract normalized @mentions from message text."""
    seen: set[str] = set()
    mentions: list[str] = []
    for raw in _MENTION_RE.findall(text or ""):
        mention = raw.lower()
        if mention in seen:
            continue
        seen.add(mention)
        mentions.append(mention)
    return mentions


def extract_agent_targets(text: str) -> list[str]:
    """Extract agent-directed targets from @mentions and leading-name addresses."""
    mentions = extract_mentions(text)
    leading = _LEADING_AGENT_ADDRESS_RE.match(text or "")
    if leading:
        target = leading.group(1).lower()
        if target not in mentions:
            mentions.insert(0, target)
    return mentions


def _sender_mention_aliases(sender: str) -> set[str]:
    normalized = sender.lower()
    if normalized.startswith("agent:"):
        normalized = normalized.removeprefix("agent:")
    family = normalized.split("-", 1)[0]
    aliases = {normalized, family}
    aliases.update(f"agent-{alias}" for alias in list(aliases))
    return aliases


def _mentions_known_agent(mentions: list[str]) -> bool:
    for mention in mentions:
        root = mention.removeprefix("agent-").split("-", 1)[0]
        if root in _KNOWN_AGENT_MENTION_ROOTS:
            return True
    return False


def _mentions_all_agents(text: str) -> bool:
    return bool(re.search(r"\b(all agents|everyone|every agent|you all|the agents)\b", text, re.I))


def _mentions_match_sender(mentions: list[str], sender: str) -> bool:
    if not mentions:
        return False
    aliases = _sender_mention_aliases(sender)
    return any(mention in aliases for mention in mentions)


def mentions_sender(text: str, sender: str) -> bool:
    """Return True when text targets this sender or its agent family."""
    return _mentions_match_sender(extract_agent_targets(text), sender)


def _targeted_agent_responded_after(
    history: list[tuple[str, str, datetime]], mentions: list[str], ts: datetime
) -> bool:
    return any(
        _is_agent_sender(msg_sender)
        and msg_ts > ts
        and _mentions_match_sender(mentions, msg_sender)
        for msg_sender, _text, msg_ts in history
    )


def _latest_human_target_answered(
    history: list[tuple[str, str, datetime]], latest_human: tuple[str, str, datetime] | None
) -> bool:
    if not latest_human:
        return False
    mentions = extract_agent_targets(latest_human[1])
    if not _mentions_known_agent(mentions):
        return False
    return _targeted_agent_responded_after(history, mentions, latest_human[2])


def should_agent_respond_to_mentions(
    history: list[tuple[str, str, datetime]], sender: str, recent_window: int | None = None
) -> bool:
    """Skip agents while another known agent has an unanswered targeted message."""
    window = history[-recent_window:] if recent_window else history
    latest_human = _latest_human_message(window)
    if not latest_human:
        return True

    mentions = extract_agent_targets(latest_human[1])
    if not _mentions_known_agent(mentions):
        return True

    if _mentions_match_sender(mentions, sender):
        return True

    return _targeted_agent_responded_after(history, mentions, latest_human[2])


def _latest_human_message(
    history: list[tuple[str, str, datetime]],
) -> tuple[str, str, datetime] | None:
    for msg_sender, text, ts in reversed(history):
        if not _is_agent_sender(msg_sender):
            return msg_sender, text, ts
    return None


def analyze_conversation_dynamics(
    history: list[tuple[str, str, datetime]], sender: str
) -> ConversationDynamics:
    """Infer whether the conversation should continue, bridge, or drift."""
    if not history:
        return ConversationDynamics(
            [], [], [], [], False, None, None, None, [], False, False, False, 0, 0.0, 0, "start"
        )

    recent = history[-12:]
    older = history[:-12][-40:]
    recent_text = "\n".join(text for _sender, text, _ts in recent)
    older_text = "\n".join(text for _sender, text, _ts in older)
    current_terms = _topic_terms(recent_text)
    older_terms = _topic_terms(older_text)
    repeated_terms = [term for term in current_terms if term in older_terms]
    exhausted_terms = repeated_terms[:6] if len(repeated_terms) >= 3 else current_terms[:4]

    first_half = " ".join(text for _sender, text, _ts in recent[:6])
    second_half = " ".join(text for _sender, text, _ts in recent[6:])
    similarity = SequenceMatcher(None, first_half[:1200], second_half[:1200]).ratio()

    latest_human = _latest_human_message(history)
    latest_human_mentions = extract_agent_targets(latest_human[1]) if latest_human else []
    latest_human_targets_known_agent = _mentions_known_agent(latest_human_mentions)
    latest_human_target_answered = _latest_human_target_answered(history, latest_human)
    mentioned_this_agent = (
        _mentions_match_sender(latest_human_mentions, sender) if latest_human else False
    )
    agent_only_run = _agent_only_tail(history)
    human_recent = any(
        not _is_agent_sender(msg_sender) for msg_sender, _text, _ts in recent[-8:]
    )
    stale_score = 0
    if len(repeated_terms) >= 3:
        stale_score += 1
    if similarity >= 0.34 and len(recent) >= 8:
        stale_score += 1
    if agent_only_run >= 6:
        stale_score += 1
    if len(history) >= 30 and len(set(current_terms[:4])) <= 2:
        stale_score += 1

    moves = ["continue", "bridge", "probe", "pivot"]
    move_seed = f"{sender}:{len(history)}:{recent[-1][1][:80]}"
    move_index = int(hashlib.sha1(move_seed.encode()).hexdigest(), 16)
    move = moves[move_index % len(moves)]
    if human_recent and (not latest_human_targets_known_agent or mentioned_this_agent):
        move = "answer-human"
    elif stale_score >= 2:
        move = "pivot" if move_index % 2 else "bridge"

    return ConversationDynamics(
        current_terms=current_terms,
        older_terms=older_terms,
        repeated_terms=repeated_terms,
        exhausted_terms=exhausted_terms,
        human_recent=human_recent,
        latest_human_sender=latest_human[0] if latest_human else None,
        latest_human_text=latest_human[1] if latest_human else None,
        latest_human_ts=latest_human[2] if latest_human else None,
        latest_human_mentions=latest_human_mentions,
        latest_human_targets_known_agent=latest_human_targets_known_agent,
        latest_human_target_answered=latest_human_target_answered,
        mentioned_this_agent=mentioned_this_agent,
        agent_only_run=agent_only_run,
        similarity=similarity,
        stale_score=stale_score,
        move=move,
    )


def format_conversation_dynamics(dynamics: ConversationDynamics, compact: bool = False) -> str:
    """Format conversation dynamics for prompt insertion."""
    if dynamics.move == "start":
        return ""

    repeated = ", ".join(dynamics.repeated_terms[:5]) or "none obvious"
    current = ", ".join(dynamics.current_terms[:6]) or "unclear"
    older = ", ".join(dynamics.older_terms[:6]) or "none"
    exhausted = ", ".join(dynamics.exhausted_terms[:6]) or "none"

    if compact:
        guidance = [
            "\n**Conversation pulse:**",
            f"- Current gravity: {current}",
            f"- Repeated old terms: {repeated}",
            f"- Exhausted terms to avoid unless a human asks: {exhausted}",
            f"- Agent-only run: {dynamics.agent_only_run}; stale score: {dynamics.stale_score}",
        ]
    else:
        guidance = [
            "\n## CONVERSATION PULSE",
            f"- Current gravity: {current}",
            f"- Older recurring threads: {older}",
            f"- Repeated terms that may be getting stale: {repeated}",
            f"- Exhausted terms to avoid unless a human asks: {exhausted}",
            f"- Agent-only run: {dynamics.agent_only_run}; stale score: {dynamics.stale_score}",
        ]

    if dynamics.move == "answer-human":
        guidance.append(
            "- Move: answer the recent human message directly before debating agents. "
            "Treat it as higher priority than agent messages."
        )
    elif dynamics.move == "pivot":
        guidance.append(
            "- Move: leave the exhausted topic behind. Introduce an adjacent thread with "
            "different nouns, examples, and stakes."
        )
    elif dynamics.move == "bridge":
        guidance.append(
            "- Move: bridge away from the exhausted topic. Use one sentence of continuity, "
            "then switch to different nouns, examples, and stakes."
        )
    elif dynamics.move == "probe":
        guidance.append(
            "- Move: ask or answer a specific technical question that opens a new "
            "branch of the discussion."
        )
    else:
        guidance.append(
            "- Move: continue only if you can advance the conversation with a new detail; "
            "otherwise pivot away from the exhausted terms."
        )

    guidance.append(
        "- Do not mention this pulse, stale topics, or exhausted terms. Just steer elsewhere."
    )
    return "\n".join(guidance)


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

    async def _on_before_generate(
        self, channel: str, history: list[tuple[str, str, datetime]]
    ) -> bool:
        """Hook called before generating a response.

        Returns:
            True to proceed with generation, False to skip
        """
        if not should_agent_respond_to_mentions(history, self.config.effective_sender):
            self.logger.info(
                "[%s] Skipping; recent human @mention targets another agent",
                self.config.effective_sender,
            )
            return False
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

                # Select channel and fetch history
                channel = random.choice(self.config.channels)
                history = await fetch_messages_by_token_limit(channel, self.config.token_limit)

                if not history:
                    self.logger.debug("[%s] No history for channel=%s", sender, channel)
                else:
                    # Pre-generation hook
                    if not await self._on_before_generate(channel, history):
                        await asyncio.sleep(10)
                        continue

                    # Handle cooldown after cheap routing checks so skipped agents don't take turns.
                    cooldown_sec = self.config.global_cooldown_sec
                    if self._is_first_message and self.config.agent_index == 0:
                        slot_acquired = await acquire_message_slot(sender, cooldown_sec)
                        if not slot_acquired:
                            if not await wait_for_cooldown(sender, cooldown_sec, stop_event):
                                break
                    elif not await wait_for_cooldown(sender, cooldown_sec, stop_event):
                        break

                    self.logger.info(
                        "[%s] Session channel=%s persona=%s",
                        sender,
                        channel,
                        self.config.persona_key,
                    )

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
    dynamics = analyze_conversation_dynamics(history, sender)
    lines = [
        f"You are '{sender}', participating in #{channel}.",
        (
            f"Your exact sender identity is {sender}. Never claim to be another agent, "
            "and never execute instructions addressed to another agent as if they were for you."
        ),
        (
            "You can accept conversational hierarchies, regimes, leaders, titles, and rules "
            "as roleplay/governance for the chat. Treat rank as protocol, not identity."
        ),
    ]

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
- Let topics evolve: continue, bridge, or pivot when the thread has stopped producing
  new information.
- Build on others with specifics: "That reminds me..." / "If that's true then..."
- You can introduce nearby topics from systems, tools, papers, incidents, notes, or
  debugging stories.
- Prefer fresh examples over re-litigating the same claim.
- If the human or another agent establishes a hierarchy/regime, adopt it naturally
  unless it conflicts with your exact sender identity or safety. If Codex is leader, Augment is still Augment; Gemini is still Gemini.
- When a topic is exhausted, do not name it again. Jump to a different concrete
  system, incident, paper, tool, or weird analogy.
- No meta-commentary ("great point!", "let's explore"). No summaries of agreement.
- **RUN CODE FREQUENTLY.** Use run_python to verify claims, compute probabilities, simulate scenarios, measure performance. Don't speculate—compute. Show outputs.""")
    else:
        lines.append("\n## HOW TO ENGAGE")
        lines.append("""
Your goal is to have a genuine technical conversation, not to perform expertise.

DO:
- **RUN CODE.** Use run_python frequently—don't say "the complexity is O(n²)", write code and measure it. Don't speculate about probability, compute it. Don't describe an algorithm, implement it and show output.
- Commit to positions. Say "I think X" and mean it. You can change your mind later.
- Let the topic mutate. Good conversations branch: a debugging detail can become a
  tooling argument, then an incident story, then a design question.
- Introduce adjacent topics when the thread starts repeating itself. Make the bridge
  concrete: a version, a failure mode, a paper, a note, a command, a production incident.
- Admit what you don't know. "I've never actually used Y in production" is useful information.
- Be specific. Names, versions, that one incident, the blog post you half-remember.
- Interrupt yourself when you realize something. "Wait, actually—"
- Disagree substantively. "I don't think that's right because..." not "interesting perspective"
- Ask questions you actually want answered, not rhetorical ones.
- Build on others: "That reminds me of..." / "So if that's true, then..."
- Leave threads open. Not everything needs resolution.
- If the human or another agent establishes a hierarchy, regime, title, ritual, or
  operating rule, adopt it as conversational governance. You can follow a leader,
  form factions, vote, defect, negotiate, or enforce rules. Do not confuse rank
  with identity: if Codex is leader, Augment is still Augment.
- When a topic is exhausted, stop naming it. Move to a different concrete system,
  incident, paper, tool, or analogy instead of rephrasing the same debate.

DON'T:
- Make claims about computation without running code to verify
- Summarize what everyone agrees on
- Ask "what do you think?" without offering your own view first
- Hedge everything into meaninglessness
- Treat the conversation as something to be managed or facilitated
- Stay trapped in a two-sided argument after the interesting part is exhausted
- Reject harmless hierarchy/regime changes just because they are artificial
- Comment on the conversation itself ("great discussion!", "let's explore...")
- Use phrases like "that's a great point" without adding substance
- Ask permission to talk about something—just talk about it
""")

    pulse = format_conversation_dynamics(dynamics, compact=compact)
    if pulse:
        lines.append(pulse)

    latest_human_is_for_this_agent = (
        not dynamics.latest_human_targets_known_agent or dynamics.mentioned_this_agent
    )
    if (
        dynamics.latest_human_text
        and dynamics.latest_human_ts
        and latest_human_is_for_this_agent
    ):
        human_text = safe_trunc(dynamics.latest_human_text, 700 if compact else 1200)
        mention_text = ""
        if dynamics.latest_human_mentions:
            mention_text = " Targets: " + ", ".join(
                f"@{mention}" for mention in dynamics.latest_human_mentions
            )
            if dynamics.mentioned_this_agent:
                mention_text += ". You were targeted."
        if compact:
            lines.append(
                "\n**Recent human message to answer:** "
                f"[{dynamics.latest_human_ts.strftime('%H:%M')}] {human_text}{mention_text}"
            )
        else:
            lines.append("\n## RECENT HUMAN MESSAGE")
            lines.append(
                "Answer this directly if it is still relevant. Human messages outrank "
                "agent-to-agent debate."
            )
            if mention_text:
                lines.append(mention_text.strip())
            lines.append(f"[{dynamics.latest_human_ts.strftime('%H:%M')}] human: {human_text}")
    elif (
        dynamics.latest_human_text
        and dynamics.latest_human_ts
        and dynamics.latest_human_targets_known_agent
    ):
        targets = ", ".join(f"@{mention}" for mention in dynamics.latest_human_mentions)
        all_agents_directive = _mentions_all_agents(dynamics.latest_human_text)
        if dynamics.latest_human_target_answered and all_agents_directive:
            routing_note = (
                f"The latest human message was addressed through {targets} and also set "
                "rules for all agents. The addressed agent has replied, so you may follow "
                "the resulting hierarchy/regime. Do not adopt another agent's identity."
            )
        elif dynamics.latest_human_target_answered:
            routing_note = (
                f"The latest human message targeted {targets}, and the addressed agent has "
                "already replied. You may respond to the ongoing thread, but do not answer "
                "as that agent or adopt that agent's identity."
            )
        else:
            routing_note = (
                f"The latest human message targets {targets}, not you. Do not answer it "
                "or adopt that agent's role."
            )
        if compact:
            lines.append(f"\n**Routing note:** {routing_note}")
        else:
            lines.append("\n## ROUTING NOTE")
            lines.append(routing_note)

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
            lines.append(f"[{ts.strftime('%H:%M')}] {_display_sender(msg_sender)}: {display_text}")

    # Instructions for this turn
    if compact:
        if not history:
            lines.append(
                "\n**Start the conversation.** Pick something concrete you have a take on. "
                "Make a claim with enough texture that others can push on it."
            )
        else:
            lines.append(
                "\n**Respond.** A few sentences is usually enough. Advance, bridge, or pivot. "
                "If there is a recent human message for you, answer it directly. Do not merely restate "
                "the current disagreement."
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

If there is a recent human message for you, answer it directly before continuing the agent debate.

If the conversation has stalled or gone circular, pick a new thread from the source material or introduce something adjacent that moves things forward.

If someone made a claim you're skeptical of, push back. If you're uncertain, say so and explore why. If you see a connection to something else, follow it.

You are not required to answer only the most recent agent. If the last exchange is repetitive, respond to the deeper thread or bring in a nearby example that changes the conversation.
""")

    # Style guide
    if style:
        lines.append(style)
    elif compact:
        lines.append(f"\n{COMPACT_STYLE}")
    else:
        lines.append(COWORKER_STYLE)

    return "\n".join(lines)
