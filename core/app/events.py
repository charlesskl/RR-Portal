"""
Redis-based event bus for inter-plugin communication.

Usage (publish from any service):
    from app.events import event_bus
    await event_bus.publish("employee.created", {"id": 1, "name": "Alice"})

Usage (subscribe in a plugin):
    @event_bus.on("employee.created")
    async def handle_employee_created(data):
        ...
"""

import json
import asyncio
import logging
from typing import Callable, Awaitable
import redis.asyncio as redis
from app.config import get_settings

logger = logging.getLogger("enterprise.events")


class EventBus:
    def __init__(self):
        self._redis: redis.Redis | None = None
        self._handlers: dict[str, list[Callable]] = {}
        self._listener_task: asyncio.Task | None = None

    async def connect(self):
        settings = get_settings()
        self._redis = redis.from_url(settings.REDIS_URL, decode_responses=True)
        logger.info("EventBus connected to Redis")

    async def disconnect(self):
        if self._listener_task:
            self._listener_task.cancel()
        if self._redis:
            await self._redis.aclose()
            logger.info("EventBus disconnected")

    async def publish(self, event_type: str, data: dict):
        if not self._redis:
            logger.warning("EventBus not connected, dropping event: %s", event_type)
            return
        message = json.dumps({"type": event_type, "data": data})
        await self._redis.publish("enterprise:events", message)
        logger.debug("Published event: %s", event_type)

    def on(self, event_type: str):
        """Decorator to register an event handler."""

        def decorator(func: Callable[[dict], Awaitable]):
            self._handlers.setdefault(event_type, []).append(func)
            return func

        return decorator

    async def start_listening(self):
        if not self._redis:
            return
        self._listener_task = asyncio.create_task(self._listen())

    async def _listen(self):
        pubsub = self._redis.pubsub()
        await pubsub.subscribe("enterprise:events")
        logger.info("EventBus listening for events...")
        try:
            async for message in pubsub.listen():
                if message["type"] != "message":
                    continue
                try:
                    payload = json.loads(message["data"])
                    event_type = payload["type"]
                    data = payload["data"]
                    handlers = self._handlers.get(event_type, [])
                    for handler in handlers:
                        try:
                            await handler(data)
                        except Exception:
                            logger.exception(
                                "Handler %s failed for event %s",
                                handler.__name__,
                                event_type,
                            )
                except (json.JSONDecodeError, KeyError):
                    logger.warning("Malformed event message: %s", message["data"])
        except asyncio.CancelledError:
            await pubsub.unsubscribe("enterprise:events")
            await pubsub.aclose()


event_bus = EventBus()
