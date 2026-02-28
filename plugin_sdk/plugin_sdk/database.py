"""
Database helpers for plugins.

Each plugin gets its own schema to keep data isolated.
"""

import os
from sqlalchemy.ext.asyncio import (
    create_async_engine,
    AsyncSession,
    async_sessionmaker,
)
from sqlalchemy import MetaData
from sqlalchemy.orm import DeclarativeBase


class PluginDatabase:
    def __init__(self, schema_name: str):
        self.schema_name = schema_name
        db_url = os.getenv(
            "DATABASE_URL",
            "postgresql+asyncpg://postgres:postgres@db:5432/enterprise",
        )
        self.engine = create_async_engine(
            db_url,
            echo=os.getenv("DEBUG", "false").lower() == "true",
            pool_size=10,
            max_overflow=5,
        )
        self.async_session = async_sessionmaker(
            self.engine,
            class_=AsyncSession,
            expire_on_commit=False,
        )

    def create_base(self) -> type[DeclarativeBase]:
        """Create a DeclarativeBase scoped to this plugin's schema."""
        schema_metadata = MetaData(schema=self.schema_name)

        class PluginBase(DeclarativeBase):
            metadata = schema_metadata

        return PluginBase

    async def get_session(self):
        async with self.async_session() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    async def init_tables(self, base):
        """Create all tables for this plugin's models."""
        async with self.engine.begin() as conn:
            await conn.run_sync(base.metadata.create_all)

    async def close(self):
        await self.engine.dispose()
