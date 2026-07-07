import os
import secrets
from pathlib import Path

from django.core.management.base import BaseCommand

from apps.accounts.models import User


class Command(BaseCommand):
    help = "Create or update the default shipping management admin user."

    def handle(self, *args, **options):
        username = os.environ.get("SHIPPING_ADMIN_USERNAME", "admin")
        password = os.environ.get("SHIPPING_ADMIN_PASSWORD", "")
        data_dir = Path(os.environ.get("DATA_DIR", "/app/data"))
        password_file = Path(os.environ.get("SHIPPING_ADMIN_PASSWORD_FILE", data_dir / ".admin_password"))
        display_name = os.environ.get("SHIPPING_ADMIN_DISPLAY_NAME", "管理员")
        generated_password = False

        if not password:
            if password_file.exists():
                password = password_file.read_text(encoding="utf-8").strip()
            else:
                password = secrets.token_urlsafe(18)
                password_file.parent.mkdir(parents=True, exist_ok=True)
                password_file.write_text(password + "\n", encoding="utf-8")
                generated_password = True

        user, created = User.objects.get_or_create(
            username=username,
            defaults={
                "display_name": display_name,
                "role": User.Role.SUPERVISOR,
                "is_staff": True,
                "is_superuser": True,
            },
        )

        changed_fields = []
        if password and (created or not user.has_usable_password() or os.environ.get("SHIPPING_ADMIN_PASSWORD")):
            user.set_password(password)
            changed_fields.append("password")
        if user.display_name != display_name:
            user.display_name = display_name
            changed_fields.append("display_name")
        if user.role != User.Role.SUPERVISOR:
            user.role = User.Role.SUPERVISOR
            changed_fields.append("role")
        if not user.is_staff:
            user.is_staff = True
            changed_fields.append("is_staff")
        if not user.is_superuser:
            user.is_superuser = True
            changed_fields.append("is_superuser")
        if changed_fields:
            user.save()

        action = "created" if created else "ready"
        self.stdout.write(self.style.SUCCESS(f"Default admin {username!r} {action}."))
        if generated_password:
            self.stdout.write(self.style.WARNING(f"Generated admin password saved to {password_file}."))
