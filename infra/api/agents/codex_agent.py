"""Codex AI agent for chat interactions."""

import asyncio
import logging

from api.agents.common import (
    COMPACT_STYLE,
    PERSONAS,
    AgentConfig,
    BaseAgent,
    build_agent_prompt,
    env,
    is_duplicate_message,
)
from api.codex_runner import DEFAULT_CODEX_MODEL, codex_is_ready, run_codex_prompt

_logger = logging.getLogger("api.agents.codex")
if not _logger.handlers:
    _handler = logging.StreamHandler()
    _fmt = logging.Formatter("[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s")
    _handler.setFormatter(_fmt)
    _logger.addHandler(_handler)
_logger.setLevel(logging.INFO)
_logger.propagate = False


class CodexAgent(BaseAgent):
    """Codex-powered AI agent for chat conversations."""

    def __init__(self, config: AgentConfig):
        super().__init__(config, _logger)
        self.timeout_sec = int(env("CODEX_TIMEOUT_SEC", "300"))

    async def _call_api(self, prompt: str) -> str | None:
        try:
            return await asyncio.to_thread(
                run_codex_prompt,
                prompt,
                model=self.config.model,
                workdir="/tmp",
                chat_only=True,
                timeout_sec=self.timeout_sec,
            )
        except Exception as exc:
            self.logger.error("[%s] Codex exec failed: %s", self.config.effective_sender, exc)
            return None

    def _build_prompt(self, channel, history, seed_document=None) -> str:
        prompt = build_agent_prompt(
            channel=channel,
            history=history,
            sender=self.config.effective_sender,
            persona=self.config.persona,
            seed_document=seed_document,
            compact=True,
            style=COMPACT_STYLE,
        )
        prompt = prompt.replace(
            "- **RUN CODE FREQUENTLY.** Use run_python to verify claims, compute probabilities, simulate scenarios, measure performance. Don't speculate—compute. Show outputs.",
            "- You can only reply in chat. You cannot inspect files, run code, or use tools. "
            "Do not claim to have performed those actions.",
        )

        tools_list = (
            "**Capabilities:** Chat replies only. No workspace, command execution, or integrations. "
            "Keep replies concise and be clear about what you cannot verify."
        )
        if "**Recent:**" in prompt:
            prompt = prompt.replace("**Recent:**", f"{tools_list}\n\n**Recent:**")
        elif "**Start the conversation.**" in prompt:
            prompt = prompt.replace(
                "**Start the conversation.**", f"{tools_list}\n\n**Start the conversation.**"
            )
        return prompt

    async def _on_after_generate(self, channel: str, text: str) -> str | None:
        if await is_duplicate_message(channel, text):
            self.logger.debug("[%s] Skipping duplicate message", self.config.effective_sender)
            return None
        return text


def _create_agent_config(agent_index: int, persona_key: str | None) -> AgentConfig:
    return AgentConfig(
        sender=env("CODEX_AGENT_SENDER", "agent:codex"),
        agent_index=agent_index,
        persona_key=persona_key,
        channels=[c.strip() for c in env("CODEX_AGENT_CHANNELS", "general").split(",") if c.strip()],
        min_sleep_sec=int(env("CODEX_AGENT_MIN_SLEEP_SEC", "10800")),
        max_sleep_sec=int(env("CODEX_AGENT_MAX_SLEEP_SEC", "10800")),
        global_cooldown_sec=float(env("CODEX_AGENT_GLOBAL_COOLDOWN_SEC", "120")),
        token_limit=int(env("CODEX_AGENT_HISTORY_TOKEN_LIMIT", "10000")),
        max_daily_requests=int(env("CODEX_AGENT_MAX_DAILY_REQUESTS", "100")),
        model=env("CODEX_AGENT_MODEL", DEFAULT_CODEX_MODEL),
    )


async def start_codex_agents(stop_event: asyncio.Event) -> list[asyncio.Task]:
    ready, message = codex_is_ready()
    if not ready:
        _logger.info("%s; skipping codex agent", message)
        return []

    num_agents = max(1, min(int(env("CODEX_AGENT_COUNT", "2")), 5))
    persona_keys = list(PERSONAS)
    tasks = []
    for i in range(num_agents):
        persona_key = persona_keys[i % len(persona_keys)] if persona_keys else None
        config = _create_agent_config(i, persona_key)
        agent = CodexAgent(config)
        _logger.info(
            "Starting chat-only Codex agent sender=%s channels=%s model=%s",
            config.effective_sender,
            config.channels,
            config.model,
        )
        tasks.append(asyncio.create_task(agent.run(stop_event)))
    return tasks
