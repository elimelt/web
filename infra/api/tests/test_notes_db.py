from datetime import UTC, datetime
from unittest.mock import patch

import pytest


class MockAsyncCursor:
    def __init__(self, rows=None):
        self.rows = rows or []
        self._index = 0

    async def fetchone(self):
        if self.rows:
            return self.rows[0]
        return None

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self._index >= len(self.rows):
            raise StopAsyncIteration
        row = self.rows[self._index]
        self._index += 1
        return row


class MockAsyncConnection:
    def __init__(self, cursor_results=None):
        self.cursor_results = cursor_results or []
        self._call_index = 0

    async def execute(self, sql, params=None):
        if self._call_index < len(self.cursor_results):
            result = self.cursor_results[self._call_index]
            self._call_index += 1
            return MockAsyncCursor(result)
        return MockAsyncCursor([])

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass


def create_mock_connection(cursor_results=None):
    async def connect(*args, **kwargs):
        return MockAsyncConnection(cursor_results)

    return connect


class TestNotesUpsertDocument:
    @pytest.fixture
    def mock_psycopg(self):
        with patch("api.db.core.psycopg.AsyncConnection") as mock:
            yield mock

    @pytest.mark.asyncio
    async def test_insert_new_document(self, mock_psycopg):
        mock_psycopg.connect = create_mock_connection(
            [
                None,
                [(1,)],
                [(1,)],
                [],
                None,
                [(1,)],
                [],
                None,
                [(2,)],
                [],
            ]
        )

        from api.db import notes_upsert_document

        result = await notes_upsert_document(
            file_path="content/test.md",
            title="Test Document",
            category_name="Testing",
            description="A test",
            content="# Test",
            git_commit_sha="abc123",
            tags=["tag1", "tag2"],
        )

        assert result["file_path"] == "content/test.md"
        assert result["title"] == "Test Document"

    @pytest.mark.asyncio
    async def test_insert_without_category(self, mock_psycopg):
        mock_psycopg.connect = create_mock_connection(
            [
                [(1,)],
                [],
            ]
        )

        from api.db import notes_upsert_document

        result = await notes_upsert_document(
            file_path="content/test.md",
            title="Test",
            category_name=None,
            description=None,
            content="Content",
            git_commit_sha=None,
        )

        assert result["category"] is None

    @pytest.mark.asyncio
    async def test_insert_with_existing_category(self, mock_psycopg):
        mock_psycopg.connect = create_mock_connection(
            [
                [(5,)],
                [(1,)],
                [],
            ]
        )

        from api.db import notes_upsert_document

        result = await notes_upsert_document(
            file_path="content/test.md",
            title="Test",
            category_name="Existing",
            description=None,
            content="Content",
            git_commit_sha=None,
        )

        assert result is not None


class TestNotesFetchDocuments:
    @pytest.fixture
    def mock_psycopg(self):
        with patch("api.db.core.psycopg.AsyncConnection") as mock:
            yield mock

    @pytest.mark.asyncio
    async def test_fetch_all_documents(self, mock_psycopg):
        now = datetime.now(UTC)
        mock_psycopg.connect = create_mock_connection(
            [
                [(1, "content/doc1.md", "Doc 1", "Category", "Desc", now, "sha123")],
                [("tag1",), ("tag2",)],
            ]
        )

        from api.db import notes_fetch_documents

        result = await notes_fetch_documents(limit=50, offset=0)

        assert len(result) == 1
        assert result[0]["title"] == "Doc 1"
        assert result[0]["tags"] == ["tag1", "tag2"]

    @pytest.mark.asyncio
    async def test_fetch_with_category_filter(self, mock_psycopg):
        mock_psycopg.connect = create_mock_connection([[], []])

        from api.db import notes_fetch_documents

        await notes_fetch_documents(category_id=5)

    @pytest.mark.asyncio
    async def test_fetch_with_tag_filter(self, mock_psycopg):
        mock_psycopg.connect = create_mock_connection([[], []])

        from api.db import notes_fetch_documents

        await notes_fetch_documents(tag_id=3)

    @pytest.mark.asyncio
    async def test_fetch_with_pagination(self, mock_psycopg):
        mock_psycopg.connect = create_mock_connection([[], []])

        from api.db import notes_fetch_documents

        await notes_fetch_documents(limit=10, offset=20)


class TestNotesGetDocumentById:
    @pytest.fixture
    def mock_psycopg(self):
        with patch("api.db.core.psycopg.AsyncConnection") as mock:
            yield mock

    @pytest.mark.asyncio
    async def test_document_found(self, mock_psycopg):
        now = datetime.now(UTC)
        mock_psycopg.connect = create_mock_connection(
            [
                [(1, "content/test.md", "Test", "Category", "Desc", "# Content", now, "sha")],
                [("tag1",)],
            ]
        )

        from api.db import notes_get_document_by_id

        result = await notes_get_document_by_id(1)

        assert result is not None
        assert result["id"] == 1
        assert result["title"] == "Test"
        assert result["content"] == "# Content"

    @pytest.mark.asyncio
    async def test_document_not_found(self, mock_psycopg):
        mock_psycopg.connect = create_mock_connection([[]])

        from api.db import notes_get_document_by_id

        result = await notes_get_document_by_id(999)

        assert result is None


class TestNotesDeleteDocumentsNotIn:
    @pytest.fixture
    def mock_psycopg(self):
        with patch("api.db.core.psycopg.AsyncConnection") as mock:
            yield mock

    @pytest.mark.asyncio
    async def test_deletes_documents(self, mock_psycopg):
        mock_psycopg.connect = create_mock_connection(
            [
                [(1,), (2,)],
            ]
        )

        from api.db import notes_delete_documents_not_in

        result = await notes_delete_documents_not_in(["content/keep1.md", "content/keep2.md"])

        assert result == 2

    @pytest.mark.asyncio
    async def test_empty_list_returns_zero(self):
        from api.db import notes_delete_documents_not_in

        result = await notes_delete_documents_not_in([])

        assert result == 0


class TestNotesGetAllTags:
    @pytest.fixture
    def mock_psycopg(self):
        with patch("api.db.core.psycopg.AsyncConnection") as mock:
            yield mock

    @pytest.mark.asyncio
    async def test_returns_tags_with_counts(self, mock_psycopg):
        mock_psycopg.connect = create_mock_connection(
            [
                [(1, "python", 5), (2, "testing", 3)],
            ]
        )

        from api.db import notes_get_all_tags

        result = await notes_get_all_tags()

        assert len(result) == 2
        assert result[0]["name"] == "python"
        assert result[0]["document_count"] == 5

    @pytest.mark.asyncio
    async def test_returns_empty_list(self, mock_psycopg):
        mock_psycopg.connect = create_mock_connection([[]])

        from api.db import notes_get_all_tags

        result = await notes_get_all_tags()

        assert result == []


class TestNotesGetAllCategories:
    @pytest.fixture
    def mock_psycopg(self):
        with patch("api.db.core.psycopg.AsyncConnection") as mock:
            yield mock

    @pytest.mark.asyncio
    async def test_returns_categories_with_counts(self, mock_psycopg):
        mock_psycopg.connect = create_mock_connection(
            [
                [(1, "Networks", 10), (2, "Algorithms", 8)],
            ]
        )

        from api.db import notes_get_all_categories

        result = await notes_get_all_categories()

        assert len(result) == 2
        assert result[0]["name"] == "Networks"
        assert result[0]["document_count"] == 10

    @pytest.mark.asyncio
    async def test_returns_empty_list(self, mock_psycopg):
        mock_psycopg.connect = create_mock_connection([[]])

        from api.db import notes_get_all_categories

        result = await notes_get_all_categories()

        assert result == []


class TestNotesGetCategoryByName:
    @pytest.fixture
    def mock_psycopg(self):
        with patch("api.db.core.psycopg.AsyncConnection") as mock:
            yield mock

    @pytest.mark.asyncio
    async def test_category_found(self, mock_psycopg):
        mock_psycopg.connect = create_mock_connection(
            [
                [(1, "Networks")],
            ]
        )

        from api.db import notes_get_category_by_name

        result = await notes_get_category_by_name("Networks")

        assert result is not None
        assert result["id"] == 1
        assert result["name"] == "Networks"

    @pytest.mark.asyncio
    async def test_category_not_found(self, mock_psycopg):
        mock_psycopg.connect = create_mock_connection([[]])

        from api.db import notes_get_category_by_name

        result = await notes_get_category_by_name("Unknown")

        assert result is None


class TestNotesGetTagByName:
    @pytest.fixture
    def mock_psycopg(self):
        with patch("api.db.core.psycopg.AsyncConnection") as mock:
            yield mock

    @pytest.mark.asyncio
    async def test_tag_found(self, mock_psycopg):
        mock_psycopg.connect = create_mock_connection(
            [
                [(5, "python")],
            ]
        )

        from api.db import notes_get_tag_by_name

        result = await notes_get_tag_by_name("python")

        assert result is not None
        assert result["id"] == 5

    @pytest.mark.asyncio
    async def test_tag_not_found(self, mock_psycopg):
        mock_psycopg.connect = create_mock_connection([[]])

        from api.db import notes_get_tag_by_name

        result = await notes_get_tag_by_name("nonexistent")

        assert result is None


class TestNotesGetLastSyncSha:
    @pytest.fixture
    def mock_psycopg(self):
        with patch("api.db.core.psycopg.AsyncConnection") as mock:
            yield mock

    @pytest.mark.asyncio
    async def test_returns_sha(self, mock_psycopg):
        mock_psycopg.connect = create_mock_connection(
            [
                [("abc123def456",)],
            ]
        )

        from api.db import notes_get_last_sync_sha

        result = await notes_get_last_sync_sha()

        assert result == "abc123def456"

    @pytest.mark.asyncio
    async def test_returns_none_when_empty(self, mock_psycopg):
        mock_psycopg.connect = create_mock_connection([[]])

        from api.db import notes_get_last_sync_sha

        result = await notes_get_last_sync_sha()

        assert result is None


class TestNotesCountDocuments:
    @pytest.fixture
    def mock_psycopg(self):
        with patch("api.db.core.psycopg.AsyncConnection") as mock:
            yield mock

    @pytest.mark.asyncio
    async def test_count_all_documents(self, mock_psycopg):
        mock_psycopg.connect = create_mock_connection(
            [
                [(42,)],
            ]
        )

        from api.db import notes_count_documents

        result = await notes_count_documents()

        assert result == 42

    @pytest.mark.asyncio
    async def test_count_with_category_filter(self, mock_psycopg):
        mock_psycopg.connect = create_mock_connection(
            [
                [(10,)],
            ]
        )

        from api.db import notes_count_documents

        result = await notes_count_documents(category_id=5)

        assert result == 10

    @pytest.mark.asyncio
    async def test_count_with_tag_filter(self, mock_psycopg):
        mock_psycopg.connect = create_mock_connection(
            [
                [(5,)],
            ]
        )

        from api.db import notes_count_documents

        result = await notes_count_documents(tag_id=3)

        assert result == 5

    @pytest.mark.asyncio
    async def test_count_returns_zero_when_no_results(self, mock_psycopg):
        mock_psycopg.connect = create_mock_connection([[]])

        from api.db import notes_count_documents

        result = await notes_count_documents()

        assert result == 0


class TestNotesGetOrCreateCategory:
    @pytest.fixture
    def mock_psycopg(self):
        with patch("api.db.core.psycopg.AsyncConnection") as mock:
            yield mock

    @pytest.mark.asyncio
    async def test_returns_existing_category(self, mock_psycopg):
        mock_psycopg.connect = create_mock_connection(
            [
                [(5,)],
            ]
        )

        from api.db import notes_get_or_create_category

        result = await notes_get_or_create_category("Networks")

        assert result == 5

    @pytest.mark.asyncio
    async def test_creates_new_category(self, mock_psycopg):
        mock_psycopg.connect = create_mock_connection(
            [
                None,
                [(10,)],
            ]
        )

        from api.db import notes_get_or_create_category

        result = await notes_get_or_create_category("NewCategory")

        assert result == 10


class TestNotesGetOrCreateTag:
    @pytest.fixture
    def mock_psycopg(self):
        with patch("api.db.core.psycopg.AsyncConnection") as mock:
            yield mock

    @pytest.mark.asyncio
    async def test_returns_existing_tag(self, mock_psycopg):
        mock_psycopg.connect = create_mock_connection(
            [
                [(7,)],
            ]
        )

        from api.db import notes_get_or_create_tag

        result = await notes_get_or_create_tag("python")

        assert result == 7

    @pytest.mark.asyncio
    async def test_creates_new_tag(self, mock_psycopg):
        mock_psycopg.connect = create_mock_connection(
            [
                None,
                [(15,)],
            ]
        )

        from api.db import notes_get_or_create_tag

        result = await notes_get_or_create_tag("newtag")

        assert result == 15
