from unittest.mock import AsyncMock

from api import db


class TestPostAnalyticsClicks:
    def test_receive_valid_batch_of_click_events(self, internal_client, monkeypatch):
        mock_insert = AsyncMock(return_value=3)
        monkeypatch.setattr(db, "insert_click_events", mock_insert)

        payload = {
            "topic": "clicks",
            "events": [
                {
                    "ts": 1704067200000,
                    "seq": 1,
                    "session": {"pageId": "abc123"},
                    "page": {"url": "https://example.com", "path": "/", "title": "Home"},
                    "viewport": {"width": 1920, "height": 1080},
                    "pointer": {"x": 100, "y": 200},
                    "element": {"tag": "button", "id": "submit-btn"},
                },
                {
                    "ts": 1704067201000,
                    "seq": 2,
                    "session": {"pageId": "abc123"},
                    "page": {
                        "url": "https://example.com/about",
                        "path": "/about",
                        "title": "About",
                    },
                    "viewport": {"width": 1920, "height": 1080},
                    "pointer": {"x": 150, "y": 250},
                    "element": {"tag": "a", "id": "nav-about"},
                },
                {
                    "ts": 1704067202000,
                    "seq": 3,
                    "session": {"pageId": "abc123"},
                    "page": {
                        "url": "https://example.com/contact",
                        "path": "/contact",
                        "title": "Contact",
                    },
                    "viewport": {"width": 1920, "height": 1080},
                    "pointer": {"x": 200, "y": 300},
                    "element": {"tag": "button", "id": "contact-btn"},
                },
            ],
        }

        response = internal_client.post("/clicks/analytics", json=payload)

        assert response.status_code == 202
        body = response.json()
        assert body["accepted"] == 3
        assert body["message"] == "Events accepted"

        mock_insert.assert_called_once()
        call_args = mock_insert.call_args
        assert len(call_args[0][0]) == 3

    def test_receive_empty_events_array(self, internal_client, monkeypatch):
        mock_insert = AsyncMock(return_value=0)
        monkeypatch.setattr(db, "insert_click_events", mock_insert)

        payload = {"topic": "clicks", "events": []}

        response = internal_client.post("/clicks/analytics", json=payload)

        assert response.status_code == 202
        body = response.json()
        assert body["accepted"] == 0
        assert body["message"] == "No events provided"

        mock_insert.assert_not_called()

    def test_client_ip_extracted_from_x_forwarded_for_header(self, internal_client, monkeypatch):
        captured_ip = []

        async def mock_insert(events, client_ip):
            captured_ip.append(client_ip)
            return len(events)

        monkeypatch.setattr(db, "insert_click_events", mock_insert)

        payload = {
            "topic": "clicks",
            "events": [{"ts": 1704067200000, "seq": 1}],
        }

        response = internal_client.post(
            "/clicks/analytics",
            json=payload,
            headers={"x-forwarded-for": "192.168.1.100, 10.0.0.1"},
        )

        assert response.status_code == 202
        assert len(captured_ip) == 1
        assert captured_ip[0] == "192.168.1.100"

    def test_database_error_still_returns_202(self, internal_client, monkeypatch):
        mock_insert = AsyncMock(side_effect=Exception("Database connection failed"))
        monkeypatch.setattr(db, "insert_click_events", mock_insert)

        payload = {
            "topic": "clicks",
            "events": [{"ts": 1704067200000, "seq": 1}],
        }

        response = internal_client.post("/clicks/analytics", json=payload)

        assert response.status_code == 202
        body = response.json()
        assert body["accepted"] == 0
        assert "Events received but not stored" in body["message"]


class TestGetAnalyticsClicks:
    def test_fetch_click_events_with_default_parameters(self, client, monkeypatch):
        mock_events = [
            {"timestamp": "2024-01-01T00:00:00+00:00", "event": {"ts": 1704067200000}},
            {"timestamp": "2024-01-01T00:01:00+00:00", "event": {"ts": 1704067260000}},
        ]
        mock_fetch = AsyncMock(return_value=mock_events)
        monkeypatch.setattr(db, "fetch_click_events", mock_fetch)

        response = client.get("/clicks/analytics")

        assert response.status_code == 200
        body = response.json()
        assert body["count"] == 2
        assert len(body["events"]) == 2
        assert body["filters"]["limit"] == 100
        assert body["filters"]["start_date"] is None
        assert body["filters"]["end_date"] is None
        assert body["filters"]["page_path"] is None

    def test_fetch_with_optional_query_filters(self, client, monkeypatch):
        mock_fetch = AsyncMock(return_value=[])
        monkeypatch.setattr(db, "fetch_click_events", mock_fetch)

        response = client.get(
            "/clicks/analytics",
            params={
                "start_date": "2024-01-01T00:00:00Z",
                "end_date": "2024-01-02T00:00:00Z",
                "page_path": "/about",
                "limit": 50,
            },
        )

        assert response.status_code == 200
        body = response.json()
        assert body["filters"]["start_date"] == "2024-01-01T00:00:00Z"
        assert body["filters"]["end_date"] == "2024-01-02T00:00:00Z"
        assert body["filters"]["page_path"] == "/about"
        assert body["filters"]["limit"] == 50

        mock_fetch.assert_called_once_with(
            start_date="2024-01-01T00:00:00Z",
            end_date="2024-01-02T00:00:00Z",
            page_path="/about",
            limit=50,
        )

    def test_fetch_database_error_returns_empty_with_error(self, client, monkeypatch):
        mock_fetch = AsyncMock(side_effect=Exception("Database query failed"))
        monkeypatch.setattr(db, "fetch_click_events", mock_fetch)

        response = client.get("/clicks/analytics")

        assert response.status_code == 200
        body = response.json()
        assert body["events"] == []
        assert body["count"] == 0
        assert "error" in body
        assert "Database query failed" in body["error"]
