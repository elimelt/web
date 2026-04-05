-- Vector search and full-text search extensions
-- Note: These require the pgvector extension to be installed

-- Enable vector extension (may fail if not installed - that's OK)
DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS vector;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pgvector extension not available, skipping';
END $$;

-- Add full-text search vector column
DO $$
BEGIN
    ALTER TABLE notes_documents
    ADD COLUMN IF NOT EXISTS search_vector tsvector
    GENERATED ALWAYS AS (
        setweight(to_tsvector('english', COALESCE(title, '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(description, '')), 'B') ||
        setweight(to_tsvector('english', COALESCE(content, '')), 'C')
    ) STORED;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not add search_vector column: %', SQLERRM;
END $$;

-- Add vector embedding column
DO $$
BEGIN
    ALTER TABLE notes_documents ADD COLUMN IF NOT EXISTS content_embedding vector(384);
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not add content_embedding column: %', SQLERRM;
END $$;

-- Add embedding timestamp column
ALTER TABLE notes_documents ADD COLUMN IF NOT EXISTS embedding_updated_at TIMESTAMPTZ;

-- Create GIN index for full-text search
DO $$
BEGIN
    CREATE INDEX IF NOT EXISTS idx_notes_docs_search_vector 
    ON notes_documents USING GIN (search_vector);
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not create search_vector index: %', SQLERRM;
END $$;

-- Create HNSW index for vector similarity search
DO $$
BEGIN
    CREATE INDEX IF NOT EXISTS idx_notes_docs_embedding
    ON notes_documents USING hnsw (content_embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not create embedding index: %', SQLERRM;
END $$;

