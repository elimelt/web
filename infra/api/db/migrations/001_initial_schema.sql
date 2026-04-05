-- Initial schema migration
-- This captures the existing schema as of the migration system introduction

-- Chat messages table
CREATE TABLE IF NOT EXISTS chat_messages (
    id BIGSERIAL PRIMARY KEY,
    channel TEXT NOT NULL,
    sender TEXT NOT NULL,
    text TEXT NOT NULL,
    ts TIMESTAMPTZ NOT NULL,
    deleted_at TIMESTAMPTZ NULL,
    message_id TEXT NULL,
    reply_to TEXT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_channel_ts ON chat_messages (channel, ts DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ux_chat_message_id ON chat_messages (message_id) WHERE message_id IS NOT NULL;

-- Events table
CREATE TABLE IF NOT EXISTS events (
    id BIGSERIAL PRIMARY KEY,
    topic TEXT NOT NULL,
    type TEXT NOT NULL,
    ts TIMESTAMPTZ NOT NULL,
    payload JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_topic_ts ON events (topic, ts DESC);
CREATE INDEX IF NOT EXISTS idx_events_type_ts ON events (type, ts DESC);

-- When2Meet events table
CREATE TABLE IF NOT EXISTS w2m_events (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    dates JSONB NOT NULL,
    time_slots JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    creator_name TEXT
);

-- When2Meet availabilities table
CREATE TABLE IF NOT EXISTS w2m_availabilities (
    id BIGSERIAL PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES w2m_events(id) ON DELETE CASCADE,
    participant_name TEXT NOT NULL,
    available_slots JSONB NOT NULL,
    password_hash TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    UNIQUE (event_id, participant_name)
);
CREATE INDEX IF NOT EXISTS idx_w2m_avail_event ON w2m_availabilities (event_id);

-- Visitor stats table
CREATE TABLE IF NOT EXISTS visitor_stats (
    id BIGSERIAL PRIMARY KEY,
    visitor_ip TEXT NOT NULL,
    computed_at TIMESTAMPTZ NOT NULL,
    period_start TIMESTAMPTZ NOT NULL,
    period_end TIMESTAMPTZ NOT NULL,
    total_visits INTEGER NOT NULL DEFAULT 0,
    total_time_seconds DOUBLE PRECISION NOT NULL DEFAULT 0,
    avg_session_duration_seconds DOUBLE PRECISION NOT NULL DEFAULT 0,
    is_recurring BOOLEAN NOT NULL DEFAULT FALSE,
    first_visit_at TIMESTAMPTZ,
    last_visit_at TIMESTAMPTZ,
    visit_frequency_per_day DOUBLE PRECISION NOT NULL DEFAULT 0,
    location_country TEXT,
    location_city TEXT
);
CREATE INDEX IF NOT EXISTS idx_visitor_stats_ip ON visitor_stats (visitor_ip);
CREATE INDEX IF NOT EXISTS idx_visitor_stats_period ON visitor_stats (period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_visitor_stats_computed ON visitor_stats (computed_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ux_visitor_stats_ip_period
    ON visitor_stats (visitor_ip, period_start, period_end);

-- Notes categories table
CREATE TABLE IF NOT EXISTS notes_categories (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notes_categories_name ON notes_categories (name);

-- Notes documents table
CREATE TABLE IF NOT EXISTS notes_documents (
    id BIGSERIAL PRIMARY KEY,
    file_path TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    category_id BIGINT REFERENCES notes_categories(id) ON DELETE SET NULL,
    description TEXT,
    content TEXT NOT NULL,
    last_modified TIMESTAMPTZ NOT NULL,
    git_commit_sha TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notes_docs_category ON notes_documents (category_id);
CREATE INDEX IF NOT EXISTS idx_notes_docs_title ON notes_documents (title);
CREATE INDEX IF NOT EXISTS idx_notes_docs_path ON notes_documents (file_path);

-- Notes tags table
CREATE TABLE IF NOT EXISTS notes_tags (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notes_tags_name ON notes_tags (name);

-- Document-Tag junction table (many-to-many)
CREATE TABLE IF NOT EXISTS notes_document_tags (
    document_id BIGINT NOT NULL REFERENCES notes_documents(id) ON DELETE CASCADE,
    tag_id BIGINT NOT NULL REFERENCES notes_tags(id) ON DELETE CASCADE,
    PRIMARY KEY (document_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_notes_doc_tags_doc ON notes_document_tags (document_id);
CREATE INDEX IF NOT EXISTS idx_notes_doc_tags_tag ON notes_document_tags (tag_id);

-- Sync jobs table - tracks overall sync operations
CREATE TABLE IF NOT EXISTS notes_sync_jobs (
    id BIGSERIAL PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'pending',
    commit_sha TEXT,
    total_items INTEGER NOT NULL DEFAULT 0,
    completed_items INTEGER NOT NULL DEFAULT 0,
    failed_items INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    error_message TEXT,
    rate_limit_reset_at TIMESTAMPTZ,
    last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_status ON notes_sync_jobs (status);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_created ON notes_sync_jobs (created_at DESC);

-- Sync job items - tracks individual file sync status
CREATE TABLE IF NOT EXISTS notes_sync_job_items (
    id BIGSERIAL PRIMARY KEY,
    job_id BIGINT NOT NULL REFERENCES notes_sync_jobs(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    retry_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    last_attempt_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sync_items_job ON notes_sync_job_items (job_id);
CREATE INDEX IF NOT EXISTS idx_sync_items_status ON notes_sync_job_items (status);
CREATE INDEX IF NOT EXISTS idx_sync_items_job_status ON notes_sync_job_items (job_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS ux_sync_items_job_path ON notes_sync_job_items (job_id, file_path);

