from flask import Blueprint, render_template, request, redirect, url_for, flash

from app.services.exchange import get_rate, set_rate

bp = Blueprint("settings", __name__)


@bp.route("/", methods=["GET", "POST"])
def index():
    if request.method == "POST":
        try:
            rate = float(request.form.get("rate") or 0)
            if rate <= 0:
                raise ValueError("汇率必须 > 0")
            set_rate(rate)
            flash(f"汇率已更新为 1 HKD = {rate} RMB", "success")
            return redirect(url_for("settings.index"))
        except Exception as e:
            flash(f"保存失败:{e}", "danger")
    return render_template("settings/index.html", rate=get_rate())
