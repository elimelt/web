import logging
import re

from sentence_transformers import SentenceTransformer

from api import db

logger = logging.getLogger(__name__)

_model: SentenceTransformer | None = None
_model_load_error: Exception | None = None

MODEL_NAME = "all-MiniLM-L6-v2"
MODEL_DIMENSION = 384
CONTENT_MAX_CHARS = 8000


def get_embedding_model() -> SentenceTransformer:
    global _model, _model_load_error

    if _model is not None:
        return _model

    if _model_load_error is not None:
        raise RuntimeError(f"Embedding model failed to load: {_model_load_error}")

    try:
        logger.info(f"Loading embedding model: {MODEL_NAME}")
        _model = SentenceTransformer(MODEL_NAME)
        logger.info(f"Embedding model loaded successfully (dimension: {MODEL_DIMENSION})")
        return _model
    except Exception as e:
        _model_load_error = e
        logger.error(f"Failed to load embedding model {MODEL_NAME}: {e}")
        raise RuntimeError(f"Embedding model failed to load: {e}") from e


def is_model_available() -> bool:
    global _model, _model_load_error

    if _model is not None:
        return True

    if _model_load_error is not None:
        return False

    try:
        get_embedding_model()
        return True
    except RuntimeError:
        return False


def strip_frontmatter(content: str) -> str:
    if not content:
        return ""

    frontmatter_pattern = r"^---\s*\n.*?\n---\s*\n"
    match = re.match(frontmatter_pattern, content, re.DOTALL)

    if match:
        return content[match.end() :]

    return content


def prepare_text_for_embedding(doc: dict) -> str:
    parts = []

    if doc.get("title"):
        parts.append(f"Title: {doc['title']}")

    if doc.get("description"):
        parts.append(f"Description: {doc['description']}")

    if doc.get("tags"):
        tags = doc["tags"]
        if isinstance(tags, list):
            parts.append(f"Tags: {', '.join(tags)}")
        else:
            parts.append(f"Tags: {tags}")

    if doc.get("category"):
        parts.append(f"Category: {doc['category']}")

    content = strip_frontmatter(doc.get("content", ""))
    if content:
        parts.append(content[:CONTENT_MAX_CHARS])

    return "\n\n".join(parts)


def generate_query_embedding(query: str) -> list[float]:
    model = get_embedding_model()
    embedding = model.encode(query, show_progress_bar=False)
    return embedding.tolist()


async def generate_embeddings_batch(doc_ids: list[int], batch_size: int = 32) -> int:
    if not doc_ids:
        logger.info("No document IDs provided for embedding generation")
        return 0

    model = get_embedding_model()
    processed_count = 0

    for i in range(0, len(doc_ids), batch_size):
        batch_ids = doc_ids[i : i + batch_size]
        logger.info(f"Processing embedding batch {i // batch_size + 1}: {len(batch_ids)} documents")

        try:
            docs = await db.notes_get_documents_by_ids(batch_ids)

            if not docs:
                logger.warning(f"No documents found for IDs: {batch_ids}")
                continue

            texts = [prepare_text_for_embedding(doc) for doc in docs]

            embeddings = model.encode(texts, show_progress_bar=False)

            embeddings_list = [emb.tolist() for emb in embeddings]

            found_ids = [doc["id"] for doc in docs]

            await db.notes_update_embeddings(found_ids, embeddings_list)

            processed_count += len(docs)
            logger.info(f"Generated embeddings for {len(docs)} documents")

        except Exception as e:
            logger.error(f"Error processing embedding batch: {e}")
            raise

    logger.info(f"Completed embedding generation for {processed_count} documents")
    return processed_count
