"""Optional Redis/RQ integration shared by the web app and worker.

Local SQLite development stays dependency-free at runtime: when ``REDIS_URL``
is unset, :func:`get_queue` returns ``None`` unless the caller explicitly marks
the queue as required. Docker sets ``QUEUE_REQUIRED=true`` and provides Redis.
"""

from __future__ import annotations

import os
from collections.abc import Callable
from typing import Any

from redis import Redis
from redis.exceptions import RedisError
from rq import Queue, Retry
from rq.serializers import JSONSerializer


class QueueUnavailable(RuntimeError):
    """Raised when a required background queue cannot be reached."""


def _as_bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _positive_int(name: str, default: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError:
        return default
    return value if value > 0 else default


def _nonnegative_int(name: str, default: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError:
        return default
    return value if value >= 0 else default


def get_queue(*, required: bool | None = None, check_connection: bool = True) -> Queue | None:
    """Return the configured RQ queue or ``None`` in optional local mode.

    RQ's JSON serializer is used on both sides of the queue. Enqueued arguments
    must therefore be JSON-compatible primitive values, lists, and mappings.
    """

    if required is None:
        required = _as_bool(os.getenv("QUEUE_REQUIRED"), default=False)

    redis_url = os.getenv("REDIS_URL", "").strip()
    if not redis_url:
        if required:
            raise QueueUnavailable("REDIS_URL is required but is not configured")
        return None

    timeout = _positive_int("REDIS_CONNECT_TIMEOUT_SECONDS", 3)
    try:
        connection = Redis.from_url(
            redis_url,
            socket_connect_timeout=timeout,
            socket_timeout=timeout,
            health_check_interval=30,
        )

        if check_connection:
            connection.ping()
    except (RedisError, ValueError) as exc:
        if required:
            raise QueueUnavailable("Redis is configured but unavailable") from exc
        return None

    return Queue(
        os.getenv("RQ_QUEUE_NAME", "qc-ai"),
        connection=connection,
        serializer=JSONSerializer,
        default_timeout=_positive_int("RQ_JOB_TIMEOUT_SECONDS", 900),
    )


def enqueue(function: str | Callable[..., Any], /, *args: Any, **kwargs: Any):
    """Enqueue a JSON-safe call, returning ``None`` when local queueing is off."""

    queue = get_queue()
    if queue is None:
        return None

    max_retries = min(_nonnegative_int("OPENAI_MAX_RETRIES", 2), 10)
    retry_intervals = [min(10 * (2**attempt), 300) for attempt in range(max_retries)]
    retry = Retry(max=max_retries, interval=retry_intervals) if max_retries else None

    return queue.enqueue(
        function,
        *args,
        **kwargs,
        job_timeout=_positive_int("RQ_JOB_TIMEOUT_SECONDS", 900),
        result_ttl=_positive_int("RQ_RESULT_TTL_SECONDS", 604800),
        failure_ttl=_positive_int("RQ_FAILURE_TTL_SECONDS", 1209600),
        retry=retry,
    )
