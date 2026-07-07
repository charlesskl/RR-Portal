from pathlib import Path

from django.conf import settings
from django.contrib import admin
from django.http import FileResponse, Http404, JsonResponse
from django.urls import include, path, re_path
from django.views.static import serve

from apps.shipments import views as shipment_views


def health(_request):
    return JsonResponse({"status": "ok"})


def _safe_frontend_file(relative_path):
    dist_dir = settings.FRONTEND_DIST_DIR.resolve()
    target = (dist_dir / relative_path).resolve()
    if not target.is_relative_to(dist_dir) or not target.is_file():
        raise Http404("frontend asset not found")
    return FileResponse(open(target, "rb"))


def frontend_asset(_request, path):
    return _safe_frontend_file(Path("assets") / path)


def frontend_public(_request, path):
    return _safe_frontend_file(path)


def spa_index(_request, *_args, **_kwargs):
    return _safe_frontend_file("index.html")


urlpatterns = [
    path("health", health),
    path("health/", health),
    path("admin/", admin.site.urls),
    path("api/auth/", include("apps.accounts.urls")),
    path("api/master-data/", include("apps.master_data.urls")),
    path("api/emails/", include("apps.emails.urls")),
    path("api/shipments/", include("apps.shipments.urls")),
    path("api/generator/", include("apps.generator.urls")),
    path("api/pallets/export/", shipment_views.pallet_export, name="pallet-export"),
    re_path(r"^media/(?P<path>.*)$", serve, {"document_root": settings.MEDIA_ROOT}),
    re_path(r"^assets/(?P<path>.*)$", frontend_asset),
    re_path(r"^(?P<path>favicon\.svg|icons\.svg)$", frontend_public),
    re_path(r"^(?!api/|admin/|media/).*$", spa_index),
]
