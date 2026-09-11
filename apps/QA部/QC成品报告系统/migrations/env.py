from __future__ import annotations

import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

os.environ["QC_SKIP_APP_INIT"] = "true"
from app import Base  # noqa: E402


config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

database_url = os.getenv("DATABASE_URL")
if database_url:
    if database_url.startswith("postgres://"):
        database_url = database_url.replace("postgres://", "postgresql://", 1)
    config.set_main_option("sqlalchemy.url", database_url.replace("%", "%%"))

target_metadata = Base.metadata

AI_TABLES = {
    "po_imports",
    "po_items",
    "extracted_fields",
    "report_sources",
    "photo_checklist_templates",
    "report_photo_slots",
    "photo_evidence",
    "ai_analysis_runs",
    "ai_observations",
    "ai_findings",
    "qc_decisions",
}


def include_object(obj, name, type_, reflected, compare_to):
    scope = os.getenv("ALEMBIC_SCOPE", "all")
    if scope == "legacy" and type_ == "table":
        return name not in AI_TABLES
    if scope == "ai" and type_ == "table":
        return name in AI_TABLES
    if type_ in {"index", "unique_constraint", "foreign_key_constraint"}:
        table_name = getattr(getattr(obj, "table", None), "name", None)
        if scope == "legacy":
            return table_name not in AI_TABLES
        if scope == "ai":
            return table_name in AI_TABLES
    return True


def run_migrations_offline():
    context.configure(url=config.get_main_option("sqlalchemy.url"), target_metadata=target_metadata, literal_binds=True, dialect_opts={"paramstyle": "named"}, include_object=include_object, compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online():
    connectable = engine_from_config(config.get_section(config.config_ini_section, {}), prefix="sqlalchemy.", poolclass=pool.NullPool)
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata, include_object=include_object, compare_type=True)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
