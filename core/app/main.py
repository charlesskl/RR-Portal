import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

from app.config import get_settings
from app.database import init_db, async_session
from app.models.user import User
from app.auth.jwt import hash_password
from app.events import event_bus
from app.middleware.logging import RequestLoggingMiddleware
from app.middleware.error_handler import ErrorHandlerMiddleware

from app.auth.router import router as auth_router
from app.plugin_manager.router import router as plugin_router
from app.admin.router import router as admin_router

settings = get_settings()

logging.basicConfig(
    level=logging.DEBUG if settings.DEBUG else logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger("enterprise.core")


async def bootstrap_admin():
    """Create the default admin user if it doesn't exist."""
    async with async_session() as db:
        result = await db.execute(
            select(User).where(User.username == settings.ADMIN_USERNAME)
        )
        if result.scalar_one_or_none() is None:
            admin = User(
                username=settings.ADMIN_USERNAME,
                email=settings.ADMIN_EMAIL,
                hashed_password=hash_password(settings.ADMIN_PASSWORD),
                full_name="System Admin",
                role="admin",
                permissions=["*"],
            )
            db.add(admin)
            await db.commit()
            logger.info("Admin user '%s' created", settings.ADMIN_USERNAME)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ─── Startup ───
    logger.info("Starting %s v%s", settings.APP_NAME, settings.VERSION)
    await init_db()
    await bootstrap_admin()
    await event_bus.connect()
    await event_bus.start_listening()
    logger.info("Core system ready")

    yield

    # ─── Shutdown ───
    await event_bus.disconnect()
    logger.info("Core system stopped")


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.VERSION,
    lifespan=lifespan,
)

# ─── Middleware (order matters: first added = outermost) ───
app.add_middleware(ErrorHandlerMiddleware)
app.add_middleware(RequestLoggingMiddleware)
cors_origins = [o.strip() for o in settings.ALLOWED_ORIGINS.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Routers ───
app.include_router(auth_router)
app.include_router(plugin_router)
app.include_router(admin_router)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "core", "version": settings.VERSION}
