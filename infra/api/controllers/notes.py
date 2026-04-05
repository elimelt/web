import os
from typing import Any

from fastapi import APIRouter, Header, HTTPException, Query

from api import db
from api.models.notes import (
    CategoriesResponse,
    NotesByCategoryResponse,
    NotesByTagResponse,
    NotesListResponse,
    SingleNoteResponse,
    SyncJobDetailResponse,
    SyncJobsListResponse,
    TagsResponse,
)
from api.notes_sync import retry_failed_items, sync_notes_with_job

router = APIRouter(prefix="/notes", tags=["notes"])

NOTES_SYNC_SECRET = os.getenv("NOTES_SYNC_SECRET", "")


def _validate_sync_secret(x_sync_secret: str | None) -> None:
    if not NOTES_SYNC_SECRET:
        raise HTTPException(
            status_code=503,
            detail="Sync endpoint not configured (NOTES_SYNC_SECRET not set)",
        )
    if x_sync_secret != NOTES_SYNC_SECRET:
        raise HTTPException(status_code=401, detail="Invalid or missing sync secret")


@router.get("", response_model=NotesListResponse)
async def list_notes(
    limit: int = Query(50, ge=1, le=200, description="Maximum number of documents to return"),
    offset: int = Query(0, ge=0, description="Number of documents to skip"),
) -> NotesListResponse:
    documents = await db.notes_fetch_documents(limit=limit, offset=offset)
    total = await db.notes_count_documents()

    return NotesListResponse(
        documents=documents,
        total=total,
        limit=limit,
        offset=offset,
        has_more=offset + len(documents) < total,
    )


@router.get("/tags", response_model=TagsResponse)
async def list_tags() -> TagsResponse:
    tags = await db.notes_get_all_tags()
    return TagsResponse(tags=tags)


@router.get("/categories", response_model=CategoriesResponse)
async def list_categories() -> CategoriesResponse:
    categories = await db.notes_get_all_categories()
    return CategoriesResponse(categories=categories)


@router.get("/category/{category}", response_model=NotesByCategoryResponse)
async def get_notes_by_category(
    category: str,
    limit: int = Query(50, ge=1, le=200, description="Maximum number of documents to return"),
    offset: int = Query(0, ge=0, description="Number of documents to skip"),
) -> NotesByCategoryResponse:
    cat = await db.notes_get_category_by_name(category)
    if not cat:
        raise HTTPException(status_code=404, detail=f"Category '{category}' not found")

    documents = await db.notes_fetch_documents(category_id=cat["id"], limit=limit, offset=offset)
    total = await db.notes_count_documents(category_id=cat["id"])

    return NotesByCategoryResponse(
        category=category,
        documents=documents,
        total=total,
        limit=limit,
        offset=offset,
        has_more=offset + len(documents) < total,
    )


@router.get("/tags/{tag}", response_model=NotesByTagResponse)
async def get_notes_by_tag(
    tag: str,
    limit: int = Query(50, ge=1, le=200, description="Maximum number of documents to return"),
    offset: int = Query(0, ge=0, description="Number of documents to skip"),
) -> NotesByTagResponse:
    tag_obj = await db.notes_get_tag_by_name(tag)
    if not tag_obj:
        raise HTTPException(status_code=404, detail=f"Tag '{tag}' not found")

    documents = await db.notes_fetch_documents(tag_id=tag_obj["id"], limit=limit, offset=offset)
    total = await db.notes_count_documents(tag_id=tag_obj["id"])

    return NotesByTagResponse(
        tag=tag,
        documents=documents,
        total=total,
        limit=limit,
        offset=offset,
        has_more=offset + len(documents) < total,
    )


@router.get("/{doc_id:int}", response_model=SingleNoteResponse)
async def get_note(doc_id: int) -> SingleNoteResponse:
    document = await db.notes_get_document_by_id(doc_id)
    if not document:
        raise HTTPException(status_code=404, detail=f"Document with id {doc_id} not found")

    return SingleNoteResponse(document=document)


@router.get("/sync/jobs", response_model=SyncJobsListResponse)
async def list_sync_jobs(
    limit: int = Query(20, ge=1, le=100, description="Maximum number of jobs to return"),
    status: str | None = Query(None, description="Filter by job status"),
) -> SyncJobsListResponse:
    jobs = await db.sync_job_list(limit=limit, status=status)
    return SyncJobsListResponse(jobs=jobs)


@router.get("/sync/jobs/{job_id}", response_model=SyncJobDetailResponse)
async def get_sync_job(job_id: int) -> SyncJobDetailResponse:
    job = await db.sync_job_get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Sync job {job_id} not found")

    failed_items = await db.sync_job_get_failed_items(job_id)

    return SyncJobDetailResponse(
        job=job,
        failed_items=failed_items,
    )


@router.post("/sync")
async def trigger_sync(
    force: bool = Query(False, description="Force sync even if already at latest commit"),
    x_sync_secret: str | None = Header(None, alias="X-Sync-Secret"),
) -> dict[str, Any]:
    _validate_sync_secret(x_sync_secret)

    github_token = os.getenv("GITHUB_TOKEN")
    result = await sync_notes_with_job(token=github_token, force=force)

    return result


@router.post("/sync/jobs/{job_id}/resume")
async def resume_sync_job(
    job_id: int,
    x_sync_secret: str | None = Header(None, alias="X-Sync-Secret"),
) -> dict[str, Any]:
    _validate_sync_secret(x_sync_secret)

    job = await db.sync_job_get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Sync job {job_id} not found")

    if job["status"] not in ("paused", "running", "pending"):
        raise HTTPException(
            status_code=400,
            detail=f"Job cannot be resumed (status: {job['status']})",
        )

    github_token = os.getenv("GITHUB_TOKEN")
    result = await sync_notes_with_job(token=github_token, resume_job_id=job_id)

    return result


@router.post("/sync/jobs/{job_id}/retry")
async def retry_failed_job_items(
    job_id: int,
    x_sync_secret: str | None = Header(None, alias="X-Sync-Secret"),
) -> dict[str, Any]:
    _validate_sync_secret(x_sync_secret)

    job = await db.sync_job_get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Sync job {job_id} not found")

    github_token = os.getenv("GITHUB_TOKEN")
    result = await retry_failed_items(job_id, token=github_token)

    return result


@router.get("/sync/failed-items")
async def list_failed_items(
    limit: int = Query(100, ge=1, le=500, description="Maximum number of items to return"),
    job_id: int | None = Query(None, description="Filter by specific job ID"),
) -> dict[str, Any]:
    items = await db.sync_job_list_all_failed_items(limit=limit, job_id=job_id)
    return {
        "items": items,
        "total": len(items),
        "limit": limit,
    }


@router.post("/sync/items/{item_id}/reset")
async def reset_failed_item(
    item_id: int,
    x_sync_secret: str | None = Header(None, alias="X-Sync-Secret"),
) -> dict[str, Any]:
    _validate_sync_secret(x_sync_secret)

    success = await db.sync_job_item_reset_to_pending(item_id)
    if not success:
        raise HTTPException(
            status_code=404,
            detail=f"Item {item_id} not found or not in failed/skipped status",
        )

    return {
        "success": True,
        "message": f"Item {item_id} reset to pending",
        "item_id": item_id,
    }


@router.post("/sync/items/{item_id}/skip")
async def skip_failed_item(
    item_id: int,
    reason: str | None = Query(None, description="Reason for skipping"),
    x_sync_secret: str | None = Header(None, alias="X-Sync-Secret"),
) -> dict[str, Any]:
    _validate_sync_secret(x_sync_secret)

    success = await db.sync_job_item_skip(item_id, reason)
    if not success:
        raise HTTPException(
            status_code=404,
            detail=f"Item {item_id} not found or already skipped/completed",
        )

    return {
        "success": True,
        "message": f"Item {item_id} marked as skipped",
        "item_id": item_id,
        "reason": reason or "Manually skipped",
    }


@router.post("/sync/items/{item_id}/delete")
async def delete_sync_item(
    item_id: int,
    x_sync_secret: str | None = Header(None, alias="X-Sync-Secret"),
) -> dict[str, Any]:
    _validate_sync_secret(x_sync_secret)

    success = await db.sync_job_item_delete(item_id)
    if not success:
        raise HTTPException(status_code=404, detail=f"Item {item_id} not found")

    return {
        "success": True,
        "message": f"Item {item_id} deleted from sync tracking",
        "item_id": item_id,
    }


@router.post("/sync/jobs/{job_id}/reset-all-failed")
async def reset_all_failed_items(
    job_id: int,
    include_skipped: bool = Query(False, description="Also reset skipped items"),
    x_sync_secret: str | None = Header(None, alias="X-Sync-Secret"),
) -> dict[str, Any]:
    _validate_sync_secret(x_sync_secret)

    job = await db.sync_job_get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Sync job {job_id} not found")

    reset_count = await db.sync_job_reset_all_failed(job_id, include_skipped=include_skipped)

    return {
        "success": True,
        "message": f"Reset {reset_count} items to pending",
        "job_id": job_id,
        "reset_count": reset_count,
        "include_skipped": include_skipped,
    }
