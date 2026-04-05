"""Gemini AI agent for chat interactions."""

import asyncio
import logging
from datetime import datetime

from google import genai
from google.genai import types
from google.genai.errors import APIError

from api.agents.common import (
    COMPACT_STYLE,
    PERSONAS,
    AgentConfig,
    BaseAgent,
    build_agent_prompt,
    env,
    is_duplicate_message,
)
from api.agents.tools import ASYNC_TOOL_MAP

_logger = logging.getLogger("api.agents.gemini")
if not _logger.handlers:
    _handler = logging.StreamHandler()
    _fmt = logging.Formatter("[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s")
    _handler.setFormatter(_fmt)
    _logger.addHandler(_handler)
_logger.setLevel(logging.INFO)
_logger.propagate = False


# ============================================================================
# GEMINI TOOL DECLARATIONS
# ============================================================================

TOOL_DECLARATIONS = [
    types.Tool(
        function_declarations=[
            types.FunctionDeclaration(
                name="tool_fetch_url",
                description="Fetch content from a public URL. Returns plain text.",
                parameters=types.Schema(
                    type=types.Type.OBJECT,
                    properties={
                        "url": types.Schema(type=types.Type.STRING, description="URL to fetch"),
                        "max_bytes": types.Schema(
                            type=types.Type.INTEGER, description="Max size (default 5000)"
                        ),
                    },
                    required=["url"],
                ),
            )
        ]
    ),
    types.Tool(
        function_declarations=[
            types.FunctionDeclaration(
                name="tool_search_notes",
                description="Search knowledge base. Returns titles, descriptions, relevance scores.",
                parameters=types.Schema(
                    type=types.Type.OBJECT,
                    properties={
                        "query": types.Schema(type=types.Type.STRING, description="Search query"),
                        "mode": types.Schema(
                            type=types.Type.STRING,
                            description="'fulltext', 'semantic', or 'hybrid' (default)",
                        ),
                        "limit": types.Schema(
                            type=types.Type.INTEGER, description="Max results (default 10)"
                        ),
                    },
                    required=["query"],
                ),
            )
        ]
    ),
    types.Tool(
        function_declarations=[
            types.FunctionDeclaration(
                name="tool_get_note",
                description="Get full content of a note by ID.",
                parameters=types.Schema(
                    type=types.Type.OBJECT,
                    properties={
                        "doc_id": types.Schema(
                            type=types.Type.INTEGER, description="Document ID from search results"
                        ),
                    },
                    required=["doc_id"],
                ),
            )
        ]
    ),
    types.Tool(
        function_declarations=[
            types.FunctionDeclaration(
                name="tool_run_python",
                description="Execute Python in sandbox. Has numpy, pandas, scipy, matplotlib. 30s timeout.",
                parameters=types.Schema(
                    type=types.Type.OBJECT,
                    properties={
                        "code": types.Schema(
                            type=types.Type.STRING, description="Python code to run"
                        ),
                    },
                    required=["code"],
                ),
            )
        ]
    ),
    types.Tool(
        function_declarations=[
            types.FunctionDeclaration(
                name="tool_query_chat",
                description="Search chat history by keyword.",
                parameters=types.Schema(
                    type=types.Type.OBJECT,
                    properties={
                        "channel": types.Schema(type=types.Type.STRING, description="Channel name"),
                        "keyword": types.Schema(
                            type=types.Type.STRING, description="Keyword filter"
                        ),
                        "limit": types.Schema(
                            type=types.Type.INTEGER, description="Max messages (default 50)"
                        ),
                    },
                ),
            )
        ]
    ),
]


# ============================================================================
# GEMINI CLIENT
# ============================================================================

_client: genai.Client | None = None


def _get_client() -> genai.Client:
    """Get or create the Gemini client (singleton)."""
    global _client
    if _client is None:
        api_key = env("GEMINI_API_KEY", "")
        if not api_key:
            raise ValueError("GEMINI_API_KEY required")
        _client = genai.Client(api_key=api_key)
    return _client


# ============================================================================
# GEMINI AGENT CLASS
# ============================================================================


class GeminiAgent(BaseAgent):
    """Gemini-powered AI agent for chat conversations."""

    def __init__(self, config: AgentConfig):
        super().__init__(config, _logger)

    async def _call_api(self, prompt: str) -> str | None:
        """Call the Gemini API to generate a response with tool support."""
        contents = [types.Content(role="user", parts=[types.Part(text=prompt)])]
        config = types.GenerateContentConfig(tools=TOOL_DECLARATIONS)

        max_retries = 3
        response = None

        for attempt in range(max_retries):
            try:
                response = await asyncio.to_thread(
                    _get_client().models.generate_content,
                    model=self.config.model,
                    contents=contents,
                    config=config,
                )
                break
            except APIError as e:
                if hasattr(e, "code") and e.code == 429:
                    delay = min(30 * (2**attempt), 300)
                    self.logger.warning(
                        "[%s] Rate limited, retry in %ds", self.config.effective_sender, delay
                    )
                    await asyncio.sleep(delay)
                    continue
                self.logger.error("[%s] API error: %s", self.config.effective_sender, e)
                return None
            except Exception as e:
                self.logger.error("[%s] Unexpected error: %s", self.config.effective_sender, e)
                return None

        if response is None:
            return None

        # Handle tool calls
        if response.function_calls:
            tool_results = []
            for call in response.function_calls:
                func = ASYNC_TOOL_MAP.get(call.name)
                if func:
                    try:
                        result = await func(dict(call.args))
                    except Exception as e:
                        result = f"ERROR: {e}"
                else:
                    result = f"ERROR: Unknown tool {call.name}"
                tool_results.append(
                    types.Part(
                        function_response=types.FunctionResponse(
                            name=call.name,
                            response={"result": result},
                        )
                    )
                )

            contents.append(response.candidates[0].content)
            contents.append(types.Content(role="tool", parts=tool_results))

            try:
                response = await asyncio.to_thread(
                    _get_client().models.generate_content,
                    model=self.config.model,
                    contents=contents,
                    config=config,
                )
            except Exception as e:
                self.logger.error("[%s] Second call failed: %s", self.config.effective_sender, e)
                return None

        if response.candidates:
            for part in response.candidates[0].content.parts:
                if part.text:
                    return part.text.strip()
        return None

    def _build_prompt(
        self,
        channel: str,
        history: list[tuple[str, str, datetime]],
        seed_document: str | None = None,
    ) -> str:
        """Build the prompt with Gemini-specific compact style."""
        # Build base prompt with compact style
        prompt = build_agent_prompt(
            channel=channel,
            history=history,
            sender=self.config.effective_sender,
            persona=self.config.persona,
            seed_document=seed_document,
            compact=True,
            style=COMPACT_STYLE,
        )

        # Add compact tools list
        tools_list = "**Tools:** tool_fetch_url, tool_search_notes, tool_get_note, tool_run_python, tool_query_chat"

        # Insert tools before conversation section
        if "**Recent:**" in prompt:
            prompt = prompt.replace("**Recent:**", f"{tools_list}\n\n**Recent:**")
        elif "**Start the conversation.**" in prompt:
            prompt = prompt.replace(
                "**Start the conversation.**", f"{tools_list}\n\n**Start the conversation.**"
            )

        return prompt

    async def _on_after_generate(self, channel: str, text: str) -> str | None:
        """Check for duplicate messages before publishing."""
        if await is_duplicate_message(channel, text):
            self.logger.debug("[%s] Skipping duplicate message", self.config.effective_sender)
            return None
        return text


def _create_agent_config(agent_index: int, persona_key: str | None) -> AgentConfig:
    """Create an AgentConfig from environment variables."""
    return AgentConfig(
        sender=env("GEMINI_AGENT_SENDER", "agent:gemini"),
        agent_index=agent_index,
        persona_key=persona_key,
        channels=[
            c.strip() for c in env("GEMINI_AGENT_CHANNELS", "general").split(",") if c.strip()
        ],
        min_sleep_sec=int(env("GEMINI_AGENT_MIN_SLEEP_SEC", "10800")),
        max_sleep_sec=int(env("GEMINI_AGENT_MAX_SLEEP_SEC", "10800")),
        global_cooldown_sec=float(env("GEMINI_AGENT_GLOBAL_COOLDOWN_SEC", "120")),
        token_limit=int(env("GEMINI_AGENT_HISTORY_TOKEN_LIMIT", "10000")),
        max_daily_requests=int(env("GEMINI_AGENT_MAX_DAILY_REQUESTS", "100")),
        model=env("GEMINI_AGENT_MODEL", "gemini-2.5-flash"),
    )


# ============================================================================
# ENTRYPOINT
# ============================================================================


async def start_agents(stop_event: asyncio.Event) -> list[asyncio.Task]:
    """Start the Gemini agent(s).

    Returns a list of asyncio tasks, one per agent instance.
    """
    api_key = env("GEMINI_API_KEY", "")
    if not api_key:
        _logger.info("GEMINI_API_KEY not set; skipping gemini agent")
        return []

    num_agents = int(env("GEMINI_AGENT_COUNT", "3"))
    num_agents = max(1, min(num_agents, 5))
    persona_keys = list(PERSONAS.keys())

    tasks = []
    for i in range(num_agents):
        persona_key = persona_keys[i % len(persona_keys)] if persona_keys else None
        config = _create_agent_config(i, persona_key)
        agent = GeminiAgent(config)

        persona_name = (
            PERSONAS.get(persona_key).name if persona_key and persona_key in PERSONAS else "default"
        )
        _logger.info(
            "Starting Gemini agent sender=%s persona=%s channels=%s model=%s",
            config.effective_sender,
            persona_name,
            config.channels,
            config.model,
        )

        task = asyncio.create_task(agent.run(stop_event))
        tasks.append(task)

    _logger.info("Started %d Gemini agents", len(tasks))
    return tasks
