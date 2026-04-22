"""登录守卫:未登录访问任何非豁免路由都跳去 /login。

豁免端点:auth.login / auth.logout / _health / static
"""
from functools import wraps

from flask import current_app, redirect, request, session, url_for

_EXEMPT_ENDPOINTS = {"auth.login", "auth.logout", "_health", "static"}


def is_logged_in() -> bool:
    return bool(session.get("logged_in"))


def install_login_guard(app) -> None:
    @app.before_request
    def _require_login():
        if request.endpoint in _EXEMPT_ENDPOINTS:
            return None
        if is_logged_in():
            return None
        return redirect(url_for("auth.login", next=request.full_path.rstrip("?")))


def login_required(view):
    """备用装饰器,主要靠 install_login_guard 做全局守卫。"""
    @wraps(view)
    def wrapper(*args, **kwargs):
        if not is_logged_in():
            return redirect(url_for("auth.login", next=request.full_path.rstrip("?")))
        return view(*args, **kwargs)
    return wrapper
