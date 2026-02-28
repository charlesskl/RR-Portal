import logging
import asyncio
from datetime import datetime, timezone
import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.plugin import Plugin

logger = logging.getLogger("enterprise.health")


async def check_plugin_health(plugin: Plugin) -> str:
    """Ping a single plugin's health endpoint. Returns 'healthy' or 'unhealthy'."""
    url = f"{plugin.service_url}{plugin.health_endpoint or '/health'}"
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(url)
            return "healthy" if resp.status_code == 200 else "unhealthy"
    except Exception as e:
        logger.warning("Health check failed for '%s' (%s): %s", plugin.name, url, e)
        return "unhealthy"


async def check_all_plugins(db: AsyncSession) -> list[dict]:
    """Run health checks on all enabled plugins concurrently."""
    result = await db.execute(
        select(Plugin).where(Plugin.is_enabled == True)
    )
    plugins = list(result.scalars().all())
    if not plugins:
        return []

    statuses = await asyncio.gather(
        *[check_plugin_health(p) for p in plugins]
    )

    report = []
    now = datetime.now(timezone.utc)
    for plugin, status in zip(plugins, statuses):
        plugin.status = status
        plugin.last_health_check = now
        report.append(
            {
                "name": plugin.name,
                "status": status,
                "service_url": plugin.service_url,
                "version": plugin.version,
            }
        )
    await db.flush()
    return report
