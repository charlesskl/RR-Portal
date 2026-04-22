from urllib.parse import urlparse

from flask import (Blueprint, current_app, flash, redirect, render_template,
                   request, session, url_for)

bp = Blueprint("auth", __name__)


def _safe_next(target: str | None) -> str:
    """防 open-redirect:只接受本站内部路径。"""
    if not target:
        return url_for("dashboard.index")
    parsed = urlparse(target)
    if parsed.scheme or parsed.netloc:
        return url_for("dashboard.index")
    if not target.startswith("/"):
        return url_for("dashboard.index")
    return target


@bp.route("/login", methods=["GET", "POST"])
def login():
    next_url = request.args.get("next") or request.form.get("next") or ""
    if request.method == "POST":
        username = (request.form.get("username") or "").strip()
        password = (request.form.get("password") or "").strip()
        remember = bool(request.form.get("remember"))
        expected_user = current_app.config.get("AUTH_USERNAME", "")
        expected_pass = current_app.config.get("AUTH_PASSWORD", "")
        if username == expected_user and password == expected_pass:
            session.clear()
            session["logged_in"] = True
            session.permanent = remember  # True → 7 天; False → 关浏览器失效
            return redirect(_safe_next(next_url))
        flash("账号或密码错误", "danger")
    return render_template("login.html", next=next_url)


@bp.route("/logout", methods=["GET", "POST"])
def logout():
    session.clear()
    flash("已注销", "info")
    return redirect(url_for("auth.login"))
