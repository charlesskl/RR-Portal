"""
Base class for all enterprise plugins.

Usage:
    from plugin_sdk import BasePlugin

    plugin = BasePlugin("plugin.yaml")
    app = plugin.app

    @app.get(f"{plugin.api_prefix}/items")
    async def list_items():
        return {"items": []}
"""

import os
import logging
from contextlib import asynccontextmanager
import yaml
import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

logger = logging.getLogger("plugin_sdk")


class BasePlugin:
    def __init__(self, manifest_path: str = "plugin.yaml"):
        with open(manifest_path) as f:
            self.manifest = yaml.safe_load(f)

        self.name: str = self.manifest["name"]
        self.version: str = self.manifest["version"]
        self.display_name: str = self.manifest.get("display_name", self.name)
        self.api_prefix: str = self.manifest["api_prefix"]
        self.department: str | None = self.manifest.get("department")
        self.description: str = self.manifest.get("description", "")
        self.permissions: list[str] = self.manifest.get("permissions", [])

        @asynccontextmanager
        async def lifespan(app: FastAPI):
            await self._register_with_core()
            await self.on_startup()
            logger.info("Plugin '%s' v%s started", self.name, self.version)
            yield
            await self.on_shutdown()
            logger.info("Plugin '%s' stopped", self.name)

        self.app = FastAPI(
            title=self.display_name,
            version=self.version,
            lifespan=lifespan,
            docs_url=f"{self.api_prefix}/docs",
            openapi_url=f"{self.api_prefix}/openapi.json",
            redoc_url=f"{self.api_prefix}/redoc",
        )

        self.app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

        # Default health endpoint
        @self.app.get(f"{self.api_prefix}/health")
        async def health():
            return {
                "status": "ok",
                "plugin": self.name,
                "version": self.version,
            }

        @self.app.get("/health")
        async def root_health():
            return {
                "status": "ok",
                "plugin": self.name,
                "version": self.version,
            }

    async def _register_with_core(self):
        core_url = os.getenv("CORE_SERVICE_URL", "http://core:8000")
        service_url = os.getenv("SERVICE_URL", f"http://{self.name}:8000")

        payload = {
            "name": self.name,
            "version": self.version,
            "display_name": self.display_name,
            "department": self.department,
            "description": self.description,
            "api_prefix": self.api_prefix,
            "service_url": service_url,
            "health_endpoint": f"{self.api_prefix}/health",
            "permissions": self.permissions,
        }

        for attempt in range(5):
            try:
                async with httpx.AsyncClient(timeout=10.0) as client:
                    resp = await client.post(
                        f"{core_url}/api/plugins/register", json=payload
                    )
                    if resp.status_code == 200:
                        logger.info("Registered with core successfully")
                        return
                    logger.warning("Registration returned %d", resp.status_code)
            except Exception as e:
                logger.warning(
                    "Registration attempt %d failed: %s", attempt + 1, e
                )
            import asyncio
            await asyncio.sleep(2 * (attempt + 1))

        logger.error("Could not register with core after 5 attempts")

    async def on_startup(self):
        """Override in subclass for custom startup logic."""
        pass

    async def on_shutdown(self):
        """Override in subclass for custom shutdown logic."""
        pass
