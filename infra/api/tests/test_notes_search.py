from unittest.mock import AsyncMock, patch

import pytest

from api.controllers.notes_search import (
    SearchMode,
    compute_hybrid_scores,
    search_notes,
)


class TestComputeHybridScores:
    def test_empty_results(self):
        result = compute_hybrid_scores([], [])
        assert result == []

    def test_fts_only_results(self):
        fts_results = [
            {"id": 1, "title": "Doc 1", "rank": 0.5},
            {"id": 2, "title": "Doc 2", "rank": 0.3},
        ]
        result = compute_hybrid_scores(fts_results, [])

        assert len(result) == 2
        assert result[0]["id"] == 1
        assert result[0]["scores"]["fts_rank"] == 1
        assert result[0]["scores"]["vec_rank"] is None

    def test_vec_only_results(self):
        vec_results = [
            {"id": 1, "title": "Doc 1", "similarity": 0.9},
            {"id": 2, "title": "Doc 2", "similarity": 0.7},
        ]
        result = compute_hybrid_scores([], vec_results)

        assert len(result) == 2
        assert result[0]["id"] == 1
        assert result[0]["scores"]["vec_rank"] == 1
        assert result[0]["scores"]["fts_rank"] is None

    def test_hybrid_merge(self):
        fts_results = [
            {"id": 1, "title": "Doc 1", "rank": 0.5},
            {"id": 2, "title": "Doc 2", "rank": 0.3},
        ]
        vec_results = [
            {"id": 2, "title": "Doc 2", "similarity": 0.9},
            {"id": 1, "title": "Doc 1", "similarity": 0.7},
        ]
        result = compute_hybrid_scores(fts_results, vec_results)

        assert len(result) == 2
        for r in result:
            assert r["scores"]["fts_rank"] is not None
            assert r["scores"]["vec_rank"] is not None
            assert r["scores"]["hybrid"] > 0

    def test_disjoint_results(self):
        fts_results = [{"id": 1, "title": "Doc 1", "rank": 0.5}]
        vec_results = [{"id": 2, "title": "Doc 2", "similarity": 0.9}]
        result = compute_hybrid_scores(fts_results, vec_results)

        assert len(result) == 2
        doc1 = next(r for r in result if r["id"] == 1)
        doc2 = next(r for r in result if r["id"] == 2)

        assert doc1["scores"]["fts_rank"] == 1
        assert doc1["scores"]["vec_rank"] is None
        assert doc2["scores"]["fts_rank"] is None
        assert doc2["scores"]["vec_rank"] == 1


class TestSearchNotes:
    @pytest.fixture
    def mock_db(self):
        with patch("api.controllers.notes_search.db") as mock:
            mock.notes_get_category_by_name = AsyncMock(return_value=None)
            mock.notes_get_tag_by_name = AsyncMock(return_value=None)
            mock.notes_fulltext_search = AsyncMock(return_value=[])
            mock.notes_vector_search = AsyncMock(return_value=[])
            yield mock

    @pytest.mark.asyncio
    async def test_fulltext_mode(self, mock_db):
        mock_db.notes_fulltext_search = AsyncMock(
            return_value=[
                {"id": 1, "title": "Test Doc", "rank": 0.5},
            ]
        )

        result = await search_notes(
            q="test query",
            mode=SearchMode.fulltext,
            limit=20,
            offset=0,
            category=None,
            tags=None,
            fts_weight=0.4,
            vec_weight=0.6,
        )

        assert result["mode"] == "fulltext"
        assert result["query"] == "test query"
        assert len(result["results"]) == 1
        assert result["results"][0]["scores"]["fulltext"] == 0.5
        mock_db.notes_fulltext_search.assert_called_once()

    @pytest.mark.asyncio
    async def test_hybrid_mode_fallback_to_fulltext(self, mock_db):
        mock_db.notes_fulltext_search = AsyncMock(
            return_value=[
                {"id": 1, "title": "Test Doc", "rank": 0.5},
            ]
        )

        with patch.dict("sys.modules", {"api.notes_embeddings": None}):
            result = await search_notes(
                q="test query",
                mode=SearchMode.hybrid,
                limit=20,
                offset=0,
                category=None,
                tags=None,
                fts_weight=0.4,
                vec_weight=0.6,
            )

        assert result["mode"] == "hybrid"
        assert len(result["results"]) == 1

    @pytest.mark.asyncio
    async def test_pagination(self, mock_db):
        mock_db.notes_fulltext_search = AsyncMock(
            return_value=[{"id": i, "title": f"Doc {i}", "rank": 1.0 - i * 0.1} for i in range(10)]
        )

        result = await search_notes(
            q="test",
            mode=SearchMode.fulltext,
            limit=3,
            offset=2,
            category=None,
            tags=None,
            fts_weight=0.4,
            vec_weight=0.6,
        )

        assert result["limit"] == 3
        assert result["offset"] == 2
        assert len(result["results"]) == 3
        assert result["results"][0]["id"] == 2
