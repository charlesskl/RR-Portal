import logging
from plugin_sdk import BasePlugin, PluginEventBus
from app.models import db, Base
from app.router import router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)

event_bus = PluginEventBus()


class IndonesiaPlugin(BasePlugin):
    async def on_startup(self):
        await db.init_tables(Base)
        await event_bus.connect()
        await event_bus.start_listening()

    async def on_shutdown(self):
        await event_bus.disconnect()
        await db.close()


plugin = IndonesiaPlugin("plugin.yaml")
app = plugin.app

# Register routes
app.include_router(router)
