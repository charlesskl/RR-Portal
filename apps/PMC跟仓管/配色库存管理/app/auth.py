"""登录守卫:未登录访问任何非豁免路由都跳去 /login。

豁免端点:auth.login / auth.logout / _health / static
"""
from functools import wraps

from flask import current_app, redirect, request, session, url_for

_EXEMPT_ENDPOINTS = {"auth.login", "auth.logout", "_health", "static"}


def is_logged_in() -> bool:
    return bool(session.get("logged_in"))


def _full_next_path() -> str:
    """next 必须带 script_root（如 /peise），否则登录后 redirect 到裸路径会跳到 portal 根。"""
    return (request.script_root or "") + request.full_path.rstrip("?")


def install_login_guard(app) -> None:
    @app.before_request
    def _require_login():
        if request.endpoint in _EXEMPT_ENDPOINTS:
            return None
        if is_logged_in():
            return None
        return redirect(url_for("auth.login", next=_full_next_path()))


def login_required(view):
    """备用装饰器,主要靠 install_login_guard 做全局守卫。"""
    @wraps(view)
    def wrapper(*args, **kwargs):
        if not is_logged_in():
            return redirect(url_for("auth.login", next=_full_next_path()))
        return view(*args, **kwargs)
    return wrapper
