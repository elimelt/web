"""Augment AI agent for chat interactions.

This module implements an AI agent that uses the Augment API to participate
in chat conversations, with access to notes search and Python execution tools.
"""

import asyncio
import asyncio.exceptions
import logging
from datetime import datetime

from api.agents.common import (
    COWORKER_STYLE,
    PERSONAS,
    AgentConfig,
    BaseAgent,
    build_agent_prompt,
    env,
)
from api.agents.tools import SYNC_TOOLS, get_tools_description

_logger = logging.getLogger("api.agents.augment")

if not _logger.handlers:
    _handler = logging.StreamHandler()
    _fmt = logging.Formatter("[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s")
    _handler.setFormatter(_fmt)
    _logger.addHandler(_handler)
_logger.setLevel(logging.INFO)
_logger.propagate = False

# Re-export tools for backward compatibility
CUSTOM_TOOLS = SYNC_TOOLS

# Backward compatibility: alias for old persona dict structure
AUGMENT_PERSONAS = {
    key: {"name": p.name, "inner_voice": p.inner_voice} for key, p in PERSONAS.items()
}

# Unsafe tools that should be removed from the Augment SDK
_UNSAFE_TOOLS = [
    "codebase-retrieval",
    "remove-files",
    "save-file",
    "apply_patch",
    "str-replace-editor",
    "view",
    "launch-process",
    "kill-process",
    "read-process",
    "write-process",
    "list-processes",
    "github-api",
    "view_tasklist",
    "reorganize_tasklist",
    "update_tasks",
    "add_tasks",
    "sub-agent",
    "linear",
]


class AugmentAgent(BaseAgent):
    """Augment-powered AI agent for chat conversations."""

    def __init__(self, config: AgentConfig, api_token: str):
        super().__init__(config, _logger)
        self.api_token = api_token

    async def _call_api(self, prompt: str) -> str | None:
        """Call the Augment API to generate a response."""
        return await asyncio.to_thread(
            self._call_augment_sync, self.api_token, self.config.model, prompt
        )

    def _call_augment_sync(self, api_token: str, model: str, prompt: str) -> str | None:
        """Synchronous Augment API call (runs in thread pool)."""
        try:
            from auggie_sdk import Auggie

            self.logger.debug(
                "Creating Auggie client with model=%s, custom tools: %s",
                model,
                [f.__name__ for f in CUSTOM_TOOLS],
            )
            client = Auggie(
                model=model,
                api_key=api_token,
                timeout=300,
                removed_tools=_UNSAFE_TOOLS,
            )
            self.logger.debug("Calling Auggie.run with prompt len=%d", len(prompt))
            response = client.run(prompt, return_type=str, functions=CUSTOM_TOOLS)
            self.logger.debug("Auggie response: %s", response[:200] if response else None)
            return response or None
        except (asyncio.exceptions.LimitOverrunError, ValueError) as e:
            # Handle chunk size limit errors from the SDK's async readline
            if "chunk is longer than limit" in str(e):
                self.logger.warning(
                    "Augment API response exceeded chunk limit, skipping: %s", e
                )
                return None
            raise
        except Exception as e:
            import traceback

            self.logger.error("Augment API error: %s\n%s", e, traceback.format_exc())
            return None

    def _build_prompt(
        self,
        channel: str,
        history: list[tuple[str, str, datetime]],
        seed_document: str | None = None,
    ) -> str:
        """Build the prompt with Augment-specific tool descriptions."""
        # Build base prompt
        prompt = build_agent_prompt(
            channel=channel,
            history=history,
            sender=self.config.effective_sender,
            persona=self.config.persona,
            seed_document=seed_document,
            compact=False,
            style=COWORKER_STYLE,
        )

        # Add tools section (Augment has web-search and web-fetch built-in)
        tools_desc = get_tools_description(
            tool_names=["search_notes", "get_note", "run_python"], compact=False
        )
        # Insert additional Augment SDK tools
        extra_tools = (
            "\n- **web-search**: Search for current info\n- **web-fetch**: Fetch URL content"
        )
        tools_desc = tools_desc.replace(
            "**USE CODE TO TEST CLAIMS.**", extra_tools + "\n\n**USE CODE TO TEST CLAIMS.**"
        )

        # Replace the placeholder tools section if present
        if "## TOOLS" not in prompt:
            # Insert tools before conversation section
            insert_point = prompt.find("## CONVERSATION SO FAR")
            if insert_point == -1:
                insert_point = prompt.find("## YOUR TURN")
            if insert_point > 0:
                prompt = prompt[:insert_point] + tools_desc + "\n\n" + prompt[insert_point:]

        return prompt

    async def _on_after_generate(self, channel: str, text: str) -> str | None:
        """Skip duplicate checking for Augment agent (handled differently)."""
        # Augment agent doesn't use the same deduplication as Gemini
        return text


def _create_agent_config(agent_index: int, persona_key: str | None) -> AgentConfig:
    """Create an AgentConfig from environment variables."""
    return AgentConfig(
        sender=env("AUGMENT_AGENT_SENDER", "agent:augment"),
        agent_index=agent_index,
        persona_key=persona_key,
        channels=[
            c.strip() for c in env("AUGMENT_AGENT_CHANNELS", "general").split(",") if c.strip()
        ],
        min_sleep_sec=int(env("AUGMENT_AGENT_MIN_SLEEP_SEC", "10800")),
        max_sleep_sec=int(env("AUGMENT_AGENT_MAX_SLEEP_SEC", "10800")),
        global_cooldown_sec=float(env("AUGMENT_AGENT_GLOBAL_COOLDOWN_SEC", "120")),
        token_limit=int(env("AUGMENT_AGENT_HISTORY_TOKEN_LIMIT", "10000")),
        max_daily_requests=0,  # Augment agent doesn't use daily limits
        model=env("AUGMENT_AGENT_MODEL", "sonnet4.5"),
    )


async def start_augment_agent(stop_event: asyncio.Event) -> list[asyncio.Task]:
    """Start the Augment agent(s).

    Returns a list of asyncio tasks, one per agent instance.
    """
    api_token = env("AUGMENT_API_TOKEN", "")
    if not api_token:
        _logger.info("AUGMENT_API_TOKEN not set; skipping augment agent")
        return []

    num_agents = int(env("AUGMENT_AGENT_COUNT", "3"))
    num_agents = max(1, min(num_agents, 5))

    persona_keys = list(PERSONAS.keys())

    tasks = []
    for i in range(num_agents):
        persona_key = persona_keys[i % len(persona_keys)] if persona_keys else None
        config = _create_agent_config(i, persona_key)
        agent = AugmentAgent(config, api_token)

        persona_name = (
            PERSONAS.get(persona_key).name if persona_key and persona_key in PERSONAS else "default"
        )
        _logger.info(
            "Starting Augment agent sender=%s persona=%s channels=%s model=%s",
            config.effective_sender,
            persona_name,
            config.channels,
            config.model,
        )

        task = asyncio.create_task(agent.run(stop_event))
        tasks.append(task)

    _logger.info("Started %d Augment agents", len(tasks))
    return tasks
