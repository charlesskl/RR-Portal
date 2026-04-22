from datetime import datetime

from flask import Blueprint, render_template, request, redirect, url_for, flash, current_app
from app.extensions import db
from app.models import Pigment, Stock, Transaction, PendingReview
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
            pid_raw = (request.form.get("pigment_id") or "").strip()
            qty = float(request.form["quantity"])
            price_raw = (request.form.get("unit_price") or "").strip()
            price = float(price_raw) if price_raw else None
            note = request.form.get("note", "")
            purchase_code = (request.form.get("purchase_code") or "").strip()
            name = (request.form.get("name") or "").strip()
            if pid_raw:
                stock_in(int(pid_raw), qty, unit_price=price, note=note)
                flash("已入库", "success")
            else:
                if not purchase_code and not name:
                    raise ValueError("未选色粉时,进货编号和商品名至少填一个")
                pr = PendingReview(
                    type="in", pigment_code="",
                    purchase_code=purchase_code, name=name,
                    quantity=qty, unit_price=price,
                    reason="未填色粉编号,只有进货编号",
                    note=note,
                )
                db.session.add(pr)
                db.session.commit()
                flash("已加入待审核,请到「待审核」页补填色粉编号", "info")
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
            note_raw = request.form.get("note", "")
            note_full = f"{qty_g}g / {note_raw}" if note_raw else f"{qty_g}g"
            stock = Stock.query.get(pid)
            if stock is None or stock.quantity < qty:
                p = Pigment.query.get(pid)
                cur = stock.quantity if stock else 0
                pr = PendingReview(
                    type="out",
                    pigment_code=p.code if p else "",
                    purchase_code=p.purchase_code if p else "",
                    name=p.name if p else "",
                    quantity=qty_g,
                    reason=f"库存不足,扣减后会变负(当前 {cur}kg,需 {qty}kg)",
                    note=note_full,
                )
                db.session.add(pr)
                db.session.commit()
                flash("库存不足,已加入待审核", "info")
            else:
                stock_out(pid, qty, note=note_full)
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
        if tx_type == "out":
            _apply_out_dilution(rows, lookup, code_map)
        if fallback_used:
            flash("LLM 识别不可用,已用本地 OCR 兜底(可能精度较低)", "warning")
        return render_template(template, rows=rows, pigments=_pigments())
    return render_template(template, rows=None, pigments=_pigments())


# 出库 OCR 的 A/B 冲淡公式:
# - B 前缀: 实际 = 数量 × 1%, 余量 (99%) 合并到 33A
# - A 前缀: 实际 = 数量 × 10%, 余量 (90%) 合并到 33A
# 前缀检测: 原码不在色粉表 + 去掉首字母后在色粉表 (避免 ABS740 这类编号误判)
_DILUTION_BASE_CODE = "33A"
_DILUTION_FACTORS = {"a": 0.1, "b": 0.01}


def _apply_out_dilution(rows: list[dict], lookup: dict[str, int], code_map: dict[int, str]) -> None:
    base_remainder = 0.0
    for r in rows:
        code = (r.get("purchase_code") or "").strip()
        if len(code) < 2:
            continue
        first = code[0].lower()
        factor = _DILUTION_FACTORS.get(first)
        if factor is None:
            continue
        low = code.lower()
        # 只在 "原码查不到 + 去前缀能查到" 时判定为儿子
        if low in lookup or low[1:] not in lookup:
            continue
        qty = float(r.get("quantity") or 0)
        if qty <= 0:
            continue
        actual = round(qty * factor, 2)
        base_remainder += qty - actual
        r["quantity"] = actual
    if base_remainder <= 0:
        return
    base_id = lookup.get(_DILUTION_BASE_CODE.lower())
    for r in rows:
        if (r.get("pigment_code") or "").upper() == _DILUTION_BASE_CODE \
                or (r.get("purchase_code") or "").upper() == _DILUTION_BASE_CODE:
            r["quantity"] = round(float(r.get("quantity") or 0) + base_remainder, 2)
            return
    rows.append({
        "raw": f"(自动合成) {_DILUTION_BASE_CODE} 余量 {base_remainder:.2f}",
        "pigment_id": base_id,
        "pigment_code": code_map.get(base_id, _DILUTION_BASE_CODE) if base_id else _DILUTION_BASE_CODE,
        "purchase_code": _DILUTION_BASE_CODE,
        "quantity": round(base_remainder, 2),
        "unit_price": 0,
    })


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
    success = 0
    pending_count = 0
    errors = []
    # 出库:pigment_code[] 找不到色粉 → 待审核;找到但库存不够 → 待审核
    if tx_type == "out":
        codes = request.form.getlist("pigment_code[]")
        for i, (code_text, qty) in enumerate(zip(codes, qtys)):
            code_text = (code_text or "").strip()
            if not code_text or not qty or float(qty) <= 0:
                continue
            qty_g = float(qty)
            qty_kg = round(qty_g / 1000.0, 6)
            pigment = (Pigment.query
                       .filter_by(is_archived=False)
                       .filter((Pigment.code == code_text) | (Pigment.purchase_code == code_text))
                       .first())
            if pigment is None:
                db.session.add(PendingReview(
                    type="out", pigment_code=code_text, purchase_code="", name="",
                    quantity=qty_g,
                    reason="色粉编号未在库存中找到",
                    note="拍照识别",
                ))
                pending_count += 1
                continue
            stock = Stock.query.get(pigment.id)
            cur = stock.quantity if stock else 0
            if cur < qty_kg:
                db.session.add(PendingReview(
                    type="out",
                    pigment_code=pigment.code, purchase_code=pigment.purchase_code,
                    name=pigment.name,
                    quantity=qty_g,
                    reason=f"库存不足,扣减后会变负(当前 {cur}kg,需 {qty_kg}kg)",
                    note="拍照识别",
                ))
                pending_count += 1
                continue
            try:
                stock_out(pigment.id, qty_kg, note=f"拍照识别 {qty_g}g")
                success += 1
            except Exception as e:
                errors.append(f"第{i+1}行:{e}")
        db.session.commit()
        parts = []
        if success:
            parts.append(f"已出库 {success} 条")
        if pending_count:
            parts.append(f"{pending_count} 条进待审核")
        msg = ",".join(parts) if parts else "无有效数据"
        if errors:
            flash(f"{msg},失败 {len(errors)}:{'; '.join(errors[:5])}", "warning")
        else:
            flash(msg, "info" if pending_count else "success")
        return redirect(url_for("transactions.out_list"))

    # 入库:pigment_id[] 有值 → 直接入库;否则 → 待审核
    pids = request.form.getlist("pigment_id[]")
    prices = request.form.getlist("unit_price[]")
    new_codes = request.form.getlist("new_code[]")
    purchase_codes = request.form.getlist("purchase_code[]")
    for i, (pid, qty) in enumerate(zip(pids, qtys)):
        if not qty or float(qty) <= 0:
            continue
        price_raw = prices[i] if i < len(prices) else ""
        price = float(price_raw) if price_raw else None
        matched_id = int(pid.strip()) if pid and pid.strip().isdigit() else None
        if matched_id is not None:
            try:
                stock_in(matched_id, float(qty), unit_price=price, note="拍照识别")
                success += 1
            except Exception as e:
                errors.append(f"第{i+1}行:{e}")
            continue
        # 未匹配 → 待审核
        new_code = new_codes[i].strip() if i < len(new_codes) else ""
        purchase_code = purchase_codes[i].strip() if i < len(purchase_codes) else ""
        db.session.add(PendingReview(
            type="in",
            pigment_code=new_code,
            purchase_code=purchase_code,
            name=new_code or purchase_code,
            quantity=float(qty),
            unit_price=price,
            reason="未填色粉编号,只有进货编号",
            note="拍照识别",
        ))
        pending_count += 1
    db.session.commit()
    parts = []
    if success:
        parts.append(f"已入库 {success} 条")
    if pending_count:
        parts.append(f"{pending_count} 条进待审核")
    msg = ",".join(parts) if parts else "无有效数据"
    if errors:
        flash(f"{msg},失败 {len(errors)}:{'; '.join(errors[:5])}", "warning")
    else:
        flash(msg, "info" if pending_count else "success")
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
