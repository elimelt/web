import asyncio
from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

import pytest

from api.batch.visitor_analytics import (
    _extract_ip_from_payload,
    _extract_location_from_payload,
    _parse_timestamp,
    compute_visitor_stats,
    run_batch_job,
    save_visitor_stats,
    start_analytics_scheduler,
)


class TestParseTimestamp:
    def test_parse_iso_format_with_timezone(self):
        result = _parse_timestamp("2025-01-15T10:30:00+00:00")
        assert result == datetime(2025, 1, 15, 10, 30, 0, tzinfo=UTC)

    def test_parse_iso_format_with_z_suffix(self):
        result = _parse_timestamp("2025-01-15T10:30:00Z")
        assert result == datetime(2025, 1, 15, 10, 30, 0, tzinfo=UTC)

    def test_parse_iso_format_with_microseconds(self):
        result = _parse_timestamp("2025-01-15T10:30:00.123456+00:00")
        assert result.microsecond == 123456


class TestExtractIpFromPayload:
    def test_extract_from_nested_visitor(self):
        payload = {"visitor": {"ip": "192.168.1.1", "location": {}}}
        assert _extract_ip_from_payload(payload) == "192.168.1.1"

    def test_extract_from_flat_payload(self):
        payload = {"ip": "10.0.0.1"}
        assert _extract_ip_from_payload(payload) == "10.0.0.1"

    def test_return_none_when_missing(self):
        payload = {"other_field": "value"}
        assert _extract_ip_from_payload(payload) is None

    def test_nested_visitor_not_dict(self):
        payload = {"visitor": "not_a_dict", "ip": "1.2.3.4"}
        assert _extract_ip_from_payload(payload) == "1.2.3.4"


class TestExtractLocationFromPayload:
    def test_extract_from_nested_visitor(self):
        payload = {"visitor": {"ip": "1.1.1.1", "location": {"country": "US", "city": "NYC"}}}
        country, city = _extract_location_from_payload(payload)
        assert country == "US"
        assert city == "NYC"

    def test_extract_from_flat_payload(self):
        payload = {"location": {"country": "UK", "city": "London"}}
        country, city = _extract_location_from_payload(payload)
        assert country == "UK"
        assert city == "London"

    def test_return_none_when_missing(self):
        payload = {"ip": "1.1.1.1"}
        country, city = _extract_location_from_payload(payload)
        assert country is None
        assert city is None

    def test_partial_location(self):
        payload = {"location": {"country": "CA"}}
        country, city = _extract_location_from_payload(payload)
        assert country == "CA"
        assert city is None

    def test_nested_visitor_not_dict(self):
        payload = {"visitor": "not_a_dict", "location": {"country": "FR", "city": "Paris"}}
        country, city = _extract_location_from_payload(payload)
        assert country == "FR"
        assert city == "Paris"


class TestComputeVisitorStats:
    @pytest.fixture
    def mock_db(self):
        with patch("api.batch.visitor_analytics.db") as mock:
            yield mock

    @pytest.mark.asyncio
    async def test_empty_events(self, mock_db):
        mock_db.fetch_visitor_events_for_analytics = AsyncMock(return_value=[])

        start = datetime(2025, 1, 1, tzinfo=UTC)
        end = datetime(2025, 1, 2, tzinfo=UTC)
        result = await compute_visitor_stats(start, end)

        assert result == []

    @pytest.mark.asyncio
    async def test_single_visitor_join_and_leave(self, mock_db):
        events = [
            {
                "timestamp": "2025-01-01T10:00:00+00:00",
                "type": "join",
                "payload": {
                    "visitor": {"ip": "1.2.3.4", "location": {"country": "US", "city": "NYC"}}
                },
            },
            {
                "timestamp": "2025-01-01T10:30:00+00:00",
                "type": "leave",
                "payload": {"ip": "1.2.3.4"},
            },
        ]
        mock_db.fetch_visitor_events_for_analytics = AsyncMock(return_value=events)

        start = datetime(2025, 1, 1, tzinfo=UTC)
        end = datetime(2025, 1, 2, tzinfo=UTC)
        result = await compute_visitor_stats(start, end)

        assert len(result) == 1
        stats = result[0]
        assert stats["visitor_ip"] == "1.2.3.4"
        assert stats["total_visits"] == 1
        assert stats["total_time_seconds"] == 1800  # 30 minutes
        assert stats["is_recurring"] is False
        assert stats["location_country"] == "US"
        assert stats["location_city"] == "NYC"

    @pytest.mark.asyncio
    async def test_recurring_visitor_multiple_sessions(self, mock_db):
        events = [
            {
                "timestamp": "2025-01-01T08:00:00+00:00",
                "type": "join",
                "payload": {"visitor": {"ip": "5.5.5.5"}},
            },
            {
                "timestamp": "2025-01-01T09:00:00+00:00",
                "type": "leave",
                "payload": {"ip": "5.5.5.5"},
            },
            {
                "timestamp": "2025-01-01T14:00:00+00:00",
                "type": "join",
                "payload": {"visitor": {"ip": "5.5.5.5"}},
            },
            {
                "timestamp": "2025-01-01T15:30:00+00:00",
                "type": "leave",
                "payload": {"ip": "5.5.5.5"},
            },
        ]
        mock_db.fetch_visitor_events_for_analytics = AsyncMock(return_value=events)

        start = datetime(2025, 1, 1, tzinfo=UTC)
        end = datetime(2025, 1, 2, tzinfo=UTC)
        result = await compute_visitor_stats(start, end)

        assert len(result) == 1
        stats = result[0]
        assert stats["total_visits"] == 2
        assert stats["is_recurring"] is True
        assert stats["total_time_seconds"] == 3600 + 5400  # 1h + 1.5h

    @pytest.mark.asyncio
    async def test_active_session_at_period_end(self, mock_db):
        events = [
            {
                "timestamp": "2025-01-01T23:00:00+00:00",
                "type": "join",
                "payload": {"visitor": {"ip": "9.9.9.9"}},
            },
        ]
        mock_db.fetch_visitor_events_for_analytics = AsyncMock(return_value=events)

        start = datetime(2025, 1, 1, tzinfo=UTC)
        end = datetime(2025, 1, 2, tzinfo=UTC)
        result = await compute_visitor_stats(start, end)

        assert len(result) == 1
        stats = result[0]
        assert stats["total_visits"] == 1
        assert stats["total_time_seconds"] == 3600  # 1 hour until midnight

    @pytest.mark.asyncio
    async def test_leave_without_join_ignored(self, mock_db):
        events = [
            {
                "timestamp": "2025-01-01T10:00:00+00:00",
                "type": "leave",
                "payload": {"ip": "orphan"},
            },
        ]
        mock_db.fetch_visitor_events_for_analytics = AsyncMock(return_value=events)

        start = datetime(2025, 1, 1, tzinfo=UTC)
        end = datetime(2025, 1, 2, tzinfo=UTC)
        result = await compute_visitor_stats(start, end)

        assert result == []

    @pytest.mark.asyncio
    async def test_event_without_ip_ignored(self, mock_db):
        events = [
            {"timestamp": "2025-01-01T10:00:00+00:00", "type": "join", "payload": {"no_ip": True}},
        ]
        mock_db.fetch_visitor_events_for_analytics = AsyncMock(return_value=events)

        start = datetime(2025, 1, 1, tzinfo=UTC)
        end = datetime(2025, 1, 2, tzinfo=UTC)
        result = await compute_visitor_stats(start, end)

        assert result == []

    @pytest.mark.asyncio
    async def test_session_duration_capped_at_24h(self, mock_db):
        events = [
            {
                "timestamp": "2025-01-01T00:00:00+00:00",
                "type": "join",
                "payload": {"visitor": {"ip": "long.session"}},
            },
            {
                "timestamp": "2025-01-03T00:00:00+00:00",
                "type": "leave",
                "payload": {"ip": "long.session"},
            },
        ]
        mock_db.fetch_visitor_events_for_analytics = AsyncMock(return_value=events)

        start = datetime(2025, 1, 1, tzinfo=UTC)
        end = datetime(2025, 1, 4, tzinfo=UTC)
        result = await compute_visitor_stats(start, end)

        assert len(result) == 1
        assert result[0]["total_time_seconds"] == 86400  # 24h max

    @pytest.mark.asyncio
    async def test_multiple_visitors(self, mock_db):
        events = [
            {
                "timestamp": "2025-01-01T10:00:00+00:00",
                "type": "join",
                "payload": {"visitor": {"ip": "visitor1"}},
            },
            {
                "timestamp": "2025-01-01T10:30:00+00:00",
                "type": "leave",
                "payload": {"ip": "visitor1"},
            },
            {
                "timestamp": "2025-01-01T11:00:00+00:00",
                "type": "join",
                "payload": {"visitor": {"ip": "visitor2"}},
            },
            {
                "timestamp": "2025-01-01T12:00:00+00:00",
                "type": "leave",
                "payload": {"ip": "visitor2"},
            },
        ]
        mock_db.fetch_visitor_events_for_analytics = AsyncMock(return_value=events)

        start = datetime(2025, 1, 1, tzinfo=UTC)
        end = datetime(2025, 1, 2, tzinfo=UTC)
        result = await compute_visitor_stats(start, end)

        assert len(result) == 2
        ips = {r["visitor_ip"] for r in result}
        assert ips == {"visitor1", "visitor2"}

    @pytest.mark.asyncio
    async def test_location_only_set_on_join(self, mock_db):
        events = [
            {
                "timestamp": "2025-01-01T10:00:00+00:00",
                "type": "join",
                "payload": {
                    "visitor": {"ip": "geo", "location": {"country": "JP", "city": "Tokyo"}}
                },
            },
            {"timestamp": "2025-01-01T11:00:00+00:00", "type": "leave", "payload": {"ip": "geo"}},
        ]
        mock_db.fetch_visitor_events_for_analytics = AsyncMock(return_value=events)

        start = datetime(2025, 1, 1, tzinfo=UTC)
        end = datetime(2025, 1, 2, tzinfo=UTC)
        result = await compute_visitor_stats(start, end)

        assert result[0]["location_country"] == "JP"
        assert result[0]["location_city"] == "Tokyo"


class TestSaveVisitorStats:
    @pytest.fixture
    def mock_db(self):
        with patch("api.batch.visitor_analytics.db") as mock:
            yield mock

    @pytest.mark.asyncio
    async def test_save_empty_list(self, mock_db):
        result = await save_visitor_stats([])
        assert result == 0

    @pytest.mark.asyncio
    async def test_save_single_stat(self, mock_db):
        mock_db.upsert_visitor_stats = AsyncMock(return_value={})
        stats = [
            {
                "visitor_ip": "1.2.3.4",
                "period_start": datetime(2025, 1, 1, tzinfo=UTC),
                "period_end": datetime(2025, 1, 2, tzinfo=UTC),
                "total_visits": 5,
                "total_time_seconds": 3600,
                "avg_session_duration_seconds": 720,
                "is_recurring": True,
                "first_visit_at": datetime(2025, 1, 1, 10, 0, tzinfo=UTC),
                "last_visit_at": datetime(2025, 1, 1, 18, 0, tzinfo=UTC),
                "visit_frequency_per_day": 5.0,
                "location_country": "US",
                "location_city": "NYC",
            }
        ]

        result = await save_visitor_stats(stats)

        assert result == 1
        mock_db.upsert_visitor_stats.assert_called_once()

    @pytest.mark.asyncio
    async def test_save_multiple_stats(self, mock_db):
        mock_db.upsert_visitor_stats = AsyncMock(return_value={})
        stats = [
            {
                "visitor_ip": f"ip{i}",
                "period_start": datetime(2025, 1, 1, tzinfo=UTC),
                "period_end": datetime(2025, 1, 2, tzinfo=UTC),
                "total_visits": 1,
                "total_time_seconds": 100,
                "avg_session_duration_seconds": 100,
                "is_recurring": False,
                "first_visit_at": None,
                "last_visit_at": None,
                "visit_frequency_per_day": 1.0,
            }
            for i in range(3)
        ]

        result = await save_visitor_stats(stats)

        assert result == 3
        assert mock_db.upsert_visitor_stats.call_count == 3

    @pytest.mark.asyncio
    async def test_save_handles_db_error(self, mock_db):
        mock_db.upsert_visitor_stats = AsyncMock(side_effect=Exception("DB error"))
        stats = [
            {
                "visitor_ip": "fail",
                "period_start": datetime(2025, 1, 1, tzinfo=UTC),
                "period_end": datetime(2025, 1, 2, tzinfo=UTC),
                "total_visits": 1,
                "total_time_seconds": 100,
                "avg_session_duration_seconds": 100,
                "is_recurring": False,
                "first_visit_at": None,
                "last_visit_at": None,
                "visit_frequency_per_day": 1.0,
            }
        ]

        result = await save_visitor_stats(stats)

        assert result == 0


class TestRunBatchJob:
    @pytest.fixture
    def mock_db(self):
        with patch("api.batch.visitor_analytics.db") as mock:
            mock.init_pool = AsyncMock()
            mock.fetch_visitor_events_for_analytics = AsyncMock(return_value=[])
            mock.upsert_visitor_stats = AsyncMock(return_value={})
            yield mock

    @pytest.mark.asyncio
    async def test_dry_run_no_saves(self, mock_db):
        result = await run_batch_job(days=1, dry_run=True)

        assert result["dry_run"] is True
        assert result["total_records_saved"] == 0
        mock_db.upsert_visitor_stats.assert_not_called()

    @pytest.mark.asyncio
    async def test_normal_run_saves(self, mock_db):
        events = [
            {
                "timestamp": "2025-01-01T10:00:00+00:00",
                "type": "join",
                "payload": {"visitor": {"ip": "test"}},
            },
            {"timestamp": "2025-01-01T11:00:00+00:00", "type": "leave", "payload": {"ip": "test"}},
        ]
        mock_db.fetch_visitor_events_for_analytics = AsyncMock(return_value=events)

        result = await run_batch_job(days=1, dry_run=False)

        assert result["dry_run"] is False
        assert result["days_processed"] == 1

    @pytest.mark.asyncio
    async def test_multi_day_processing(self, mock_db):
        result = await run_batch_job(days=3, dry_run=True)

        assert result["days_processed"] == 3
        assert len(result["daily_results"]) == 3

    @pytest.mark.asyncio
    async def test_db_init_warning_handled(self, mock_db):
        mock_db.init_pool = AsyncMock(side_effect=Exception("Already initialized"))

        result = await run_batch_job(days=1, dry_run=True)
        assert result is not None


class TestStartAnalyticsScheduler:
    @pytest.mark.asyncio
    async def test_scheduler_starts_and_stops(self):
        with patch("api.batch.visitor_analytics.run_batch_job", new_callable=AsyncMock) as mock_job:
            mock_job.return_value = {"total_records_saved": 0}
            stop_event = asyncio.Event()

            with patch.dict("os.environ", {"ANALYTICS_INTERVAL_HOURS": "24"}):
                tasks = await start_analytics_scheduler(stop_event)

            assert len(tasks) == 1
            assert not tasks[0].done()

            await asyncio.sleep(0.1)
            stop_event.set()

            await asyncio.wait_for(tasks[0], timeout=2.0)

            assert tasks[0].done()
            assert mock_job.called

    @pytest.mark.asyncio
    async def test_scheduler_handles_job_exception(self):
        with patch("api.batch.visitor_analytics.run_batch_job", new_callable=AsyncMock) as mock_job:
            mock_job.side_effect = Exception("Job failed")
            stop_event = asyncio.Event()

            with patch.dict("os.environ", {"ANALYTICS_INTERVAL_HOURS": "24"}):
                tasks = await start_analytics_scheduler(stop_event)

            await asyncio.sleep(0.1)
            stop_event.set()
            await asyncio.wait_for(tasks[0], timeout=2.0)

            assert tasks[0].done()


class TestVisitorAnalyticsAPI:
    @pytest.fixture
    def mock_db_module(self):
        with patch("api.controllers.visitor_analytics.db") as mock:
            yield mock

    @pytest.mark.asyncio
    async def test_get_visitor_analytics_empty(self, mock_db_module):
        mock_db_module.fetch_visitor_stats = AsyncMock(return_value=[])

        from api.controllers.visitor_analytics import get_visitor_analytics

        result = await get_visitor_analytics()

        assert result["visitors"] == []
        assert result["count"] == 0

    @pytest.mark.asyncio
    async def test_get_visitor_analytics_with_data(self, mock_db_module):
        mock_data = [
            {"visitor_ip": "1.2.3.4", "total_visits": 5, "is_recurring": True},
            {"visitor_ip": "5.6.7.8", "total_visits": 1, "is_recurring": False},
        ]
        mock_db_module.fetch_visitor_stats = AsyncMock(return_value=mock_data)

        from api.controllers.visitor_analytics import get_visitor_analytics

        result = await get_visitor_analytics()

        assert result["count"] == 2
        assert len(result["visitors"]) == 2

    @pytest.mark.asyncio
    async def test_get_visitor_analytics_with_filters(self, mock_db_module):
        mock_db_module.fetch_visitor_stats = AsyncMock(return_value=[])

        from api.controllers.visitor_analytics import get_visitor_analytics

        result = await get_visitor_analytics(
            visitor_ip="1.2.3.4",
            start_date="2025-01-01T00:00:00Z",
            end_date="2025-01-31T23:59:59Z",
            recurring_only=True,
            limit=50,
        )

        assert result["filters"]["visitor_id"] == "1.2.3.4"
        assert result["filters"]["segment"] == "recurring"
        assert result["filters"]["limit"] == 50
        mock_db_module.fetch_visitor_stats.assert_called_once_with(
            visitor_ip="1.2.3.4",
            start_date="2025-01-01T00:00:00Z",
            end_date="2025-01-31T23:59:59Z",
            is_recurring=True,
            limit=50,
        )

    @pytest.mark.asyncio
    async def test_get_visitor_analytics_non_recurring_filter(self, mock_db_module):
        mock_db_module.fetch_visitor_stats = AsyncMock(return_value=[])

        from api.controllers.visitor_analytics import get_visitor_analytics

        result = await get_visitor_analytics(recurring_only=False)

        assert result["filters"]["segment"] == "non-recurring"

    @pytest.mark.asyncio
    async def test_get_visitor_analytics_db_error(self, mock_db_module):
        mock_db_module.fetch_visitor_stats = AsyncMock(side_effect=Exception("DB down"))

        from fastapi import HTTPException

        from api.controllers.visitor_analytics import get_visitor_analytics

        with pytest.raises(HTTPException) as exc_info:
            await get_visitor_analytics()

        assert exc_info.value.status_code == 500

    @pytest.mark.asyncio
    async def test_get_visitor_analytics_summary(self, mock_db_module):
        mock_summary = {
            "unique_visitors": 10,
            "total_visits": 50,
            "avg_session_duration_seconds": 300.0,
            "total_time_spent_seconds": 15000.0,
            "recurring_visitors": 5,
            "avg_visit_frequency_per_day": 2.5,
        }
        mock_db_module.get_visitor_analytics_summary = AsyncMock(return_value=mock_summary)

        from api.controllers.visitor_analytics import get_visitor_analytics_summary

        result = await get_visitor_analytics_summary(start_date=None, end_date=None)

        assert result["summary"] == mock_summary
        assert result["filters"]["start_date"] is None
        assert result["filters"]["end_date"] is None

    @pytest.mark.asyncio
    async def test_get_visitor_analytics_summary_with_dates(self, mock_db_module):
        mock_db_module.get_visitor_analytics_summary = AsyncMock(return_value={})

        from api.controllers.visitor_analytics import get_visitor_analytics_summary

        result = await get_visitor_analytics_summary(
            start_date="2025-01-01T00:00:00Z",
            end_date="2025-01-31T23:59:59Z",
        )

        assert result["filters"]["start_date"] == "2025-01-01T00:00:00Z"
        assert result["filters"]["end_date"] == "2025-01-31T23:59:59Z"

    @pytest.mark.asyncio
    async def test_get_visitor_analytics_summary_db_error(self, mock_db_module):
        mock_db_module.get_visitor_analytics_summary = AsyncMock(side_effect=Exception("DB error"))

        from fastapi import HTTPException

        from api.controllers.visitor_analytics import get_visitor_analytics_summary

        with pytest.raises(HTTPException) as exc_info:
            await get_visitor_analytics_summary()

        assert exc_info.value.status_code == 500

    @pytest.mark.asyncio
    async def test_get_visitor_analytics_by_id(self, mock_db_module):
        mock_data = [{"visitor_ip": "1.2.3.4", "total_visits": 3}]
        mock_db_module.fetch_visitor_stats = AsyncMock(return_value=mock_data)

        from api.controllers.visitor_analytics import get_visitor_analytics_by_id

        result = await get_visitor_analytics_by_id(visitor_id="1.2.3.4")

        assert result["visitor_id"] == "1.2.3.4"
        assert result["count"] == 1
        assert result["records"] == mock_data

    @pytest.mark.asyncio
    async def test_get_visitor_analytics_by_id_not_found(self, mock_db_module):
        mock_db_module.fetch_visitor_stats = AsyncMock(return_value=[])

        from api.controllers.visitor_analytics import get_visitor_analytics_by_id

        result = await get_visitor_analytics_by_id(visitor_id="unknown")

        assert result["visitor_id"] == "unknown"
        assert result["count"] == 0
        assert result["records"] == []
        assert "message" in result

    @pytest.mark.asyncio
    async def test_get_visitor_analytics_by_id_db_error(self, mock_db_module):
        mock_db_module.fetch_visitor_stats = AsyncMock(side_effect=Exception("DB error"))

        from fastapi import HTTPException

        from api.controllers.visitor_analytics import get_visitor_analytics_by_id

        with pytest.raises(HTTPException) as exc_info:
            await get_visitor_analytics_by_id(visitor_id="1.2.3.4")

        assert exc_info.value.status_code == 500

    @pytest.mark.asyncio
    async def test_get_visitor_analytics_value_error(self, mock_db_module):
        mock_db_module.fetch_visitor_stats = AsyncMock(side_effect=ValueError("Invalid date"))

        from fastapi import HTTPException

        from api.controllers.visitor_analytics import get_visitor_analytics

        with pytest.raises(HTTPException) as exc_info:
            await get_visitor_analytics()

        assert exc_info.value.status_code == 400

    @pytest.mark.asyncio
    async def test_get_visitor_analytics_summary_value_error(self, mock_db_module):
        mock_db_module.get_visitor_analytics_summary = AsyncMock(
            side_effect=ValueError("Invalid date")
        )

        from fastapi import HTTPException

        from api.controllers.visitor_analytics import get_visitor_analytics_summary

        with pytest.raises(HTTPException) as exc_info:
            await get_visitor_analytics_summary(start_date=None, end_date=None)

        assert exc_info.value.status_code == 400

    @pytest.mark.asyncio
    async def test_get_visitor_analytics_by_id_value_error(self, mock_db_module):
        mock_db_module.fetch_visitor_stats = AsyncMock(side_effect=ValueError("Invalid date"))

        from fastapi import HTTPException

        from api.controllers.visitor_analytics import get_visitor_analytics_by_id

        with pytest.raises(HTTPException) as exc_info:
            await get_visitor_analytics_by_id(visitor_id="1.2.3.4")

        assert exc_info.value.status_code == 400


class TestRunBatchJobBranches:
    @pytest.fixture
    def mock_db(self):
        with patch("api.batch.visitor_analytics.db") as mock:
            mock.init_pool = AsyncMock()
            mock.fetch_visitor_events_for_analytics = AsyncMock(return_value=[])
            mock.upsert_visitor_stats = AsyncMock(return_value={})
            yield mock

    @pytest.mark.asyncio
    async def test_dry_run_with_many_stats(self, mock_db):
        events = []
        for i in range(7):
            events.append(
                {
                    "timestamp": f"2025-01-01T{10+i}:00:00+00:00",
                    "type": "join",
                    "payload": {"visitor": {"ip": f"visitor{i}"}},
                }
            )
            events.append(
                {
                    "timestamp": f"2025-01-01T{10+i}:30:00+00:00",
                    "type": "leave",
                    "payload": {"ip": f"visitor{i}"},
                }
            )
        mock_db.fetch_visitor_events_for_analytics = AsyncMock(return_value=events)

        result = await run_batch_job(days=1, dry_run=True)

        assert result["dry_run"] is True
        assert result["total_visitors"] == 7


class TestComputeVisitorStatsEdgeCases:
    @pytest.fixture
    def mock_db(self):
        with patch("api.batch.visitor_analytics.db") as mock:
            yield mock

    @pytest.mark.asyncio
    async def test_visitor_with_empty_sessions_skipped(self, mock_db):
        events = [
            {
                "timestamp": "2025-01-01T10:00:00+00:00",
                "type": "leave",
                "payload": {"ip": "no_join"},
            },
        ]
        mock_db.fetch_visitor_events_for_analytics = AsyncMock(return_value=events)

        start = datetime(2025, 1, 1, tzinfo=UTC)
        end = datetime(2025, 1, 2, tzinfo=UTC)
        result = await compute_visitor_stats(start, end)

        assert result == []


class TestCLIMain:
    def test_main_with_dry_run(self):
        with patch("api.batch.visitor_analytics.run_batch_job", new_callable=AsyncMock) as mock_job:
            mock_job.return_value = {"total_records_saved": 0}
            with patch("sys.argv", ["visitor_analytics.py", "--days", "2", "--dry-run"]):
                from api.batch.visitor_analytics import main

                main()
                mock_job.assert_called_once_with(days=2, dry_run=True)

    def test_main_without_dry_run(self):
        with patch("api.batch.visitor_analytics.run_batch_job", new_callable=AsyncMock) as mock_job:
            mock_job.return_value = {"total_records_saved": 0}
            with patch("sys.argv", ["visitor_analytics.py", "--days", "1"]):
                from api.batch.visitor_analytics import main

                main()
                mock_job.assert_called_once_with(days=1, dry_run=False)
