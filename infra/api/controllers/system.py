import json
import subprocess
from typing import Any

from fastapi import APIRouter, HTTPException, Response

from api.dependencies import OptionalRedis

router = APIRouter(tags=["system"])


async def _get_system_stats(redis: OptionalRedis) -> dict[str, Any]:
    """Get system stats for all containers, with optional Redis caching."""
    if redis:
        cached = await redis.get("system_stats")
        if cached:
            return json.loads(cached)

    try:
        result = subprocess.run(
            ["docker", "ps", "--format", "{{.Names}}|{{.Status}}|{{.Image}}"],
            check=False,
            capture_output=True,
            text=True,
            timeout=3,
        )

        if result.returncode != 0:
            return {"error": "Failed to get container list"}

        container_info = {}
        for line in result.stdout.strip().split("\n"):
            if not line:
                continue
            parts = line.split("|")
            if len(parts) == 3:
                name, status, image = parts
                container_info[name] = {"status": status, "image": image}

        container_names = list(container_info.keys())

        stats_map = {}
        if container_names:
            stats_result = subprocess.run(
                [
                    "docker",
                    "stats",
                    "--no-stream",
                    "--format",
                    "{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}",
                ]
                + container_names,
                check=False,
                capture_output=True,
                text=True,
                timeout=5,
            )

            if stats_result.returncode == 0 and stats_result.stdout:
                for line in stats_result.stdout.strip().split("\n"):
                    if not line:
                        continue
                    parts = line.split("|")
                    if len(parts) == 4:
                        try:
                            name = parts[0]
                            cpu_percent = float(parts[1].replace("%", ""))
                            mem_usage = parts[2].split("/")[0].strip()

                            # Parse memory with proper unit handling
                            if "GiB" in mem_usage:
                                memory_mb = float(mem_usage.replace("GiB", "").strip()) * 1024
                            elif "MiB" in mem_usage:
                                memory_mb = float(mem_usage.replace("MiB", "").strip())
                            elif "KiB" in mem_usage:
                                memory_mb = float(mem_usage.replace("KiB", "").strip()) / 1024
                            elif "B" in mem_usage:
                                memory_mb = float(mem_usage.replace("B", "").strip()) / (
                                    1024 * 1024
                                )
                            else:
                                memory_mb = 0.0

                            memory_percent = float(parts[3].replace("%", ""))

                            stats_map[name] = {
                                "cpu_percent": round(cpu_percent, 2),
                                "memory_mb": round(memory_mb, 2),
                                "memory_percent": round(memory_percent, 2),
                            }
                        except Exception:
                            pass

        services = []
        for name in container_names:
            info = container_info.get(name, {})
            stats = stats_map.get(
                name, {"cpu_percent": 0.0, "memory_mb": 0.0, "memory_percent": 0.0}
            )

            services.append(
                {
                    "name": name,
                    "status": info.get("status", "unknown"),
                    "image": info.get("image", "unknown"),
                    **stats,
                }
            )

        response = {
            "total_containers": len(services),
            "services": sorted(services, key=lambda x: x["name"]),
        }

        if redis:
            await redis.setex("system_stats", 10, json.dumps(response))

        return response
    except subprocess.TimeoutExpired:
        return {"error": "Docker command timed out"}
    except Exception as e:
        return {"error": str(e)}


@router.get("/system")
async def get_system(redis: OptionalRedis) -> dict[str, Any]:
    """Get system stats for all containers."""
    return await _get_system_stats(redis)


@router.get("/system/{service}")
async def get_system_service(
    service: str, redis: OptionalRedis, response: Response
) -> dict[str, Any]:
    """Get system stats for a specific service/container.

    Returns HTTP 200 if service is healthy (status starts with 'Up'),
    HTTP 503 if unhealthy, HTTP 404 if service not found.
    """
    stats = await _get_system_stats(redis)

    if "error" in stats:
        response.status_code = 503
        return stats

    # Find the specific service
    for svc in stats.get("services", []):
        if svc["name"] == service:
            # Set status code based on health
            if not svc.get("status", "").startswith("Up"):
                response.status_code = 503
            return svc

    raise HTTPException(status_code=404, detail=f"Service '{service}' not found")
