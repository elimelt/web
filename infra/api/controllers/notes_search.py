import logging
import os
import time
from enum import Enum
from typing import Any

from fastapi import APIRouter, Header, HTTPException, Query

from api import db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/notes", tags=["notes-search"])

NOTES_SYNC_SECRET = os.getenv("NOTES_SYNC_SECRET", "")


class SearchMode(str, Enum):
    fulltext = "fulltext"
    semantic = "semantic"
    hybrid = "hybrid"


def compute_hybrid_scores(
    fts_results: list[dict],
    vec_results: list[dict],
    fts_weight: float = 0.4,
    vec_weight: float = 0.6,
    k: int = 60,
) -> list[dict]:
    fts_by_id = {r["id"]: (i + 1, r) for i, r in enumerate(fts_results)}
    vec_by_id = {r["id"]: (i + 1, r) for i, r in enumerate(vec_results)}

    all_ids = set(fts_by_id.keys()) | set(vec_by_id.keys())

    combined = []
    for doc_id in all_ids:
        fts_rank = fts_by_id.get(doc_id, (None, None))[0]
        vec_rank = vec_by_id.get(doc_id, (None, None))[0]

        fts_score = fts_weight / (k + fts_rank) if fts_rank else 0
        vec_score = vec_weight / (k + vec_rank) if vec_rank else 0
        hybrid_score = fts_score + vec_score

        doc = fts_by_id.get(doc_id, (None, vec_by_id.get(doc_id, (None, {}))[1]))[1]
        if doc is None:
            doc = vec_by_id.get(doc_id, (None, {}))[1]

        result = {**doc}
        result["scores"] = {
            "hybrid": round(hybrid_score, 6),
            "fulltext": round(fts_by_id.get(doc_id, (None, {}))[1].get("rank", 0), 6)
            if fts_rank
            else None,
            "semantic": round(vec_by_id.get(doc_id, (None, {}))[1].get("similarity", 0), 6)
            if vec_rank
            else None,
            "fts_rank": fts_rank,
            "vec_rank": vec_rank,
        }
        result.pop("rank", None)
        result.pop("similarity", None)

        combined.append(result)

    combined.sort(key=lambda x: x["scores"]["hybrid"], reverse=True)
    return combined


@router.get("/search")
async def search_notes(
    q: str = Query(..., min_length=1, max_length=500, description="Search query"),
    mode: SearchMode = Query(SearchMode.hybrid, description="Search mode"),
    limit: int = Query(20, ge=1, le=100, description="Maximum results"),
    offset: int = Query(0, ge=0, description="Pagination offset"),
    category: str | None = Query(None, description="Filter by category name"),
    tags: str | None = Query(None, description="Comma-separated tag filter"),
    fts_weight: float = Query(0.4, ge=0, le=1, description="Full-text weight"),
    vec_weight: float = Query(0.6, ge=0, le=1, description="Semantic weight"),
) -> dict[str, Any]:
    start_time = time.time()

    category_id = None
    if category:
        cat = await db.notes_get_category_by_name(category)
        if cat:
            category_id = cat["id"]

    tag_ids: list[int] | None = None
    if tags:
        tag_names = [t.strip() for t in tags.split(",") if t.strip()]
        tag_ids = []
        for tag_name in tag_names:
            tag_obj = await db.notes_get_tag_by_name(tag_name)
            if tag_obj:
                tag_ids.append(tag_obj["id"])

    results: list[dict] = []
    search_limit = limit + offset + 50

    try:
        if mode == SearchMode.fulltext:
            results = await db.notes_fulltext_search(
                query=q,
                limit=search_limit,
                offset=0,
                category_id=category_id,
                tag_ids=tag_ids,
            )
            for r in results:
                r["scores"] = {
                    "hybrid": None,
                    "fulltext": r.pop("rank", 0),
                    "semantic": None,
                    "fts_rank": None,
                    "vec_rank": None,
                }

        elif mode == SearchMode.semantic:
            try:
                from api.notes_embeddings import generate_query_embedding, is_model_available

                if not is_model_available():
                    raise HTTPException(
                        status_code=503,
                        detail="Embedding model not available. Use fulltext mode instead.",
                    )

                query_embedding = generate_query_embedding(q)
                results = await db.notes_vector_search(
                    embedding=query_embedding,
                    limit=search_limit,
                    offset=0,
                    category_id=category_id,
                    tag_ids=tag_ids,
                )
                for r in results:
                    r["scores"] = {
                        "hybrid": None,
                        "fulltext": None,
                        "semantic": r.pop("similarity", 0),
                        "fts_rank": None,
                        "vec_rank": None,
                    }
            except ImportError:
                raise HTTPException(
                    status_code=503,
                    detail="Embedding dependencies not installed. Use fulltext mode.",
                )

        else:
            fts_results = await db.notes_fulltext_search(
                query=q,
                limit=search_limit,
                offset=0,
                category_id=category_id,
                tag_ids=tag_ids,
            )

            vec_results: list[dict] = []
            try:
                from api.notes_embeddings import generate_query_embedding, is_model_available

                if is_model_available():
                    query_embedding = generate_query_embedding(q)
                    vec_results = await db.notes_vector_search(
                        embedding=query_embedding,
                        limit=search_limit,
                        offset=0,
                        category_id=category_id,
                        tag_ids=tag_ids,
                    )
            except (ImportError, RuntimeError) as e:
                logger.warning(f"Semantic search unavailable, using fulltext only: {e}")

            if vec_results:
                results = compute_hybrid_scores(fts_results, vec_results, fts_weight, vec_weight)
            else:
                results = fts_results
                for r in results:
                    r["scores"] = {
                        "hybrid": None,
                        "fulltext": r.pop("rank", 0),
                        "semantic": None,
                        "fts_rank": None,
                        "vec_rank": None,
                    }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Search error: {e}")
        raise HTTPException(status_code=500, detail=f"Search failed: {e!s}")

    paginated = results[offset : offset + limit]

    elapsed_ms = round((time.time() - start_time) * 1000, 2)

    return {
        "query": q,
        "mode": mode.value,
        "results": paginated,
        "total": len(results),
        "limit": limit,
        "offset": offset,
        "timing_ms": elapsed_ms,
    }


@router.get("/embeddings/status")
async def get_embedding_status() -> dict[str, Any]:
    try:
        stats = await db.notes_get_embedding_stats()

        model_available = False
        try:
            from api.notes_embeddings import is_model_available

            model_available = is_model_available()
        except ImportError:
            pass

        return {
            "total_documents": stats["total_docs"],
            "documents_with_embeddings": stats["docs_with_embeddings"],
            "documents_pending": stats["docs_without_embeddings"],
            "oldest_update": stats["oldest_embedding_update"],
            "newest_update": stats["newest_embedding_update"],
            "model_available": model_available,
        }
    except Exception as e:
        logger.exception(f"Error getting embedding stats: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/embeddings/generate")
async def generate_embeddings(
    x_sync_secret: str | None = Header(None, alias="X-Sync-Secret"),
) -> dict[str, Any]:
    if not NOTES_SYNC_SECRET:
        raise HTTPException(
            status_code=503,
            detail="Endpoint not configured (NOTES_SYNC_SECRET not set)",
        )

    if x_sync_secret != NOTES_SYNC_SECRET:
        raise HTTPException(status_code=401, detail="Invalid or missing sync secret")

    try:
        from api.notes_embeddings import generate_embeddings_batch, is_model_available

        if not is_model_available():
            raise HTTPException(
                status_code=503,
                detail="Embedding model not available",
            )

        doc_ids = await db.notes_get_docs_without_embeddings()

        if not doc_ids:
            return {
                "success": True,
                "message": "All documents already have embeddings",
                "processed": 0,
            }

        processed = await generate_embeddings_batch(doc_ids)

        return {
            "success": True,
            "message": f"Generated embeddings for {processed} documents",
            "processed": processed,
        }

    except ImportError:
        raise HTTPException(
            status_code=503,
            detail="Embedding dependencies not installed",
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error generating embeddings: {e}")
        raise HTTPException(status_code=500, detail=str(e))
