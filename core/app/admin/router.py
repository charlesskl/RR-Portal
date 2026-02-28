from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from pydantic import BaseModel
from datetime import datetime

from app.database import get_db
from app.auth.dependencies import require_admin
from app.models.user import User
from app.models.plugin import Plugin
from app.models.audit import AuditLog

router = APIRouter(prefix="/api/admin", tags=["Administration"])


# ─── Schemas ───


class DashboardResponse(BaseModel):
    total_users: int
    active_users: int
    total_plugins: int
    enabled_plugins: int
    healthy_plugins: int


class AuditLogResponse(BaseModel):
    id: int
    user_id: int | None
    username: str | None
    action: str
    resource_type: str | None
    resource_id: str | None
    detail: str | None
    created_at: datetime | None


# ─── Routes ───


@router.get("/dashboard", response_model=DashboardResponse)
async def dashboard(
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    total_users = (await db.execute(func.count(User.id))).scalar() or 0
    active_users = (
        await db.execute(
            select(func.count(User.id)).where(User.is_active == True)
        )
    ).scalar() or 0
    total_plugins = (await db.execute(func.count(Plugin.id))).scalar() or 0
    enabled_plugins = (
        await db.execute(
            select(func.count(Plugin.id)).where(Plugin.is_enabled == True)
        )
    ).scalar() or 0
    healthy_plugins = (
        await db.execute(
            select(func.count(Plugin.id)).where(Plugin.status == "healthy")
        )
    ).scalar() or 0

    return DashboardResponse(
        total_users=total_users,
        active_users=active_users,
        total_plugins=total_plugins,
        enabled_plugins=enabled_plugins,
        healthy_plugins=healthy_plugins,
    )


@router.get("/audit", response_model=list[AuditLogResponse])
async def list_audit_logs(
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    limit: int = Query(default=50, le=200),
    offset: int = Query(default=0, ge=0),
):
    result = await db.execute(
        select(AuditLog)
        .order_by(AuditLog.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    logs = result.scalars().all()
    return [
        AuditLogResponse(
            id=log.id,
            user_id=log.user_id,
            username=log.username,
            action=log.action,
            resource_type=log.resource_type,
            resource_id=log.resource_id,
            detail=log.detail,
            created_at=log.created_at,
        )
        for log in logs
    ]
