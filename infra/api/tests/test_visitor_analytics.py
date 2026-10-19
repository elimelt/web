import asyncio
from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

import pytest

from api.visitor_id import visitor_id
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


def _row(ip, visits=1, recurring=False):
    return {
        "visitor_ip": ip,
        "computed_at": "2025-01-01T00:00:00+00:00",
        "period_start": "2025-01-01T00:00:00+00:00",
        "period_end": "2025-01-02T00:00:00+00:00",
        "total_visits": visits,
        "total_time_seconds": 1.0,
        "avg_session_duration_seconds": 1.0,
        "is_recurring": recurring,
    }


class TestVisitorAnalyticsAPI:
    @pytest.fixture
    def mock_db_module(self):
        with patch("api.controllers.visitor_analytics.db") as mock:
            yield mock

    def test_empty(self, client, mock_db_module):
        mock_db_module.fetch_visitor_stats = AsyncMock(return_value=[])
        body = client.get("/visitor-analytics").json()
        assert body["visitors"] == []
        assert body["count"] == 0

    def test_no_raw_ip_and_stable_ids(self, client, mock_db_module):
        mock_data = [
            _row("1.2.3.4", 5, True),
            _row("2001:db8::1"),
            _row("1.2.3.4", 2, True),
        ]
        mock_db_module.fetch_visitor_stats = AsyncMock(return_value=mock_data)
        res = client.get("/visitor-analytics")
        assert res.status_code == 200
        text = res.text
        assert "1.2.3.4" not in text and "2001:db8" not in text
        assert "visitor_ip" not in text
        visitors = res.json()["visitors"]
        assert visitors[0]["id"] == visitors[2]["id"] == visitor_id("1.2.3.4")
        assert visitors[0]["id"] != visitors[1]["id"]
        assert len(visitors[0]["id"]) == 16

    def test_filter_by_id(self, client, mock_db_module):
        mock_data = [
            _row("1.2.3.4", 5, True),
            _row("5.6.7.8"),
        ]
        mock_db_module.fetch_visitor_stats = AsyncMock(return_value=mock_data)
        vid = visitor_id("5.6.7.8")
        res = client.get(f"/visitor-analytics?visitor_id={vid}&segment=false")
        body = res.json()
        assert body["count"] == 1
        assert body["visitors"][0]["id"] == vid
        assert body["filters"]["visitor_id"] == vid
        kwargs = mock_db_module.fetch_visitor_stats.call_args.kwargs
        assert "visitor_ip" not in kwargs
        assert kwargs["is_recurring"] is False

    def test_db_error_is_generic(self, client, mock_db_module):
        mock_db_module.fetch_visitor_stats = AsyncMock(side_effect=Exception("DB down secret"))
        res = client.get("/visitor-analytics")
        assert res.status_code == 500
        assert "secret" not in res.text

    def test_summary(self, client, mock_db_module):
        mock_summary = {
            "unique_visitors": 10,
            "total_visits": 50,
            "avg_session_duration_seconds": 300.0,
            "total_time_spent_seconds": 15000.0,
            "recurring_visitors": 5,
            "avg_visit_frequency_per_day": 2.5,
        }
        mock_db_module.get_visitor_analytics_summary = AsyncMock(return_value=mock_summary)
        body = client.get(
            "/visitor-analytics/summary?start_date=2025-01-01T00:00:00Z"
        ).json()
        assert body["summary"] == mock_summary
        assert body["filters"]["start_date"] == "2025-01-01T00:00:00Z"

    def test_summary_db_error(self, client, mock_db_module):
        mock_db_module.get_visitor_analytics_summary = AsyncMock(side_effect=Exception("x"))
        assert client.get("/visitor-analytics/summary").status_code == 500

    def test_by_id(self, client, mock_db_module):
        mock_db_module.fetch_visitor_stats = AsyncMock(
            return_value=[_row("1.2.3.4", 3)]
        )
        vid = visitor_id("1.2.3.4")
        res = client.get(f"/visitor-analytics/{vid}")
        body = res.json()
        assert "1.2.3.4" not in res.text
        assert body["visitor_id"] == vid
        assert body["count"] == 1
        assert body["records"][0]["id"] == vid

    def test_by_id_not_found(self, client, mock_db_module):
        mock_db_module.fetch_visitor_stats = AsyncMock(return_value=[])
        body = client.get("/visitor-analytics/unknown").json()
        assert body["count"] == 0
        assert body["records"] == []
        assert "message" in body

    def test_by_id_db_error(self, client, mock_db_module):
        mock_db_module.fetch_visitor_stats = AsyncMock(side_effect=Exception("x"))
        assert client.get("/visitor-analytics/abc").status_code == 500

    @pytest.mark.parametrize(
        "path",
        [
            "/visitor-analytics?start_date=nope",
            "/visitor-analytics?end_date=nope",
            "/visitor-analytics/summary?start_date=nope",
            "/visitor-analytics/abc?end_date=nope",
            "/events?before=nope",
            "/chat/general/history?before=nope",
            "/clicks/analytics?start_date=nope",
        ],
    )
    def test_invalid_dates_return_422(self, client, path):
        assert client.get(path).status_code == 422


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
