import shutil
import sqlite3
from pathlib import Path


BUSINESS_TABLES = (
    "shipments_shipment",
    "shipments_shipmentitem",
    "shipments_shipmentsubitem",
    "emails_emailrecord",
    "master_data_customer",
    "master_data_factorymapping",
    "master_data_productmapping",
    "master_data_transportcompany",
)


def _quote_identifier(value):
    return '"' + value.replace('"', '""') + '"'


def _table_count(connection, table):
    try:
        row = connection.execute(f"select count(*) from {_quote_identifier(table)}").fetchone()
    except sqlite3.OperationalError:
        return 0
    return int(row[0] or 0)


def business_row_count(db_path):
    db_path = Path(db_path)
    if not db_path.exists() or db_path.stat().st_size == 0:
        return 0

    connection = sqlite3.connect(db_path)
    try:
        return sum(_table_count(connection, table) for table in BUSINESS_TABLES)
    finally:
        connection.close()


def _next_backup_path(db_path):
    base = db_path.with_name(f"{db_path.name}.pre-history-seed")
    if not base.exists():
        return base

    index = 1
    while True:
        candidate = db_path.with_name(f"{db_path.name}.pre-history-seed.{index}")
        if not candidate.exists():
            return candidate
        index += 1


def seed_history_database(seed_db, db_path, marker_path, media_root, seed_media=None):
    seed_db = Path(seed_db)
    db_path = Path(db_path)
    marker_path = Path(marker_path)
    media_root = Path(media_root)
    seed_media = Path(seed_media) if seed_media else None

    if not seed_db.exists():
        return "missing"
    if marker_path.exists():
        return "already_seeded"
    if business_row_count(db_path) > 0:
        return "non_empty"

    db_path.parent.mkdir(parents=True, exist_ok=True)
    marker_path.parent.mkdir(parents=True, exist_ok=True)
    if db_path.exists() and db_path.stat().st_size > 0:
        shutil.copy2(db_path, _next_backup_path(db_path))

    shutil.copy2(seed_db, db_path)

    if seed_media and seed_media.exists():
        media_root.mkdir(parents=True, exist_ok=True)
        shutil.copytree(seed_media, media_root, dirs_exist_ok=True)

    marker_path.write_text(f"seed_db={seed_db}\n", encoding="utf-8")
    return "imported"
