import logging
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.plugin import Plugin

logger = logging.getLogger("enterprise.plugins")


async def register_plugin(db: AsyncSession, data: dict) -> Plugin:
    """Register or update a plugin in the registry."""
    result = await db.execute(
        select(Plugin).where(Plugin.name == data["name"])
    )
    plugin = result.scalar_one_or_none()

    if plugin:
        for key, value in data.items():
            if hasattr(plugin, key) and value is not None:
                setattr(plugin, key, value)
        logger.info("Plugin '%s' updated to v%s", data["name"], data.get("version"))
    else:
        plugin = Plugin(**data)
        db.add(plugin)
        logger.info("Plugin '%s' registered (v%s)", data["name"], data.get("version"))

    await db.flush()
    await db.refresh(plugin)
    return plugin


async def get_all_plugins(db: AsyncSession) -> list[Plugin]:
    result = await db.execute(select(Plugin).order_by(Plugin.name))
    return list(result.scalars().all())


async def get_enabled_plugins(db: AsyncSession) -> list[Plugin]:
    result = await db.execute(
        select(Plugin).where(Plugin.is_enabled == True).order_by(Plugin.name)
    )
    return list(result.scalars().all())


async def toggle_plugin(db: AsyncSession, plugin_name: str, enabled: bool) -> Plugin:
    result = await db.execute(
        select(Plugin).where(Plugin.name == plugin_name)
    )
    plugin = result.scalar_one_or_none()
    if not plugin:
        raise ValueError(f"Plugin '{plugin_name}' not found")
    plugin.is_enabled = enabled
    await db.flush()
    await db.refresh(plugin)
    logger.info("Plugin '%s' %s", plugin_name, "enabled" if enabled else "disabled")
    return plugin
