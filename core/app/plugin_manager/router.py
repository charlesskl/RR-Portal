from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from app.database import get_db
from app.auth.dependencies import get_current_user, require_admin
from app.models.user import User
from app.plugin_manager.registry import (
    register_plugin,
    get_all_plugins,
    get_enabled_plugins,
    toggle_plugin,
)
from app.plugin_manager.health import check_all_plugins

router = APIRouter(prefix="/api/plugins", tags=["Plugin Management"])


# ─── Schemas ───


class PluginRegisterRequest(BaseModel):
    name: str
    version: str
    display_name: str | None = None
    department: str | None = None
    description: str | None = None
    api_prefix: str
    service_url: str
    health_endpoint: str | None = None
    permissions: list[str] = []


class PluginResponse(BaseModel):
    id: int
    name: str
    display_name: str | None
    version: str
    department: str | None
    description: str | None
    api_prefix: str
    service_url: str
    is_enabled: bool
    status: str | None


class PluginToggleRequest(BaseModel):
    enabled: bool


# ─── Routes ───


@router.post("/register", response_model=PluginResponse)
async def api_register_plugin(
    req: PluginRegisterRequest,
    db: AsyncSession = Depends(get_db),
):
    """Called by plugins on startup to self-register."""
    plugin = await register_plugin(db, req.model_dump())
    return _to_response(plugin)


@router.get("", response_model=list[PluginResponse])
async def list_plugins(
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    plugins = await get_all_plugins(db)
    return [_to_response(p) for p in plugins]


@router.get("/enabled", response_model=list[PluginResponse])
async def list_enabled_plugins(
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    plugins = await get_enabled_plugins(db)
    return [_to_response(p) for p in plugins]


@router.patch("/{plugin_name}/toggle", response_model=PluginResponse)
async def api_toggle_plugin(
    plugin_name: str,
    req: PluginToggleRequest,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    try:
        plugin = await toggle_plugin(db, plugin_name, req.enabled)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return _to_response(plugin)


@router.get("/health")
async def api_health_check(
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    report = await check_all_plugins(db)
    return {"plugins": report}


def _to_response(plugin) -> PluginResponse:
    return PluginResponse(
        id=plugin.id,
        name=plugin.name,
        display_name=plugin.display_name,
        version=plugin.version,
        department=plugin.department,
        description=plugin.description,
        api_prefix=plugin.api_prefix,
        service_url=plugin.service_url,
        is_enabled=plugin.is_enabled,
        status=plugin.status,
    )
