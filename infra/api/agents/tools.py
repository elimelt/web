"""Shared tools for AI agents.

This module provides tool functions that can be used by multiple agent implementations,
including notes search, document retrieval, and Python code execution.

The module provides both sync wrappers (for Augment SDK) and async versions (for Gemini).
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse

from api import db

logger = logging.getLogger("api.agents.tools")


# ============================================================================
# TOOL DEFINITIONS
# ============================================================================


@dataclass
class ToolDefinition:
    """Definition of a tool for documentation and prompt building."""

    name: str
    description: str
    parameters: dict[str, str]  # param_name -> description
    required_params: list[str]


# Tool definitions for prompt building
TOOL_DEFINITIONS: list[ToolDefinition] = [
    ToolDefinition(
        name="search_notes",
        description="Search knowledge base. Returns titles, descriptions, relevance scores.",
        parameters={
            "query": "Search query (required)",
            "mode": "'fulltext', 'semantic', or 'hybrid' (default)",
            "limit": "Max results (default 10)",
            "category": "Filter by category name",
            "tags": "Comma-separated tag names",
        },
        required_params=["query"],
    ),
    ToolDefinition(
        name="get_note",
        description="Get full content of a note by ID.",
        parameters={
            "doc_id": "Document ID from search results (required)",
        },
        required_params=["doc_id"],
    ),
    ToolDefinition(
        name="run_python",
        description="Execute Python in sandbox. Has numpy, pandas, scipy, sympy, matplotlib, scikit-learn. 30s timeout. USE THIS FREQUENTLY to verify claims, compute probabilities, simulate scenarios, or demonstrate algorithms.",
        parameters={
            "code": "Python code to run (required)",
        },
        required_params=["code"],
    ),
    ToolDefinition(
        name="fetch_url",
        description="Fetch content from a public URL. Returns plain text.",
        parameters={
            "url": "URL to fetch (required)",
            "max_bytes": "Max size (default 5000)",
        },
        required_params=["url"],
    ),
    ToolDefinition(
        name="query_chat",
        description="Search chat history by keyword.",
        parameters={
            "channel": "Channel name",
            "keyword": "Keyword filter",
            "limit": "Max messages (default 50)",
        },
        required_params=[],
    ),
]


def get_tools_description(tool_names: list[str] | None = None, compact: bool = False) -> str:
    """Get a formatted description of available tools for prompts.

    Args:
        tool_names: List of tool names to include, or None for all
        compact: Whether to use compact formatting

    Returns:
        Formatted string describing the tools
    """
    tools = TOOL_DEFINITIONS
    if tool_names:
        tools = [t for t in tools if t.name in tool_names]

    if compact:
        lines = ["**Tools:** " + ", ".join(t.name for t in tools)]
    else:
        lines = ["\n## TOOLS", "You have tools available. Use them when they'd actually help:\n"]
        for tool in tools:
            params = ", ".join(tool.parameters.keys())
            lines.append(f"- **{tool.name}({params})**: {tool.description}")
        lines.append("")
        lines.append(
            "**USE CODE TO TEST CLAIMS.** Don't say \"the complexity is O(n²)\"—write 10 lines and measure it. Don't speculate about probability—compute it. Don't describe an algorithm—implement it and show output. This catches wrong intuitions and grounds discussion in reality. Keep programs under 20 lines."
        )

    return "\n".join(lines)


def _run_async(coro: Any) -> Any:
    """Run an async coroutine from sync context."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop is not None:
        import concurrent.futures

        with concurrent.futures.ThreadPoolExecutor() as pool:
            future = pool.submit(asyncio.run, coro)
            return future.result(timeout=30)
    else:
        return asyncio.run(coro)


async def search_notes_async(
    query: str,
    mode: str = "hybrid",
    limit: int = 10,
    category: str | None = None,
    tags: str | None = None,
) -> str:
    """Search the knowledge base of notes and documentation (async version)."""
    if not query:
        return "ERROR: query parameter is required"

    search_mode = mode.lower() if mode else "hybrid"
    if search_mode not in ("fulltext", "semantic", "hybrid"):
        search_mode = "hybrid"

    result_limit = min(limit or 10, 20)

    try:
        category_id = None
        if category:
            cat = await db.notes_get_category_by_name(str(category))
            if cat:
                category_id = cat["id"]

        tag_ids: list[int] | None = None
        if tags:
            tag_names = [t.strip() for t in str(tags).split(",") if t.strip()]
            tag_ids = []
            for tag_name in tag_names:
                tag_obj = await db.notes_get_tag_by_name(tag_name)
                if tag_obj:
                    tag_ids.append(tag_obj["id"])

        results: list[dict] = []
        if search_mode == "fulltext":
            results = await db.notes_fulltext_search(
                query=query, limit=result_limit, offset=0, category_id=category_id, tag_ids=tag_ids
            )
        elif search_mode == "semantic":
            try:
                from api.notes_embeddings import generate_query_embedding, is_model_available

                if not is_model_available():
                    results = await db.notes_fulltext_search(
                        query=query,
                        limit=result_limit,
                        offset=0,
                        category_id=category_id,
                        tag_ids=tag_ids,
                    )
                else:
                    query_embedding = generate_query_embedding(query)
                    results = await db.notes_vector_search(
                        embedding=query_embedding,
                        limit=result_limit,
                        offset=0,
                        category_id=category_id,
                        tag_ids=tag_ids,
                    )
            except ImportError:
                results = await db.notes_fulltext_search(
                    query=query,
                    limit=result_limit,
                    offset=0,
                    category_id=category_id,
                    tag_ids=tag_ids,
                )
        else:
            fts_results = await db.notes_fulltext_search(
                query=query,
                limit=result_limit + 10,
                offset=0,
                category_id=category_id,
                tag_ids=tag_ids,
            )
            results = fts_results[:result_limit]

        if not results:
            return f"No notes found matching query: '{query}'"

        lines = [f"Found {len(results)} notes matching '{query}':", ""]
        for doc in results:
            doc_id = doc.get("id")
            title = doc.get("title") or "Untitled"
            cat_name = doc.get("category") or "uncategorized"
            doc_tags = doc.get("tags") or []
            description = doc.get("description") or ""
            rank = doc.get("rank")

            lines.append(f"**[{doc_id}] {title}**")
            lines.append(f"  Category: {cat_name}")
            if doc_tags:
                lines.append(f"  Tags: {', '.join(doc_tags)}")
            if description:
                lines.append(f"  {description[:200]}...")
            if rank is not None:
                lines.append(f"  Relevance: {rank:.3f}")
            lines.append("")

        lines.append("Use get_note(doc_id) to retrieve full content of any document.")
        return "\n".join(lines)[:6000]
    except Exception as e:
        logger.error("search_notes failed: %s", e)
        return f"ERROR: {e!r}"


def search_notes(
    query: str,
    mode: str = "hybrid",
    limit: int = 10,
    category: str | None = None,
    tags: str | None = None,
) -> str:
    """Search the knowledge base of notes and documentation (sync wrapper)."""
    return _run_async(search_notes_async(query, mode, limit, category, tags))


async def get_note_async(doc_id: int) -> str:
    """Retrieve the full markdown content of a specific note (async version)."""
    try:
        document = await db.notes_get_document_by_id(doc_id)
        if not document:
            return f"ERROR: Note with ID {doc_id} not found"

        title = document.get("title") or "Untitled"
        category = document.get("category") or "uncategorized"
        doc_tags = document.get("tags", [])
        content = document.get("content") or ""
        last_modified = document.get("last_modified") or "unknown"

        lines = [
            f"# {title}",
            "",
            f"**Category:** {category}",
        ]
        if doc_tags:
            lines.append(f"**Tags:** {', '.join(doc_tags)}")
        lines.append(f"**Last Modified:** {last_modified}")
        lines.append(f"**Document ID:** {doc_id}")
        lines.append("")
        lines.append("---")
        lines.append("")
        lines.append(content)

        return "\n".join(lines)[:6000]
    except Exception as e:
        logger.error("get_note failed: %s", e)
        return f"ERROR: {e!r}"


def get_note(doc_id: int) -> str:
    """Retrieve the full markdown content of a specific note (sync wrapper)."""
    return _run_async(get_note_async(doc_id))


async def run_python_async(code: str) -> str:
    """Execute Python code in a secure sandbox and return the output (async version)."""
    if not code:
        return "ERROR: code required"
    try:
        from api.sandbox import execute_python, is_sandbox_available

        if not is_sandbox_available():
            return "ERROR: Python sandbox is not available."

        result, success = await asyncio.to_thread(execute_python, code, "agent")

        if success:
            return result if result else "(no output)"
        else:
            return f"Execution failed:\n{result}"

    except ImportError:
        return "ERROR: Sandbox module not available"
    except Exception as e:
        logger.error("run_python_async failed: %s", e)
        return f"ERROR: {e!r}"


def run_python(code: str) -> str:
    """Execute Python code in a secure sandbox and return the output (sync wrapper)."""
    return _run_async(run_python_async(code))


# ============================================================================
# URL FETCH TOOL
# ============================================================================


async def fetch_url_async(url: str, max_bytes: int = 5000) -> str:
    """Fetch content from a public URL (async version)."""
    import requests

    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        return "ERROR: unsupported scheme"
    try:
        resp = await asyncio.to_thread(lambda: requests.get(url, timeout=5, stream=True))
        resp.raise_for_status()
        chunks, size = [], 0
        for chunk in resp.iter_content(chunk_size=1024):
            if size + len(chunk) > max_bytes:
                chunks.append(chunk[: max_bytes - size])
                break
            chunks.append(chunk)
            size += len(chunk)
        text = b"".join(chunks).decode("utf-8", errors="replace")
        return f"status={resp.status_code}\n{text}"
    except Exception as e:
        return f"ERROR: {e}"


def fetch_url(url: str, max_bytes: int = 5000) -> str:
    """Fetch content from a public URL (sync wrapper)."""
    return _run_async(fetch_url_async(url, max_bytes))


# ============================================================================
# CHAT QUERY TOOL
# ============================================================================


async def query_chat_async(
    channel: str = "general",
    keyword: str = "",
    limit: int = 50,
) -> str:
    """Search chat history by keyword (async version)."""
    try:
        rows = await db.fetch_chat_history(channel=channel, before_iso=None, limit=limit)
        if keyword:
            keyword_lower = keyword.lower()
            rows = [r for r in rows if keyword_lower in (r.get("text") or "").lower()]
        return json.dumps({"count": len(rows), "messages": rows[:20]})[:2000]
    except Exception as e:
        return f"ERROR: {e}"


def query_chat(
    channel: str = "general",
    keyword: str = "",
    limit: int = 50,
) -> str:
    """Search chat history by keyword (sync wrapper)."""
    return _run_async(query_chat_async(channel, keyword, limit))


# ============================================================================
# TOOL REGISTRIES
# ============================================================================

# Sync tools for Augment SDK (functions that take typed args)
SYNC_TOOLS = [search_notes, get_note, run_python]

# Async tool map for Gemini (name -> async function taking dict args)
AsyncToolFunction = Callable[[dict[str, Any]], Awaitable[str]]


async def _wrap_search_notes(args: dict[str, Any]) -> str:
    return await search_notes_async(
        query=str(args.get("query") or ""),
        mode=str(args.get("mode") or "hybrid"),
        limit=min(int(args.get("limit") or 10), 20),
    )


async def _wrap_get_note(args: dict[str, Any]) -> str:
    doc_id = args.get("doc_id")
    if doc_id is None:
        return "ERROR: doc_id required"
    return await get_note_async(int(doc_id))


async def _wrap_run_python(args: dict[str, Any]) -> str:
    return await run_python_async(str(args.get("code") or ""))


async def _wrap_fetch_url(args: dict[str, Any]) -> str:
    return await fetch_url_async(
        url=str(args.get("url") or ""),
        max_bytes=int(args.get("max_bytes") or 5000),
    )


async def _wrap_query_chat(args: dict[str, Any]) -> str:
    return await query_chat_async(
        channel=str(args.get("channel") or "general"),
        keyword=str(args.get("keyword") or ""),
        limit=int(args.get("limit") or 50),
    )


# Map of tool names to async wrapper functions
ASYNC_TOOL_MAP: dict[str, AsyncToolFunction] = {
    "tool_search_notes": _wrap_search_notes,
    "tool_get_note": _wrap_get_note,
    "tool_run_python": _wrap_run_python,
    "tool_fetch_url": _wrap_fetch_url,
    "tool_query_chat": _wrap_query_chat,
}

# Backward compatibility: keep TOOLS as an alias
TOOLS = SYNC_TOOLS
