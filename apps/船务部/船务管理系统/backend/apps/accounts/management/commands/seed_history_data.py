import os
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import connections

from apps.accounts.history_seed import seed_history_database


class Command(BaseCommand):
    help = "Import a private shipping history seed into an empty data volume."

    def handle(self, *args, **options):
        data_dir = Path(os.environ.get("DATA_DIR", getattr(settings, "DATA_DIR", "/app/data")))
        db_path = Path(
            os.environ.get(
                "DB_PATH",
                settings.DATABASES["default"]["NAME"],
            )
        )
        media_root = Path(os.environ.get("MEDIA_ROOT", getattr(settings, "MEDIA_ROOT", data_dir / "media")))
        seed_db = Path(os.environ.get("SHIPPING_HISTORY_SEED_DB", data_dir / "import" / "history.sqlite3"))
        seed_media = Path(os.environ.get("SHIPPING_HISTORY_SEED_MEDIA", data_dir / "import" / "media"))
        marker_path = Path(os.environ.get("SHIPPING_HISTORY_SEED_MARKER", data_dir / ".history_seeded"))

        connections.close_all()
        result = seed_history_database(
            seed_db=seed_db,
            db_path=db_path,
            marker_path=marker_path,
            media_root=media_root,
            seed_media=seed_media,
        )

        messages = {
            "imported": "Shipping history seed imported.",
            "missing": f"Shipping history seed not found at {seed_db}; skipping.",
            "already_seeded": f"Shipping history seed marker exists at {marker_path}; skipping.",
            "non_empty": "Shipping database already has business rows; skipping history seed.",
        }
        self.stdout.write(messages[result])
