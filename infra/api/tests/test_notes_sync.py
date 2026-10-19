from datetime import UTC, datetime
from unittest.mock import patch

import httpx
import pytest

from api.notes_sync import (
    GitHubClient,
    GitHubResponse,
    RateLimitInfo,
    get_content_tree,
    get_repo_latest_commit,
    parse_frontmatter,
    parse_tags,
    sync_notes,
)


class TestParseFrontmatter:
    def test_valid_frontmatter_all_fields(self):
        content = """---
title: Test Document
category: Testing
tags: unit, test, python
description: A test document
---

# Content here
"""
        metadata, body = parse_frontmatter(content)
        assert metadata["title"] == "Test Document"
        assert metadata["category"] == "Testing"
        assert metadata["tags"] == "unit, test, python"
        assert metadata["description"] == "A test document"
        assert body.strip() == "# Content here"

    def test_missing_frontmatter(self):
        content = "# Just markdown\n\nNo frontmatter here."
        metadata, body = parse_frontmatter(content)
        assert metadata == {}
        assert body == content

    def test_malformed_yaml(self):
        content = """---
title: Bad YAML
  invalid indentation: [
---

Content
"""
        metadata, body = parse_frontmatter(content)
        assert metadata == {}

    def test_empty_frontmatter(self):
        content = """---
---

Content here
"""
        metadata, body = parse_frontmatter(content)
        assert metadata == {}
        assert "Content here" in body


class TestParseTags:
    def test_comma_separated_string(self):
        result = parse_tags("tag1, tag2, tag3")
        assert result == ["tag1", "tag2", "tag3"]

    def test_list_format(self):
        result = parse_tags(["tag1", "tag2", "tag3"])
        assert result == ["tag1", "tag2", "tag3"]

    def test_none_value(self):
        result = parse_tags(None)
        assert result == []

    def test_empty_string(self):
        result = parse_tags("")
        assert result == []

    def test_extra_whitespace(self):
        result = parse_tags("  tag1  ,  tag2  ,  tag3  ")
        assert result == ["tag1", "tag2", "tag3"]

    def test_empty_list(self):
        result = parse_tags([])
        assert result == []

    def test_list_with_empty_items(self):
        result = parse_tags(["tag1", "", "tag2", None])
        assert result == ["tag1", "tag2"]


class TestRateLimitInfo:
    def test_from_headers(self):
        headers = httpx.Headers(
            {
                "x-ratelimit-limit": "5000",
                "x-ratelimit-remaining": "4999",
                "x-ratelimit-reset": "1735850000",
                "x-ratelimit-used": "1",
            }
        )
        info = RateLimitInfo.from_headers(headers)
        assert info is not None
        assert info.limit == 5000
        assert info.remaining == 4999
        assert info.used == 1

    def test_from_headers_missing(self):
        headers = httpx.Headers({})
        info = RateLimitInfo.from_headers(headers)
        assert info is not None
        assert info.limit == 0
        assert info.remaining == 0

    def test_wait_seconds_future(self):
        future_time = datetime.now(UTC).timestamp() + 60
        info = RateLimitInfo(
            limit=5000,
            remaining=0,
            reset_at=datetime.fromtimestamp(future_time, tz=UTC),
            used=5000,
        )
        wait = info.wait_seconds()
        assert 59 < wait < 62  # ~60 seconds + 1 second buffer

    def test_wait_seconds_past(self):
        past_time = datetime.now(UTC).timestamp() - 60
        info = RateLimitInfo(
            limit=5000,
            remaining=0,
            reset_at=datetime.fromtimestamp(past_time, tz=UTC),
            used=5000,
        )
        wait = info.wait_seconds()
        assert wait == 0.0


class TestGitHubClient:
    def test_headers_without_token(self):
        client = GitHubClient()
        assert "Accept" in client.headers
        assert "Authorization" not in client.headers

    def test_headers_with_token(self):
        client = GitHubClient(token="my-token")
        assert client.headers["Authorization"] == "token my-token"


class TestSyncNotesLegacyWrapper:
    @pytest.fixture
    def mock_sync_with_job(self):
        with patch("api.notes_sync.sync_notes_with_job") as mock:
            yield mock

    @pytest.mark.asyncio
    async def test_wraps_sync_notes_with_job(self, mock_sync_with_job):
        mock_sync_with_job.return_value = {
            "job_status": "completed",
            "completed": 5,
            "deleted": 2,
            "commit_sha": "abc123",
            "job_id": 1,
            "failed": 0,
        }

        result = await sync_notes()

        assert result["success"] is True
        assert result["updated"] == 5
        assert result["deleted"] == 2
        assert result["commit_sha"] == "abc123"
        assert result["job_id"] == 1

    @pytest.mark.asyncio
    async def test_skipped_status(self, mock_sync_with_job):
        mock_sync_with_job.return_value = {
            "job_status": "skipped",
            "completed": 0,
            "commit_sha": "abc123",
        }

        result = await sync_notes()

        assert result["skipped"] is True

    @pytest.mark.asyncio
    async def test_failed_status(self, mock_sync_with_job):
        mock_sync_with_job.return_value = {
            "job_status": "failed",
            "completed": 0,
            "failed": 5,
            "message": "Rate limited",
        }

        result = await sync_notes()

        assert result["success"] is False


class FakeGitHubClient:
    def __init__(self, data):
        self.data = data
        self.urls = []

    async def get(self, url):
        self.urls.append(url)
        return GitHubResponse(status_code=200, data=self.data, rate_limit=None)


class TestMonorepoPaths:
    @pytest.mark.asyncio
    async def test_latest_commit_only_counts_note_content(self):
        client = FakeGitHubClient([{"sha": "abc123"}])

        sha, error = await get_repo_latest_commit(client)

        assert (sha, error) == ("abc123", None)
        assert "/repos/elimelt/web/commits?" in client.urls[0]
        assert "path=notes/content" in client.urls[0]

    @pytest.mark.asyncio
    async def test_content_tree_keeps_paths_relative_to_notes(self):
        client = FakeGitHubClient({"tree": [
            {"type": "blob", "path": "notes/content/systems/raft.md"},
            {"type": "blob", "path": "notes/content/systems/diagram.png"},
            {"type": "blob", "path": "notes/README.md"},
            {"type": "blob", "path": "frontend/content/other.md"},
        ]})

        paths, error = await get_content_tree(client)

        assert error is None
        assert paths == ["content/systems/raft.md"]
