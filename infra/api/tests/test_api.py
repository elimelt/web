import api.controllers.system as system_module


def test_health(client):
    res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["redis"] == "healthy"


def test_cache_set(internal_client):
    key = "greeting"
    payload = {"value": "hello", "ttl": 5}
    res_set = internal_client.post(f"/cache/{key}", json=payload)
    assert res_set.status_code == 200
    body_set = res_set.json()
    assert body_set["success"] is True
    assert body_set["key"] == key
    assert body_set["value"] == payload["value"]


def test_cache_get(internal_client):
    key = "nonexistent"
    res_get = internal_client.get(f"/cache/{key}")
    assert res_get.status_code == 200
    body_get = res_get.json()
    assert body_get["found"] is False


def test_visitors_empty(client):
    res = client.get("/visitors")
    assert res.status_code == 200
    data = res.json()
    assert data["active_count"] == 0
    assert isinstance(data["active_visitors"], list)
    assert isinstance(data["recent_visits"], list)


def test_system_with_mocked_subprocess(client, monkeypatch):
    class FakeCompleted:
        def __init__(self, returncode, stdout):
            self.returncode = returncode
            self.stdout = stdout
            self.stderr = ""

    def fake_run(args, check=False, capture_output=False, text=False, timeout=None):
        if args[:2] == ["docker", "ps"]:
            return FakeCompleted(0, "api|Up 5 minutes|myimage:1.0\nredis|Up 10 minutes|redis:7")
        if args[:2] == ["docker", "stats"]:
            return FakeCompleted(
                0,
                "api|12.3%|50.0MiB / 1.0GiB|5.0%\nredis|1.0%|20.0MiB / 1.0GiB|2.0%",
            )
        return FakeCompleted(1, "")

    monkeypatch.setattr(system_module.subprocess, "run", fake_run)

    res = client.get("/system")
    assert res.status_code == 200
    data = res.json()
    assert data["total_containers"] == 2
    names = {s["name"] for s in data["services"]}
    assert names == {"api", "redis"}
    api_service = next(s for s in data["services"] if s["name"] == "api")
    assert api_service["cpu_percent"] == 12.3
    assert api_service["memory_mb"] == 50.0
    assert api_service["memory_percent"] == 5.0


def test_system_gib_memory_parsing(client, monkeypatch):
    """Test that containers using GiB of memory are parsed correctly."""

    class FakeCompleted:
        def __init__(self, returncode, stdout):
            self.returncode = returncode
            self.stdout = stdout
            self.stderr = ""

    def fake_run(args, check=False, capture_output=False, text=False, timeout=None):
        if args[:2] == ["docker", "ps"]:
            return FakeCompleted(
                0, "internal-api|Up 4 days|devstack-internal-api\nredis|Up 4 days|redis:7"
            )
        if args[:2] == ["docker", "stats"]:
            return FakeCompleted(
                0,
                "internal-api|0.5%|17.2GiB / 96.0GiB|17.92%\nredis|0.27%|25.03MiB / 96.0GiB|0.03%",
            )
        return FakeCompleted(1, "")

    monkeypatch.setattr(system_module.subprocess, "run", fake_run)

    res = client.get("/system")
    assert res.status_code == 200
    data = res.json()
    assert data["total_containers"] == 2

    internal_api = next(s for s in data["services"] if s["name"] == "internal-api")
    assert internal_api["cpu_percent"] == 0.5
    assert internal_api["memory_mb"] == 17.2 * 1024  # 17612.8 MB
    assert internal_api["memory_percent"] == 17.92

    redis_service = next(s for s in data["services"] if s["name"] == "redis")
    assert redis_service["memory_mb"] == 25.03
