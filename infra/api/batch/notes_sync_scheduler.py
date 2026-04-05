import asyncio
import logging
import os

from api.notes_sync import sync_notes_with_job

logger = logging.getLogger(__name__)


async def run_sync_job(force: bool = False) -> dict:
    github_token = os.getenv("GITHUB_TOKEN")
    result = await sync_notes_with_job(token=github_token, force=force)
    return result


async def start_notes_sync_scheduler(stop_event: asyncio.Event) -> list[asyncio.Task]:
    async def _scheduler_loop() -> None:
        interval_hours = int(os.getenv("NOTES_SYNC_INTERVAL_HOURS", "6"))
        interval_seconds = interval_hours * 3600

        logger.info(
            "Notes sync scheduler started (interval=%dh)",
            interval_hours,
        )

        try:
            logger.info("Running initial notes sync")
            result = await run_sync_job(force=False)
            logger.info(
                "Initial notes sync completed: status=%s completed=%s failed=%s",
                result.get("job_status"),
                result.get("completed"),
                result.get("failed"),
            )
        except Exception:
            logger.exception("Initial notes sync failed")

        while not stop_event.is_set():
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=interval_seconds)
                break
            except TimeoutError:
                pass

            try:
                logger.info("Running scheduled notes sync")
                result = await run_sync_job(force=False)
                logger.info(
                    "Scheduled notes sync completed: status=%s completed=%s failed=%s",
                    result.get("job_status"),
                    result.get("completed"),
                    result.get("failed"),
                )
            except Exception:
                logger.exception("Scheduled notes sync failed")

        logger.info("Notes sync scheduler stopped")

    task = asyncio.create_task(_scheduler_loop())
    return [task]
