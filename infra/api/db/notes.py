"""Notes repository module for notes documents, tags, and categories."""

from datetime import UTC, datetime
from typing import Any

from api.db.core import _get_connection


async def _fetch_tags_for_document(conn, document_id: int) -> list[str]:
    """Fetch tag names for a document."""
    tag_rows = await conn.execute(
        "SELECT t.name FROM notes_tags t JOIN notes_document_tags dt ON t.id = dt.tag_id WHERE dt.document_id = %s",
        (document_id,),
    )
    return [t[0] async for t in tag_rows]


async def notes_get_or_create_category(name: str) -> int:
    """Get or create a category by name, returns the category id."""
    async with _get_connection() as conn:
        row = await (
            await conn.execute("SELECT id FROM notes_categories WHERE name = %s", (name,))
        ).fetchone()
        if row:
            return row[0]
        row = await (
            await conn.execute(
                "INSERT INTO notes_categories (name) VALUES (%s) RETURNING id", (name,)
            )
        ).fetchone()
        return row[0]


async def notes_get_or_create_tag(name: str) -> int:
    """Get or create a tag by name, returns the tag id."""
    async with _get_connection() as conn:
        row = await (
            await conn.execute("SELECT id FROM notes_tags WHERE name = %s", (name,))
        ).fetchone()
        if row:
            return row[0]
        row = await (
            await conn.execute("INSERT INTO notes_tags (name) VALUES (%s) RETURNING id", (name,))
        ).fetchone()
        return row[0]


async def notes_upsert_document(
    file_path: str,
    title: str,
    category_name: str | None,
    description: str | None,
    content: str,
    git_commit_sha: str | None,
    tags: list[str] | None = None,
) -> dict[str, Any]:
    """Insert or update a notes document."""
    now = datetime.now(UTC)

    async with _get_connection() as conn:
        category_id = None
        if category_name:
            cat_row = await (
                await conn.execute(
                    "SELECT id FROM notes_categories WHERE name = %s", (category_name,)
                )
            ).fetchone()
            if cat_row:
                category_id = cat_row[0]
            else:
                cat_row = await (
                    await conn.execute(
                        "INSERT INTO notes_categories (name) VALUES (%s) RETURNING id",
                        (category_name,),
                    )
                ).fetchone()
                category_id = cat_row[0]

        row = await (
            await conn.execute(
                """
            INSERT INTO notes_documents (file_path, title, category_id, description, content, last_modified, git_commit_sha, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (file_path) DO UPDATE SET
                title = EXCLUDED.title,
                category_id = EXCLUDED.category_id,
                description = EXCLUDED.description,
                content = EXCLUDED.content,
                last_modified = EXCLUDED.last_modified,
                git_commit_sha = EXCLUDED.git_commit_sha,
                updated_at = EXCLUDED.updated_at
            RETURNING id
            """,
                (
                    file_path,
                    title,
                    category_id,
                    description,
                    content,
                    now,
                    git_commit_sha,
                    now,
                    now,
                ),
            )
        ).fetchone()
        doc_id = row[0]

        await conn.execute("DELETE FROM notes_document_tags WHERE document_id = %s", (doc_id,))

        if tags:
            for tag_name in tags:
                tag_name = tag_name.strip()
                if not tag_name:
                    continue
                tag_row = await (
                    await conn.execute("SELECT id FROM notes_tags WHERE name = %s", (tag_name,))
                ).fetchone()
                if tag_row:
                    tag_id = tag_row[0]
                else:
                    tag_row = await (
                        await conn.execute(
                            "INSERT INTO notes_tags (name) VALUES (%s) RETURNING id", (tag_name,)
                        )
                    ).fetchone()
                    tag_id = tag_row[0]

                await conn.execute(
                    "INSERT INTO notes_document_tags (document_id, tag_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                    (doc_id, tag_id),
                )

        return {
            "id": doc_id,
            "file_path": file_path,
            "title": title,
            "category": category_name,
            "description": description,
            "git_commit_sha": git_commit_sha,
            "updated_at": now.isoformat(),
        }


async def notes_delete_documents_not_in(file_paths: list[str]) -> int:
    """Delete documents whose file_path is not in the provided list. Returns count deleted."""
    if not file_paths:
        return 0
    async with _get_connection() as conn:
        placeholders = ", ".join(["%s"] * len(file_paths))
        result = await conn.execute(
            f"DELETE FROM notes_documents WHERE file_path NOT IN ({placeholders}) RETURNING id",
            tuple(file_paths),
        )
        count = 0
        async for _ in result:
            count += 1
        return count


async def notes_fetch_documents(
    category_id: int | None = None,
    tag_id: int | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[dict[str, Any]]:
    """Fetch documents with optional filters, returns metadata without content."""

    clauses: list[str] = []
    params: list[Any] = []
    joins = ""

    if category_id is not None:
        clauses.append("d.category_id = %s")
        params.append(category_id)

    if tag_id is not None:
        joins = " JOIN notes_document_tags dt ON d.id = dt.document_id"
        clauses.append("dt.tag_id = %s")
        params.append(tag_id)

    where = " AND ".join(clauses) if clauses else "TRUE"

    sql = f"""
        SELECT DISTINCT d.id, d.file_path, d.title, c.name as category, d.description, d.last_modified, d.git_commit_sha
        FROM notes_documents d
        LEFT JOIN notes_categories c ON d.category_id = c.id
        {joins}
        WHERE {where}
        ORDER BY d.title ASC
        LIMIT %s OFFSET %s
    """
    params.extend([limit, offset])

    async with _get_connection() as conn:
        rows = await conn.execute(sql, tuple(params))
        result: list[dict[str, Any]] = []
        async for row in rows:
            tags = await _fetch_tags_for_document(conn, row[0])

            result.append(
                {
                    "id": row[0],
                    "file_path": row[1],
                    "title": row[2],
                    "category": row[3],
                    "description": row[4],
                    "last_modified": row[5].astimezone(UTC).isoformat() if row[5] else None,
                    "git_commit_sha": row[6],
                    "tags": tags,
                }
            )
        return result


async def notes_count_documents(
    category_id: int | None = None,
    tag_id: int | None = None,
) -> int:
    """Count documents with optional filters."""

    clauses: list[str] = []
    params: list[Any] = []
    joins = ""

    if category_id is not None:
        clauses.append("d.category_id = %s")
        params.append(category_id)

    if tag_id is not None:
        joins = " JOIN notes_document_tags dt ON d.id = dt.document_id"
        clauses.append("dt.tag_id = %s")
        params.append(tag_id)

    where = " AND ".join(clauses) if clauses else "TRUE"

    sql = f"""
        SELECT COUNT(DISTINCT d.id)
        FROM notes_documents d
        {joins}
        WHERE {where}
    """

    async with _get_connection() as conn:
        row = await (await conn.execute(sql, tuple(params))).fetchone()
        return row[0] if row else 0


async def notes_get_document_by_id(doc_id: int) -> dict[str, Any] | None:
    """Get a single document by ID, including full content."""
    async with _get_connection() as conn:
        row = await (
            await conn.execute(
                """
            SELECT d.id, d.file_path, d.title, c.name as category, d.description, d.content, d.last_modified, d.git_commit_sha
            FROM notes_documents d
            LEFT JOIN notes_categories c ON d.category_id = c.id
            WHERE d.id = %s
            """,
                (doc_id,),
            )
        ).fetchone()

        if not row:
            return None

        tags = await _fetch_tags_for_document(conn, row[0])

        return {
            "id": row[0],
            "file_path": row[1],
            "title": row[2],
            "category": row[3],
            "description": row[4],
            "content": row[5],
            "last_modified": row[6].astimezone(UTC).isoformat() if row[6] else None,
            "git_commit_sha": row[7],
            "tags": tags,
        }


async def notes_get_all_tags() -> list[dict[str, Any]]:
    """Get all tags with document counts."""
    async with _get_connection() as conn:
        rows = await conn.execute(
            """
            SELECT t.id, t.name, COUNT(dt.document_id) as doc_count
            FROM notes_tags t
            LEFT JOIN notes_document_tags dt ON t.id = dt.tag_id
            GROUP BY t.id, t.name
            ORDER BY t.name
            """
        )
        result: list[dict[str, Any]] = []
        async for row in rows:
            result.append(
                {
                    "id": row[0],
                    "name": row[1],
                    "document_count": row[2],
                }
            )
        return result


async def notes_get_all_categories() -> list[dict[str, Any]]:
    """Get all categories with document counts."""
    async with _get_connection() as conn:
        rows = await conn.execute(
            """
            SELECT c.id, c.name, COUNT(d.id) as doc_count
            FROM notes_categories c
            LEFT JOIN notes_documents d ON c.id = d.category_id
            GROUP BY c.id, c.name
            ORDER BY c.name
            """
        )
        result: list[dict[str, Any]] = []
        async for row in rows:
            result.append(
                {
                    "id": row[0],
                    "name": row[1],
                    "document_count": row[2],
                }
            )
        return result


async def notes_get_category_by_name(name: str) -> dict[str, Any] | None:
    """Get a category by name."""
    async with _get_connection() as conn:
        row = await (
            await conn.execute("SELECT id, name FROM notes_categories WHERE name = %s", (name,))
        ).fetchone()
        if not row:
            return None
        return {"id": row[0], "name": row[1]}


async def notes_get_tag_by_name(name: str) -> dict[str, Any] | None:
    """Get a tag by name."""
    async with _get_connection() as conn:
        row = await (
            await conn.execute("SELECT id, name FROM notes_tags WHERE name = %s", (name,))
        ).fetchone()
        if not row:
            return None
        return {"id": row[0], "name": row[1]}


async def notes_get_last_sync_sha() -> str | None:
    """Get the most recent git commit SHA from synced documents."""
    async with _get_connection() as conn:
        row = await (
            await conn.execute(
                "SELECT git_commit_sha FROM notes_documents WHERE git_commit_sha IS NOT NULL ORDER BY updated_at DESC LIMIT 1"
            )
        ).fetchone()
        if not row:
            return None
        return row[0]


async def notes_get_docs_without_embeddings() -> list[int]:
    """Get list of document IDs that don't have embeddings."""
    async with _get_connection() as conn:
        rows = await conn.execute(
            "SELECT id FROM notes_documents WHERE content_embedding IS NULL ORDER BY id"
        )
        return [row[0] async for row in rows]


async def notes_update_embeddings(doc_ids: list[int], embeddings: list) -> int:
    """Update embeddings for multiple documents. Returns count updated."""
    if not doc_ids or not embeddings or len(doc_ids) != len(embeddings):
        return 0
    now = datetime.now(UTC)
    updated = 0
    async with _get_connection() as conn:
        for doc_id, embedding in zip(doc_ids, embeddings, strict=False):
            vec_str = f"[{','.join(map(str, embedding))}]"
            await conn.execute(
                "UPDATE notes_documents SET content_embedding = %s::vector, embedding_updated_at = %s WHERE id = %s",
                (vec_str, now, doc_id),
            )
            updated += 1
    return updated


async def notes_get_documents_by_ids(doc_ids: list[int]) -> list[dict[str, Any]]:
    """Get full documents by their IDs."""
    if not doc_ids:
        return []
    async with _get_connection() as conn:
        placeholders = ", ".join(["%s"] * len(doc_ids))
        rows = await conn.execute(
            f"""
            SELECT d.id, d.file_path, d.title, c.name as category, d.description, d.content, d.last_modified, d.git_commit_sha
            FROM notes_documents d
            LEFT JOIN notes_categories c ON d.category_id = c.id
            WHERE d.id IN ({placeholders})
            ORDER BY d.id
            """,
            tuple(doc_ids),
        )
        result: list[dict[str, Any]] = []
        async for row in rows:
            tags = await _fetch_tags_for_document(conn, row[0])
            result.append(
                {
                    "id": row[0],
                    "file_path": row[1],
                    "title": row[2],
                    "category": row[3],
                    "description": row[4],
                    "content": row[5],
                    "last_modified": row[6].astimezone(UTC).isoformat() if row[6] else None,
                    "git_commit_sha": row[7],
                    "tags": tags,
                }
            )
        return result


async def notes_fulltext_search(
    query: str,
    limit: int = 20,
    offset: int = 0,
    category_id: int | None = None,
    tag_ids: list[int] | None = None,
) -> list[dict[str, Any]]:
    """Full-text search on notes documents using ts_rank."""
    clauses: list[str] = ["d.search_vector @@ plainto_tsquery('english', %s)"]
    params: list[Any] = [query]
    joins = ""

    if category_id is not None:
        clauses.append("d.category_id = %s")
        params.append(category_id)

    if tag_ids:
        joins = " JOIN notes_document_tags dt ON d.id = dt.document_id"
        tag_placeholders = ", ".join(["%s"] * len(tag_ids))
        clauses.append(f"dt.tag_id IN ({tag_placeholders})")
        params.extend(tag_ids)

    where = " AND ".join(clauses)

    sql = f"""
        SELECT DISTINCT d.id, d.file_path, d.title, c.name as category, d.description, d.last_modified, d.git_commit_sha,
               ts_rank(d.search_vector, plainto_tsquery('english', %s)) as rank
        FROM notes_documents d
        LEFT JOIN notes_categories c ON d.category_id = c.id
        {joins}
        WHERE {where}
        ORDER BY rank DESC
        LIMIT %s OFFSET %s
    """
    params_with_rank = [query] + params + [limit, offset]

    async with _get_connection() as conn:
        rows = await conn.execute(sql, tuple(params_with_rank))
        result: list[dict[str, Any]] = []
        async for row in rows:
            tags = await _fetch_tags_for_document(conn, row[0])
            result.append(
                {
                    "id": row[0],
                    "file_path": row[1],
                    "title": row[2],
                    "category": row[3],
                    "description": row[4],
                    "last_modified": row[5].astimezone(UTC).isoformat() if row[5] else None,
                    "git_commit_sha": row[6],
                    "rank": float(row[7]),
                    "tags": tags,
                }
            )
        return result


async def notes_vector_search(
    embedding: list[float],
    limit: int = 20,
    offset: int = 0,
    category_id: int | None = None,
    tag_ids: list[int] | None = None,
) -> list[dict[str, Any]]:
    """Vector similarity search on notes documents using cosine distance."""
    clauses: list[str] = ["d.content_embedding IS NOT NULL"]
    params: list[Any] = []
    joins = ""

    if category_id is not None:
        clauses.append("d.category_id = %s")
        params.append(category_id)

    if tag_ids:
        joins = " JOIN notes_document_tags dt ON d.id = dt.document_id"
        tag_placeholders = ", ".join(["%s"] * len(tag_ids))
        clauses.append(f"dt.tag_id IN ({tag_placeholders})")
        params.extend(tag_ids)

    where = " AND ".join(clauses)
    vec_str = f"[{','.join(map(str, embedding))}]"

    sql = f"""
        SELECT DISTINCT d.id, d.file_path, d.title, c.name as category, d.description, d.last_modified, d.git_commit_sha,
               1 - (d.content_embedding <=> %s::vector) as similarity,
               d.content_embedding <=> %s::vector as distance
        FROM notes_documents d
        LEFT JOIN notes_categories c ON d.category_id = c.id
        {joins}
        WHERE {where}
        ORDER BY distance
        LIMIT %s OFFSET %s
    """
    all_params = [vec_str, vec_str] + params + [limit, offset]

    async with _get_connection() as conn:
        rows = await conn.execute(sql, tuple(all_params))
        result: list[dict[str, Any]] = []
        async for row in rows:
            tags = await _fetch_tags_for_document(conn, row[0])
            result.append(
                {
                    "id": row[0],
                    "file_path": row[1],
                    "title": row[2],
                    "category": row[3],
                    "description": row[4],
                    "last_modified": row[5].astimezone(UTC).isoformat() if row[5] else None,
                    "git_commit_sha": row[6],
                    "similarity": float(row[7]),
                    "tags": tags,
                }
            )
        return result


async def notes_get_embedding_stats() -> dict[str, Any]:
    """Get statistics about document embeddings."""
    async with _get_connection() as conn:
        row = await (
            await conn.execute(
                """
            SELECT
                COUNT(*) as total_docs,
                COUNT(content_embedding) as docs_with_embeddings,
                COUNT(*) - COUNT(content_embedding) as docs_without_embeddings,
                MIN(embedding_updated_at) as oldest_embedding_update,
                MAX(embedding_updated_at) as newest_embedding_update
            FROM notes_documents
            """
            )
        ).fetchone()
        return {
            "total_docs": row[0],
            "docs_with_embeddings": row[1],
            "docs_without_embeddings": row[2],
            "oldest_embedding_update": row[3].astimezone(UTC).isoformat() if row[3] else None,
            "newest_embedding_update": row[4].astimezone(UTC).isoformat() if row[4] else None,
        }
