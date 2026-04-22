from datetime import datetime

from flask import Blueprint, render_template, request, redirect, url_for, flash, current_app
from app.extensions import db
from app.models import Pigment, Stock, Transaction
from app.services.inventory import stock_in, stock_out, InsufficientStock

bp = Blueprint("transactions", __name__)


def _pigments():
    return Pigment.query.filter_by(is_archived=False).order_by(Pigment.code).all()


@bp.route("/in")
def in_list():
    pid = request.args.get("pigment_id", type=int)
    q = Transaction.query.filter_by(type="in")
    if pid:
        q = q.filter_by(pigment_id=pid)
    txs = q.order_by(Transaction.occurred_at.desc()).limit(500).all()
    return render_template("transactions/in_index.html", transactions=txs)


@bp.route("/out")
def out_list():
    pid = request.args.get("pigment_id", type=int)
    q = Transaction.query.filter_by(type="out")
    if pid:
        q = q.filter_by(pigment_id=pid)
    txs = q.order_by(Transaction.occurred_at.desc()).limit(500).all()
    return render_template("transactions/out_index.html", transactions=txs)


@bp.route("/in/new", methods=["GET", "POST"])
def in_new():
    if request.method == "POST":
        try:
            pid = int(request.form["pigment_id"])
            qty = float(request.form["quantity"])
            price = request.form.get("unit_price")
            note = request.form.get("note", "")
            stock_in(pid, qty, unit_price=float(price) if price else None, note=note)
            flash("已入库", "success")
            return redirect(url_for("transactions.in_list"))
        except Exception as e:
            flash(f"失败:{e}", "danger")
    return render_template("transactions/in_form.html",
                           pigments=_pigments(),
                           preselect=request.args.get("pigment_id", type=int))


@bp.route("/out/new", methods=["GET", "POST"])
def out_new():
    if request.method == "POST":
        try:
            pid = int(request.form["pigment_id"])
            qty_g = float(request.form["quantity"])  # 输入克
            qty = round(qty_g / 1000.0, 6)
            note = request.form.get("note", "")
            if note:
                note = f"{qty_g}g / {note}"
            else:
                note = f"{qty_g}g"
            stock_out(pid, qty, note=note)
            flash("已出库", "success")
            return redirect(url_for("transactions.out_list"))
        except InsufficientStock as e:
            flash(str(e), "danger")
        except Exception as e:
            flash(f"失败:{e}", "danger")
    return render_template("transactions/out_form.html",
                           pigments=_pigments(),
                           preselect=request.args.get("pigment_id", type=int))


def _ocr_upload(tx_type: str):
    template = f"transactions/{tx_type}_ocr.html"
    if request.method == "POST" and request.files.get("file"):
        from app.services.ocr import parse_image, build_pigment_lookup
        from app.services.ocr_llm import parse_image_llm, LLMOCRError
        data = request.files["file"].read()
        lookup = build_pigment_lookup()
        rows = None
        try:
            rows = parse_image_llm(data, lookup)
        except LLMOCRError as e:
            current_app.logger.warning("LLM OCR 失败, 回退 Paddle: %s", e)
        except Exception as e:
            current_app.logger.warning("LLM OCR 异常, 回退 Paddle: %s", e)
        fallback_used = False
        if rows is None:
            fallback_used = True
            try:
                rows = parse_image(data, lookup)
            except Exception as e:
                flash(f"识别失败:{e}", "danger")
                return render_template(template, rows=None, pigments=_pigments())
        code_map = {p.id: p.code for p in Pigment.query.filter_by(is_archived=False).all()}
        for r in rows:
            r["pigment_code"] = code_map.get(r.get("pigment_id"), "")
        if fallback_used:
            flash("LLM 识别不可用,已用本地 OCR 兜底(可能精度较低)", "warning")
        return render_template(template, rows=rows, pigments=_pigments())
    return render_template(template, rows=None, pigments=_pigments())


@bp.route("/in/ocr", methods=["GET", "POST"])
def in_ocr():
    return _ocr_upload("in")


@bp.route("/out/ocr", methods=["GET", "POST"])
def out_ocr():
    return _ocr_upload("out")


@bp.route("/in/ocr/submit", methods=["POST"])
def in_ocr_submit():
    return _ocr_submit("in")


@bp.route("/out/ocr/submit", methods=["POST"])
def out_ocr_submit():
    return _ocr_submit("out")


def _ocr_submit(tx_type: str):
    qtys = request.form.getlist("quantity[]")
    success = failed = 0
    errors = []
    # 出库:用 pigment_code[] 搜索/手动输入模式;未匹配的自动新建占位色粉,允许负库存
    if tx_type == "out":
        codes = request.form.getlist("pigment_code[]")
        auto_created = 0
        for i, (code_text, qty) in enumerate(zip(codes, qtys)):
            code_text = (code_text or "").strip()
            if not code_text or not qty or float(qty) <= 0:
                continue
            pigment = (Pigment.query
                       .filter_by(is_archived=False)
                       .filter((Pigment.code == code_text) | (Pigment.purchase_code == code_text))
                       .first())
            auto_new = False
            if pigment is None:
                # 未匹配:自动新建占位,code 留空待复核,code_text 写入 purchase_code
                pigment = Pigment(
                    brand="未分类", code="", name=code_text[:128] or "待填",
                    purchase_code=code_text,
                    notes="OCR 自动新建,待复核",
                )
                db.session.add(pigment)
                db.session.flush()
                auto_new = True
                auto_created += 1
            try:
                qty_g = float(qty)
                stock_out(pigment.id, round(qty_g / 1000.0, 6),
                          note=f"拍照识别 {qty_g}g" + ("(自动新建待复核)" if auto_new else ""),
                          allow_negative=auto_new)
                success += 1
            except Exception as e:
                db.session.rollback()
                failed += 1
                errors.append(f"第{i+1}行:{e}")
        msg = f"已记录 {success} 条"
        if auto_created:
            msg += f"(其中 {auto_created} 条自动新建待复核)"
        if errors:
            flash(f"{msg},失败 {failed}:{'; '.join(errors[:5])}", "warning")
        else:
            flash(msg, "success")
        return redirect(url_for("transactions.out_list"))
    # 入库:pigment_id[] 非空且为有效整数 → 已匹配,直接入库;否则按 new_code/purchase_code 自动新建
    pids = request.form.getlist("pigment_id[]")
    prices = request.form.getlist("unit_price[]")
    new_codes = request.form.getlist("new_code[]")
    purchase_codes = request.form.getlist("purchase_code[]")
    auto_created = 0
    for i, (pid, qty) in enumerate(zip(pids, qtys)):
        if not qty or float(qty) <= 0:
            continue
        price = prices[i] if i < len(prices) else ""
        matched_id = None
        if pid and pid.strip().isdigit():
            matched_id = int(pid.strip())
        if matched_id is not None:
            try:
                stock_in(matched_id, float(qty),
                         unit_price=float(price) if price else None,
                         note="拍照识别")
                success += 1
            except Exception as e:
                failed += 1
                errors.append(f"第{i+1}行:{e}")
            continue
        # 未匹配:先按 (new_code 填了优先,否则 purchase_code) 二次精确匹配已有色粉;
        # 找到 → 累加到已有色粉;找不到 → 新建 brand="未分类" 待复核
        new_code = new_codes[i].strip() if i < len(new_codes) else ""
        purchase_code = purchase_codes[i].strip() if i < len(purchase_codes) else ""
        code = new_code or purchase_code
        if code:
            # 二次匹配:先按 code 精确匹配(对应用户原话"色粉编号相同=一致"),
            # 没找到再按 purchase_code 匹配(对应"进货编号相同也视为同一色粉")
            existing = Pigment.query.filter_by(code=code, is_archived=False).first()
            if existing is None:
                existing = Pigment.query.filter_by(purchase_code=code, is_archived=False).first()
            if existing:
                try:
                    stock_in(existing.id, float(qty),
                             unit_price=float(price) if price else None,
                             note="拍照识别(进货编号精确匹配)")
                    success += 1
                except Exception as e:
                    failed += 1
                    errors.append(f"第{i+1}行:{e}")
                continue
        display_name = code or f"待填-{datetime.now():%H%M%S}"
        try:
            pigment = Pigment(
                brand="未分类",
                code=code,
                name=display_name,
                purchase_code=purchase_code,
                unit_price=float(price) if price else 0,
                notes="OCR 自动新建,待复核" if not new_code else "",
            )
            db.session.add(pigment)
            db.session.flush()
            stock_in(pigment.id, float(qty),
                     unit_price=float(price) if price else None,
                     note="拍照识别(自动新建)")
            success += 1
            auto_created += 1
        except Exception as e:
            db.session.rollback()
            failed += 1
            errors.append(f"第{i+1}行:{e}")
    msg = f"已记录 {success} 条"
    if auto_created:
        msg += f"(其中 {auto_created} 条自动新建待复核)"
    if errors:
        flash(f"{msg},失败 {failed}:{'; '.join(errors[:5])}", "warning")
    else:
        flash(msg, "success")
    return redirect(url_for(f"transactions.{tx_type}_list"))


@bp.route("/<int:tx_id>/delete", methods=["POST"])
def delete(tx_id):
    tx = Transaction.query.get_or_404(tx_id)
    stock = Stock.query.get(tx.pigment_id)
    target_list = "in_list" if tx.type == "in" else "out_list"
    try:
        if stock is None:
            stock = Stock(pigment_id=tx.pigment_id, quantity=0)
            db.session.add(stock)
        if tx.type == "in":
            if stock.quantity < tx.quantity:
                flash(f"删除失败:库存不足以扣回 {tx.quantity}(当前 {stock.quantity})", "danger")
                return redirect(url_for(f"transactions.{target_list}"))
            stock.quantity = round(stock.quantity - tx.quantity, 6)
        elif tx.type == "out":
            stock.quantity = round(stock.quantity + tx.quantity, 6)
        db.session.delete(tx)
        db.session.commit()
        flash("已删除并回滚库存", "success")
    except Exception as e:
        db.session.rollback()
        flash(f"删除失败:{e}", "danger")
    return redirect(url_for(f"transactions.{target_list}"))
