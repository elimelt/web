import asyncio
import logging
from typing import Any


def _get_pool_stats(client) -> dict[str, Any]:
    stats: dict[str, Any] = {}
    try:
        pool = getattr(client, "connection_pool", None)
        if not pool:
            return stats
        stats["max"] = getattr(pool, "max_connections", None)
        created = getattr(pool, "_created_connections", None)
        in_use = getattr(pool, "_in_use_connections", None)
        available = getattr(pool, "_available_connections", None)
        if created is not None:
            stats["created"] = int(created) if isinstance(created, int) else len(created)
        if in_use is not None:
            stats["in_use"] = len(in_use)
        if available is not None:
            stats["available"] = len(available)
        q = getattr(pool, "queue", None)
        if q is not None and hasattr(q, "qsize"):
            try:
                stats["queue"] = q.qsize()
            except Exception:
                pass
    except Exception:
        pass
    return stats


class PubSubDebugWrapper:
    def __init__(self, inner, logger: logging.Logger, client_for_stats):
        self._inner = inner
        self._logger = logger
        self._client_for_stats = client_for_stats

    def __getattr__(self, name: str):
        attr = getattr(self._inner, name)
        if asyncio.iscoroutinefunction(attr):

            async def _wrapped(*args, **kwargs):
                if name in ("subscribe", "unsubscribe", "close", "aclose"):
                    self._logger.debug(
                        "redis.pubsub.%s args=%s kwargs=%s pool=%s",
                        name,
                        args,
                        kwargs,
                        _get_pool_stats(self._client_for_stats),
                    )
                try:
                    return await attr(*args, **kwargs)
                except Exception as e:
                    self._logger.warning(
                        "redis.pubsub.%s error=%s pool=%s",
                        name,
                        repr(e),
                        _get_pool_stats(self._client_for_stats),
                    )
                    raise

            return _wrapped
        return attr


class RedisDebugWrapper:
    def __init__(self, inner, logger: logging.Logger):
        self._inner = inner
        self._logger = logger

    @property
    def connection_pool(self):
        return getattr(self._inner, "connection_pool", None)

    def pubsub(self, *args, **kwargs):
        self._logger.debug("redis.pubsub() pool=%s", _get_pool_stats(self._inner))
        ps = self._inner.pubsub(*args, **kwargs)
        return PubSubDebugWrapper(ps, self._logger, self._inner)

    def __getattr__(self, name: str):
        attr = getattr(self._inner, name)
        if not callable(attr):
            return attr

        if asyncio.iscoroutinefunction(attr):

            async def _wrapped(*args, **kwargs):
                self._logger.debug(
                    "redis.%s args=%s kwargs=%s pool=%s",
                    name,
                    _short_args(args),
                    _short_kwargs(kwargs),
                    _get_pool_stats(self._inner),
                )
                try:
                    res = await attr(*args, **kwargs)
                    return res
                except Exception as e:
                    self._logger.warning(
                        "redis.%s error=%s pool=%s", name, repr(e), _get_pool_stats(self._inner)
                    )
                    raise

            return _wrapped

        def _wrapped_sync(*args, **kwargs):
            try:
                return attr(*args, **kwargs)
            except Exception as e:
                self._logger.warning(
                    "redis.%s (sync) error=%s pool=%s", name, repr(e), _get_pool_stats(self._inner)
                )
                raise

        return _wrapped_sync


def _short_args(args: tuple[Any, ...]) -> tuple[Any, ...]:
    if not args:
        return args
    trimmed = []
    for a in args:
        if isinstance(a, str) and len(a) > 200:
            trimmed.append(a[:200] + "…")
        else:
            trimmed.append(a)
    return tuple(trimmed)


def _short_kwargs(kwargs: dict[str, Any]) -> dict[str, Any]:
    if not kwargs:
        return kwargs
    out: dict[str, Any] = {}
    for k, v in kwargs.items():
        if isinstance(v, str) and len(v) > 200:
            out[k] = v[:200] + "…"
        else:
            out[k] = v
    return out


def wrap_redis_client(client, logger: logging.Logger) -> RedisDebugWrapper:
    return RedisDebugWrapper(client, logger)
