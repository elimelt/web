from datetime import UTC, datetime
from unittest.mock import patch

import pytest
from psycopg import errors as pg_errors


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
    """Mock connection.

    cursor_results entries are either a list of rows (returned via a cursor)
    or an Exception instance (raised from execute).
    """

    def __init__(self, cursor_results=None):
        self.cursor_results = cursor_results or []
        self._call_index = 0
        self.executed = []

    async def execute(self, sql, params=None):
        self.executed.append((sql, params))
        if self._call_index < len(self.cursor_results):
            result = self.cursor_results[self._call_index]
            self._call_index += 1
            if isinstance(result, Exception):
                raise result
            return MockAsyncCursor(result)
        return MockAsyncCursor([])

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass


def create_mock_connection(cursor_results=None):
    holder = {}

    async def connect(*args, **kwargs):
        conn = MockAsyncConnection(cursor_results)
        holder["conn"] = conn
        return conn

    return connect, holder


@pytest.fixture
def mock_psycopg():
    with patch("api.db.core.psycopg.AsyncConnection") as mock:
        yield mock


class TestInsertChatMessage:
    @pytest.mark.asyncio
    async def test_insert_happy_path(self, mock_psycopg):
        connect, holder = create_mock_connection([None])
        mock_psycopg.connect = connect

        from api.db.chat import insert_chat_message

        await insert_chat_message(
            channel="general",
            sender="alice",
            text="hello",
            ts_iso="2024-01-01T12:00:00Z",
            message_id="m1",
            reply_to="m0",
        )

        conn = holder["conn"]
        assert len(conn.executed) == 1
        sql, params = conn.executed[0]
        assert "INSERT INTO chat_messages" in sql
        assert "message_id" in sql
        assert "reply_to" in sql
        assert params == (
            "general",
            "alice",
            "hello",
            datetime(2024, 1, 1, 12, 0, tzinfo=UTC),
            "m1",
            "m0",
        )

    @pytest.mark.asyncio
    async def test_insert_defaults_optional_fields_to_none(self, mock_psycopg):
        connect, holder = create_mock_connection([None])
        mock_psycopg.connect = connect

        from api.db.chat import insert_chat_message

        await insert_chat_message(
            channel="general",
            sender="bob",
            text="hi",
            ts_iso="2024-06-15T00:30:00Z",
        )

        conn = holder["conn"]
        assert len(conn.executed) == 1
        _, params = conn.executed[0]
        assert params[4] is None
        assert params[5] is None


class TestFetchChatHistory:
    @pytest.mark.asyncio
    async def test_fetch_happy_path_row_mapping(self, mock_psycopg):
        ts = datetime(2024, 1, 1, 12, 0, tzinfo=UTC)
        connect, holder = create_mock_connection(
            [
                [("general", "alice", "hello", ts, "m1", "m0")],
            ]
        )
        mock_psycopg.connect = connect

        from api.db.chat import fetch_chat_history

        result = await fetch_chat_history("general", "2024-01-02T00:00:00Z", 50)

        assert result == [
            {
                "type": "chat_message",
                "channel": "general",
                "sender": "alice",
                "text": "hello",
                "timestamp": "2024-01-01T12:00:00+00:00",
                "id": "m1",
                "reply_to": "m0",
            }
        ]

        conn = holder["conn"]
        assert len(conn.executed) == 1
        sql, params = conn.executed[0]
        assert "SELECT channel, sender, text, ts, message_id, reply_to" in sql
        assert params == (
            "general",
            datetime(2024, 1, 2, 0, 0, tzinfo=UTC),
            50,
        )

    @pytest.mark.asyncio
    async def test_fetch_timestamp_converted_to_utc_isoformat(self, mock_psycopg):
        from datetime import timedelta, timezone

        ts = datetime(2024, 3, 10, 7, 30, tzinfo=timezone(timedelta(hours=-7)))
        connect, _ = create_mock_connection(
            [
                [("general", "bob", "hi", ts, "m2", None)],
            ]
        )
        mock_psycopg.connect = connect

        from api.db.chat import fetch_chat_history

        result = await fetch_chat_history("general", "2024-03-11T00:00:00Z", 10)

        assert result[0]["timestamp"] == "2024-03-10T14:30:00+00:00"
        assert result[0]["reply_to"] is None

    @pytest.mark.asyncio
    async def test_fetch_without_before_uses_now(self, mock_psycopg):
        connect, holder = create_mock_connection([[]])
        mock_psycopg.connect = connect

        from api.db.chat import fetch_chat_history

        before = datetime.now(UTC)
        result = await fetch_chat_history("general", None, 25)
        after = datetime.now(UTC)

        assert result == []
        conn = holder["conn"]
        _, params = conn.executed[0]
        assert before <= params[1] <= after
        assert params[2] == 25


class TestUndefinedColumnPath:
    """UndefinedColumn propagates to the caller. The old fallback branches
    called a nonexistent _ensure_schema() and raised NameError instead;
    schema is created by migrations at startup, so no fallback is needed."""

    @pytest.mark.asyncio
    async def test_insert_undefined_column_propagates(self, mock_psycopg):
        connect, _ = create_mock_connection([pg_errors.UndefinedColumn()])
        mock_psycopg.connect = connect

        from api.db.chat import insert_chat_message

        with pytest.raises(pg_errors.UndefinedColumn):
            await insert_chat_message(
                channel="general",
                sender="alice",
                text="hello",
                ts_iso="2024-01-01T12:00:00Z",
            )

    @pytest.mark.asyncio
    async def test_fetch_undefined_column_propagates(self, mock_psycopg):
        connect, _ = create_mock_connection([pg_errors.UndefinedColumn()])
        mock_psycopg.connect = connect

        from api.db.chat import fetch_chat_history

        with pytest.raises(pg_errors.UndefinedColumn):
            await fetch_chat_history("general", "2024-01-02T00:00:00Z", 50)
