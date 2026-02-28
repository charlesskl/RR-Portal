"""
Event bus client for plugins.

Allows plugins to publish events and subscribe to events from other plugins.

Usage:
    bus = PluginEventBus()
    await bus.connect()

    # Publish
    await bus.publish("employee.created", {"id": 1})

    # Subscribe
    @bus.on("invoice.paid")
    async def handle_payment(data):
        print(f"Invoice {data['id']} was paid")
    await bus.start_listening()
"""

import os
import json
import asyncio
import logging
from typing import Callable, Awaitable
import redis.asyncio as redis

logger = logging.getLogger("plugin_sdk.events")


class PluginEventBus:
    CHANNEL = "enterprise:events"

    def __init__(self):
        self._redis: redis.Redis | None = None
        self._handlers: dict[str, list[Callable]] = {}
        self._listener_task: asyncio.Task | None = None

    async def connect(self):
        url = os.getenv("REDIS_URL", "redis://redis:6379/0")
        self._redis = redis.from_url(url, decode_responses=True)

    async def disconnect(self):
        if self._listener_task:
            self._listener_task.cancel()
        if self._redis:
            await self._redis.aclose()

    async def publish(self, event_type: str, data: dict):
        if not self._redis:
            return
        message = json.dumps({"type": event_type, "data": data})
        await self._redis.publish(self.CHANNEL, message)
        logger.debug("Published: %s", event_type)

    def on(self, event_type: str):
        def decorator(func: Callable[[dict], Awaitable]):
            self._handlers.setdefault(event_type, []).append(func)
            return func

        return decorator

    async def start_listening(self):
        if not self._redis or not self._handlers:
            return
        self._listener_task = asyncio.create_task(self._listen())

    async def _listen(self):
        pubsub = self._redis.pubsub()
        await pubsub.subscribe(self.CHANNEL)
        try:
            async for message in pubsub.listen():
                if message["type"] != "message":
                    continue
                try:
                    payload = json.loads(message["data"])
                    event_type = payload["type"]
                    data = payload["data"]
                    for handler in self._handlers.get(event_type, []):
                        try:
                            await handler(data)
                        except Exception:
                            logger.exception(
                                "Handler failed for %s", event_type
                            )
                except (json.JSONDecodeError, KeyError):
                    pass
        except asyncio.CancelledError:
            await pubsub.unsubscribe(self.CHANNEL)
            await pubsub.aclose()
