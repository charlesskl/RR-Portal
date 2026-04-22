from flask import Blueprint, render_template, request, redirect, url_for, flash

from app.extensions import db
from app.models import PendingReview, Pigment, Stock
from app.services.inventory import stock_in, stock_out, InsufficientStock

bp = Blueprint("pending", __name__)


@bp.route("/")
def index():
    items = PendingReview.query.order_by(PendingReview.created_at.desc()).all()
    return render_template("pending/index.html", items=items)


@bp.route("/<int:rid>/resolve", methods=["POST"])
def resolve(rid):
    item = PendingReview.query.get_or_404(rid)
    code = (request.form.get("pigment_code") or "").strip()
    try:
        qty = float(request.form.get("quantity") or 0)
    except ValueError:
        qty = 0.0
    if not code or qty <= 0:
        flash("色粉编号和数量必填", "danger")
        return redirect(url_for("pending.index"))

    pigment = (Pigment.query
               .filter_by(is_archived=False)
               .filter((Pigment.code == code) | (Pigment.purchase_code == code))
               .first())

    if item.type == "in":
        price_raw = (request.form.get("unit_price") or "").strip()
        price = float(price_raw) if price_raw else None
        if pigment is None:
            pigment = Pigment(
                brand="未分类", code=code,
                name=(item.name or code)[:128],
                purchase_code=item.purchase_code or "",
                unit_price=price or 0,
                notes=f"由待审核 #{item.id} 补填",
            )
            db.session.add(pigment)
            db.session.flush()
        try:
            stock_in(pigment.id, qty, unit_price=price,
                     note=f"由待审核 #{item.id} 补填")
        except Exception as e:
            flash(f"入库失败:{e}", "danger")
            return redirect(url_for("pending.index"))
    else:  # out
        if pigment is None:
            flash(f"出库失败:色粉编号 {code} 在库存中找不到,请先建档或改编号", "danger")
            return redirect(url_for("pending.index"))
        qty_kg = round(qty / 1000.0, 6)
        try:
            stock_out(pigment.id, qty_kg,
                      note=f"由待审核 #{item.id} 补填 {qty}g")
        except InsufficientStock as e:
            flash(f"出库失败:{e}", "danger")
            return redirect(url_for("pending.index"))
        except Exception as e:
            flash(f"出库失败:{e}", "danger")
            return redirect(url_for("pending.index"))

    db.session.delete(item)
    db.session.commit()
    flash(f"已完成 {'入库' if item.type == 'in' else '出库'}", "success")
    return redirect(url_for("pending.index"))


@bp.route("/<int:rid>/reject", methods=["POST"])
def reject(rid):
    item = PendingReview.query.get_or_404(rid)
    db.session.delete(item)
    db.session.commit()
    flash("已驳回(未改动库存)", "info")
    return redirect(url_for("pending.index"))
