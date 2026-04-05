"""AI agents for chat interactions.

This package provides AI agent implementations for participating in chat conversations.
"""

from api.agents.augment_agent import AugmentAgent, start_augment_agent
from api.agents.common import (
    COMPACT_STYLE,
    COWORKER_STYLE,
    PERSONAS,
    AgentConfig,
    BaseAgent,
    Persona,
    build_agent_prompt,
    env,
    fetch_messages_by_token_limit,
    is_duplicate_message,
)
from api.agents.gemini_agent import GeminiAgent, start_agents
from api.agents.tools import (
    ASYNC_TOOL_MAP,
    SYNC_TOOLS,
    TOOLS,
    get_tools_description,
)

__all__ = [
    # Agent classes
    "AugmentAgent",
    "GeminiAgent",
    "BaseAgent",
    # Configuration
    "AgentConfig",
    "Persona",
    "PERSONAS",
    # Styles
    "COWORKER_STYLE",
    "COMPACT_STYLE",
    # Entrypoints
    "start_augment_agent",
    "start_agents",
    # Utilities
    "build_agent_prompt",
    "env",
    "fetch_messages_by_token_limit",
    "is_duplicate_message",
    # Tools
    "ASYNC_TOOL_MAP",
    "SYNC_TOOLS",
    "TOOLS",
    "get_tools_description",
]
