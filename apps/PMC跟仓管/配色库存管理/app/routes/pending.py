from flask import Blueprint, render_template, request, redirect, url_for, flash
from sqlalchemy import func

from app.extensions import db
from app.models import PendingReview, Pigment, Stock, Transaction
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

    low = code.lower()
    pigment = (Pigment.query
               .filter_by(is_archived=False)
               .filter((func.lower(Pigment.code) == low) |
                       (func.lower(Pigment.purchase_code) == low))
               .first())

    if item.type == "edit_in":
        # 强制应用入库修改(允许负库存),按 pending 里存的 pigment_code/quantity/unit_price/note
        if pigment is None:
            flash(f"找不到色粉 {code}", "danger")
            return redirect(url_for("pending.index"))
        tx = Transaction.query.get(item.ref_tx_id) if item.ref_tx_id else None
        if tx is None or tx.type != "in":
            flash(f"原入库流水 #{item.ref_tx_id} 不存在或类型不符", "danger")
            return redirect(url_for("pending.index"))
        price_raw = (request.form.get("unit_price") or "").strip()
        price = float(price_raw) if price_raw else None
        new_note = request.form.get("note", item.note or "")
        try:
            # 回退旧色粉(允许负库存),给新色粉加
            old_stock = Stock.query.get(tx.pigment_id)
            if old_stock is None:
                old_stock = Stock(pigment_id=tx.pigment_id, quantity=0)
                db.session.add(old_stock)
            old_stock.quantity = round(old_stock.quantity - tx.quantity, 6)
            new_stock = Stock.query.get(pigment.id)
            if new_stock is None:
                new_stock = Stock(pigment_id=pigment.id, quantity=0)
                db.session.add(new_stock)
            new_stock.quantity = round(new_stock.quantity + qty, 6)
            tx.pigment_id = pigment.id
            tx.quantity = qty
            tx.unit_price = price
            tx.note = new_note
            db.session.delete(item)
            db.session.commit()
            flash(f"已强制应用入库修改(可能产生负库存,请去「库存」页核对)", "success")
        except Exception as e:
            db.session.rollback()
            flash(f"修改失败:{e}", "danger")
        return redirect(url_for("pending.index"))

    if item.type == "in":
        price_raw = (request.form.get("unit_price") or "").strip()
        price = float(price_raw) if price_raw else None
        purchase_code = (request.form.get("purchase_code") or "").strip()
        if pigment is None:
            pigment = Pigment(
                brand="未分类", code=code,
                name=(item.name or code)[:128],
                purchase_code=purchase_code,
                unit_price=price or 0,
                notes=f"由待审核 #{item.id} 补填",
            )
            db.session.add(pigment)
            db.session.flush()
        elif purchase_code and not pigment.purchase_code:
            # 已有色粉没填 purchase_code,补上用户编辑的值
            pigment.purchase_code = purchase_code
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
    cur_stock = Stock.query.get(pigment.id)
    cur_kg = cur_stock.quantity if cur_stock else 0
    flash(f"已完成{'入库' if item.type == 'in' else '出库'}:色粉 {pigment.code or pigment.purchase_code} 当前库存 {cur_kg}kg", "success")
    return redirect(url_for("pending.index"))


@bp.route("/<int:rid>/reject", methods=["POST"])
def reject(rid):
    item = PendingReview.query.get_or_404(rid)
    db.session.delete(item)
    db.session.commit()
    flash("已驳回(未改动库存)", "info")
    return redirect(url_for("pending.index"))
