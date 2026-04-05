"""Database module - re-exports all functions from submodules for backward compatibility."""

from api.db.core import (
    _get_connection,
    _get_dsn,
    close_pool,
    get_pool,
    get_pool_stats,
    init_pool,
)

# Backward compatibility alias
_dsn_from_env = _get_dsn

from api.db.analytics import (
    fetch_click_events,
    fetch_visitor_events_for_analytics,
    fetch_visitor_stats,
    get_visitor_analytics_summary,
    insert_click_events,
    upsert_visitor_stats,
)
from api.db.chat import (
    fetch_chat_analytics,
    fetch_chat_history,
    insert_chat_message,
    soft_delete_chat_history,
)
from api.db.events import (
    fetch_events,
    insert_event,
)
from api.db.notes import (
    notes_count_documents,
    notes_delete_documents_not_in,
    notes_fetch_documents,
    notes_fulltext_search,
    notes_get_all_categories,
    notes_get_all_tags,
    notes_get_category_by_name,
    notes_get_docs_without_embeddings,
    notes_get_document_by_id,
    notes_get_documents_by_ids,
    notes_get_embedding_stats,
    notes_get_last_sync_sha,
    notes_get_or_create_category,
    notes_get_or_create_tag,
    notes_get_tag_by_name,
    notes_update_embeddings,
    notes_upsert_document,
    notes_vector_search,
)
from api.db.sync import (
    sync_job_create,
    sync_job_get,
    sync_job_get_all_completed_paths,
    sync_job_get_failed_items,
    sync_job_get_pending_items,
    sync_job_get_resumable,
    sync_job_get_skipped_count,
    sync_job_item_delete,
    sync_job_item_reset_to_pending,
    sync_job_item_skip,
    sync_job_item_update,
    sync_job_list,
    sync_job_list_all_failed_items,
    sync_job_reset_all_failed,
    sync_job_reset_failed_items,
    sync_job_update_counts,
    sync_job_update_status,
)
from api.db.when2meet import (
    w2m_create_event,
    w2m_get_availabilities,
    w2m_get_availability,
    w2m_get_event,
    w2m_upsert_availability,
)

__all__ = [
    # Core
    "_dsn_from_env",  # Backward compatibility alias
    "_get_dsn",
    "_get_connection",
    "close_pool",
    "get_pool",
    "get_pool_stats",
    "init_pool",
    # Chat
    "fetch_chat_analytics",
    "fetch_chat_history",
    "insert_chat_message",
    "soft_delete_chat_history",
    # Events
    "fetch_events",
    "insert_event",
    # When2Meet
    "w2m_create_event",
    "w2m_get_availabilities",
    "w2m_get_availability",
    "w2m_get_event",
    "w2m_upsert_availability",
    # Analytics
    "fetch_click_events",
    "fetch_visitor_events_for_analytics",
    "fetch_visitor_stats",
    "get_visitor_analytics_summary",
    "insert_click_events",
    "upsert_visitor_stats",
    # Notes
    "notes_count_documents",
    "notes_delete_documents_not_in",
    "notes_fetch_documents",
    "notes_fulltext_search",
    "notes_get_all_categories",
    "notes_get_all_tags",
    "notes_get_category_by_name",
    "notes_get_document_by_id",
    "notes_get_documents_by_ids",
    "notes_get_docs_without_embeddings",
    "notes_get_embedding_stats",
    "notes_get_last_sync_sha",
    "notes_get_or_create_category",
    "notes_get_or_create_tag",
    "notes_get_tag_by_name",
    "notes_update_embeddings",
    "notes_upsert_document",
    "notes_vector_search",
    # Sync
    "sync_job_create",
    "sync_job_get",
    "sync_job_get_all_completed_paths",
    "sync_job_get_failed_items",
    "sync_job_get_pending_items",
    "sync_job_get_resumable",
    "sync_job_get_skipped_count",
    "sync_job_item_delete",
    "sync_job_item_reset_to_pending",
    "sync_job_item_skip",
    "sync_job_item_update",
    "sync_job_list",
    "sync_job_list_all_failed_items",
    "sync_job_reset_all_failed",
    "sync_job_reset_failed_items",
    "sync_job_update_counts",
    "sync_job_update_status",
]
