from unittest.mock import AsyncMock, patch

import pytest

from api.controllers.notes import (
    get_note,
    get_notes_by_category,
    get_notes_by_tag,
    list_categories,
    list_notes,
    list_tags,
    trigger_sync,
)


def _make_doc(id: int, title: str = "Test Doc", file_path: str = "/test/path.md") -> dict:
    """Helper to create a valid document mock."""
    return {
        "id": id,
        "file_path": file_path,
        "title": title,
        "category": None,
        "description": None,
        "last_modified": None,
        "git_commit_sha": None,
        "tags": [],
    }


def _make_doc_with_content(
    id: int, title: str = "Test Doc", file_path: str = "/test/path.md", content: str = "# Content"
) -> dict:
    """Helper to create a valid document mock with content."""
    doc = _make_doc(id, title, file_path)
    doc["content"] = content
    return doc


class TestListNotes:
    @pytest.fixture
    def mock_db(self):
        with patch("api.controllers.notes.db") as mock:
            yield mock

    @pytest.mark.asyncio
    async def test_default_pagination(self, mock_db):
        mock_db.notes_fetch_documents = AsyncMock(
            return_value=[
                _make_doc(1, "Doc 1"),
                _make_doc(2, "Doc 2"),
            ]
        )
        mock_db.notes_count_documents = AsyncMock(return_value=2)

        result = await list_notes(limit=50, offset=0)

        assert result.total == 2
        assert len(result.documents) == 2
        assert result.limit == 50
        assert result.offset == 0
        assert result.has_more is False

    @pytest.mark.asyncio
    async def test_custom_pagination(self, mock_db):
        mock_db.notes_fetch_documents = AsyncMock(return_value=[_make_doc(2, "Doc 2")])
        mock_db.notes_count_documents = AsyncMock(return_value=10)

        result = await list_notes(limit=1, offset=1)

        assert result.limit == 1
        assert result.offset == 1
        assert result.has_more is True
        mock_db.notes_fetch_documents.assert_called_with(limit=1, offset=1)

    @pytest.mark.asyncio
    async def test_empty_results(self, mock_db):
        mock_db.notes_fetch_documents = AsyncMock(return_value=[])
        mock_db.notes_count_documents = AsyncMock(return_value=0)

        result = await list_notes(limit=50, offset=0)

        assert result.documents == []
        assert result.total == 0
        assert result.has_more is False


class TestGetNote:
    @pytest.fixture
    def mock_db(self):
        with patch("api.controllers.notes.db") as mock:
            yield mock

    @pytest.mark.asyncio
    async def test_valid_id(self, mock_db):
        mock_db.notes_get_document_by_id = AsyncMock(
            return_value=_make_doc_with_content(1, "Test Doc")
        )

        result = await get_note(doc_id=1)

        assert result.document.id == 1
        assert result.document.title == "Test Doc"

    @pytest.mark.asyncio
    async def test_missing_id_returns_404(self, mock_db):
        mock_db.notes_get_document_by_id = AsyncMock(return_value=None)

        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc_info:
            await get_note(doc_id=999)

        assert exc_info.value.status_code == 404


class TestGetNotesByCategory:
    @pytest.fixture
    def mock_db(self):
        with patch("api.controllers.notes.db") as mock:
            yield mock

    @pytest.mark.asyncio
    async def test_valid_category(self, mock_db):
        mock_db.notes_get_category_by_name = AsyncMock(return_value={"id": 1, "name": "Networks"})
        mock_db.notes_fetch_documents = AsyncMock(return_value=[_make_doc(1, "Doc 1")])
        mock_db.notes_count_documents = AsyncMock(return_value=1)

        result = await get_notes_by_category(category="Networks", limit=50, offset=0)

        assert result.category == "Networks"
        assert len(result.documents) == 1
        mock_db.notes_fetch_documents.assert_called_with(category_id=1, limit=50, offset=0)

    @pytest.mark.asyncio
    async def test_unknown_category_returns_404(self, mock_db):
        mock_db.notes_get_category_by_name = AsyncMock(return_value=None)

        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc_info:
            await get_notes_by_category(category="Unknown", limit=50, offset=0)

        assert exc_info.value.status_code == 404
        assert "Unknown" in str(exc_info.value.detail)


class TestGetNotesByTag:
    @pytest.fixture
    def mock_db(self):
        with patch("api.controllers.notes.db") as mock:
            yield mock

    @pytest.mark.asyncio
    async def test_valid_tag(self, mock_db):
        mock_db.notes_get_tag_by_name = AsyncMock(return_value={"id": 5, "name": "python"})
        mock_db.notes_fetch_documents = AsyncMock(return_value=[_make_doc(1, "Doc 1")])
        mock_db.notes_count_documents = AsyncMock(return_value=1)

        result = await get_notes_by_tag(tag="python", limit=50, offset=0)

        assert result.tag == "python"
        mock_db.notes_fetch_documents.assert_called_with(tag_id=5, limit=50, offset=0)

    @pytest.mark.asyncio
    async def test_unknown_tag_returns_404(self, mock_db):
        mock_db.notes_get_tag_by_name = AsyncMock(return_value=None)

        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc_info:
            await get_notes_by_tag(tag="nonexistent", limit=50, offset=0)

        assert exc_info.value.status_code == 404


class TestListTags:
    @pytest.fixture
    def mock_db(self):
        with patch("api.controllers.notes.db") as mock:
            yield mock

    @pytest.mark.asyncio
    async def test_returns_tags(self, mock_db):
        mock_db.notes_get_all_tags = AsyncMock(
            return_value=[
                {"id": 1, "name": "python", "document_count": 5},
                {"id": 2, "name": "testing", "document_count": 3},
            ]
        )

        result = await list_tags()

        assert len(result.tags) == 2
        assert result.tags[0].name == "python"


class TestListCategories:
    @pytest.fixture
    def mock_db(self):
        with patch("api.controllers.notes.db") as mock:
            yield mock

    @pytest.mark.asyncio
    async def test_returns_categories(self, mock_db):
        mock_db.notes_get_all_categories = AsyncMock(
            return_value=[
                {"id": 1, "name": "Networks", "document_count": 10},
                {"id": 2, "name": "Algorithms", "document_count": 8},
            ]
        )

        result = await list_categories()

        assert len(result.categories) == 2
        assert result.categories[0].name == "Networks"


class TestTriggerSync:
    @pytest.fixture
    def mock_sync(self):
        with patch("api.controllers.notes.sync_notes_with_job") as mock:
            mock.return_value = {
                "job_status": "completed",
                "completed": 5,
                "deleted": 0,
                "commit_sha": "abc123",
                "job_id": 1,
            }
            yield mock

    @pytest.mark.asyncio
    async def test_missing_env_returns_503(self):
        with patch("api.controllers.notes.NOTES_SYNC_SECRET", ""):
            from fastapi import HTTPException

            with pytest.raises(HTTPException) as exc_info:
                await trigger_sync(x_sync_secret="some-secret")

            assert exc_info.value.status_code == 503

    @pytest.mark.asyncio
    async def test_missing_header_returns_401(self):
        with patch("api.controllers.notes.NOTES_SYNC_SECRET", "valid-secret"):
            from fastapi import HTTPException

            with pytest.raises(HTTPException) as exc_info:
                await trigger_sync(x_sync_secret=None)

            assert exc_info.value.status_code == 401

    @pytest.mark.asyncio
    async def test_invalid_secret_returns_401(self):
        with patch("api.controllers.notes.NOTES_SYNC_SECRET", "valid-secret"):
            from fastapi import HTTPException

            with pytest.raises(HTTPException) as exc_info:
                await trigger_sync(x_sync_secret="wrong-secret")

            assert exc_info.value.status_code == 401

    @pytest.mark.asyncio
    async def test_valid_secret_triggers_sync(self, mock_sync):
        with (
            patch("api.controllers.notes.NOTES_SYNC_SECRET", "valid-secret"),
            patch("api.controllers.notes.os.getenv", return_value=None),
        ):
            result = await trigger_sync(x_sync_secret="valid-secret")

            assert result["job_status"] == "completed"
            assert result["completed"] == 5
            mock_sync.assert_called_once()

    @pytest.mark.asyncio
    async def test_force_parameter_passed(self, mock_sync):
        with (
            patch("api.controllers.notes.NOTES_SYNC_SECRET", "valid-secret"),
            patch("api.controllers.notes.os.getenv", return_value=None),
        ):
            await trigger_sync(force=True, x_sync_secret="valid-secret")

            mock_sync.assert_called_with(token=None, force=True)
