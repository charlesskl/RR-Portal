"""Entrypoint for the AI/PO extraction RQ worker container."""

from __future__ import annotations

import os
import socket
import sys

from rq import Worker
from rq.serializers import JSONSerializer

from task_queue import QueueUnavailable, get_queue


def check_dependencies() -> None:
    """Fail fast when the worker's required Redis dependency is unavailable."""

    get_queue(required=True, check_connection=True)


def main() -> int:
    try:
        queue = get_queue(required=True, check_connection=True)
    except QueueUnavailable as exc:
        print(f"worker startup failed: {exc}", file=sys.stderr)
        return 1

    if "--check" in sys.argv[1:]:
        return 0

    worker_name = os.getenv("RQ_WORKER_NAME", "").strip() or f"qc-worker-{socket.gethostname()}"
    worker = Worker(
        [queue],
        connection=queue.connection,
        serializer=JSONSerializer,
        name=worker_name,
    )
    # Required for delayed RQ retry intervals configured by task_queue.enqueue.
    worker.work(with_scheduler=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
