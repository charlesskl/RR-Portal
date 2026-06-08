from flask import Blueprint, render_template, request, redirect, url_for, flash
from app.extensions import db
from app.models import Pigment, Stock, Transaction

bp = Blueprint("pigments", __name__)

@bp.route("/")
def index():
    show_archived = request.args.get("archived") == "1"
    q = Pigment.query
    if not show_archived:
        q = q.filter_by(is_archived=False)
    pigments = q.order_by(Pigment.brand, Pigment.code).all()
    return render_template("pigments/index.html", pigments=pigments, show_archived=show_archived)

def _find_duplicate_code(code, brand="", exclude_id=None):
    """按 (brand, code) 唯一索引语义查重;code 为空不算重复(允许多条待填色粉共存)。

    必须在改 p.code / 触发任何懒加载之前调用:一旦 p.code 被改成重复值,
    后续读取 p.stock 等关联会触发 autoflush,在 try 之外抛 IntegrityError → 500。
    """
    code = (code or "").strip()
    if not code:
        return None
    # 只和「未归档」色粉查重:归档色粉对入/出库匹配、下拉等都不可见,不占用编号。
    q = Pigment.query.filter(
        Pigment.brand == brand,
        Pigment.code == code,
        Pigment.is_archived == False,  # noqa: E712 (SQLAlchemy 需要 == False)
    )
    if exclude_id is not None:
        q = q.filter(Pigment.id != exclude_id)
    return q.first()


def _dup_code_message(code, dup):
    """撞重提示:点名冲突的是哪条(带进货编号),比只说「已存在」更好排查。"""
    hint = f"(进货编号 {dup.purchase_code})" if dup and dup.purchase_code else ""
    return f"色粉编号「{code}」已存在{hint},请换一个"


def _form_to_pigment(p):
    p.code = request.form["code"].strip()
    p.purchase_code = request.form.get("purchase_code", "").strip()
    p.unit_price = round(float(request.form.get("unit_price", 0) or 0), 1)
    # 确保必填字段有默认值(品牌、色名等已不再从表单传入)
    if not p.name:
        p.name = p.code
    p.spec_unit = "kg"


@bp.route("/new", methods=["GET", "POST"])
def new():
    if request.method == "POST":
        new_code = request.form["code"].strip()
        dup = _find_duplicate_code(new_code, brand="")
        if dup is not None:
            flash(_dup_code_message(new_code, dup), "danger")
            return render_template("pigments/form.html", pigment=None)
        p = Pigment(brand="")
        _form_to_pigment(p)
        qty = round(float(request.form.get("quantity", 0) or 0), 6)
        p.stock = Stock(quantity=qty)
        db.session.add(p)
        try:
            db.session.commit()
            flash("已添加", "success")
            return redirect(url_for("pigments.index"))
        except Exception as e:
            db.session.rollback()
            flash(f"保存失败:{e}", "danger")
    return render_template("pigments/form.html", pigment=None)

@bp.route("/<int:pid>")
def detail(pid):
    p = Pigment.query.get_or_404(pid)
    txs = (Transaction.query.filter_by(pigment_id=pid)
           .order_by(Transaction.occurred_at.desc()).all())
    return render_template("pigments/detail.html", pigment=p, transactions=txs)

@bp.route("/<int:pid>/edit", methods=["GET", "POST"])
def edit(pid):
    p = Pigment.query.get_or_404(pid)
    if request.method == "POST":
        new_code = request.form["code"].strip()
        dup = _find_duplicate_code(new_code, brand=p.brand, exclude_id=p.id)
        if dup is not None:
            flash(_dup_code_message(new_code, dup), "danger")
            return render_template("pigments/form.html", pigment=p)
        _form_to_pigment(p)
        qty = round(float(request.form.get("quantity", 0) or 0), 6)
        if p.stock is None:
            p.stock = Stock(quantity=qty)
        else:
            p.stock.quantity = qty
        try:
            db.session.commit()
            flash("已更新", "success")
            return redirect(url_for("pigments.index"))
        except Exception as e:
            db.session.rollback()
            flash(f"保存失败:{e}", "danger")
    return render_template("pigments/form.html", pigment=p)

@bp.route("/<int:pid>/delete", methods=["POST"])
def delete(pid):
    p = Pigment.query.get_or_404(pid)
    if p.transactions:
        p.is_archived = True
        db.session.commit()
        flash("有流水记录,已归档", "warning")
    else:
        db.session.delete(p)
        db.session.commit()
        flash("已删除", "success")
    return redirect(url_for("pigments.index"))


from flask import send_file
import io as _io
from app.services.excel_io import export_pigments_to_bytes, template_bytes, import_pigments_from_bytes

@bp.route("/export.xlsx")
def export_excel():
    data = export_pigments_to_bytes()
    return send_file(_io.BytesIO(data),
                     mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                     as_attachment=True, download_name="pigments.xlsx")

@bp.route("/template.xlsx")
def template_excel():
    data = template_bytes()
    return send_file(_io.BytesIO(data),
                     mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                     as_attachment=True, download_name="pigments_template.xlsx")

@bp.route("/import", methods=["GET", "POST"])
def import_excel():
    if request.method == "POST":
        f = request.files.get("file")
        if not f:
            flash("请选择文件", "warning")
            return redirect(url_for("pigments.import_excel"))
        try:
            report = import_pigments_from_bytes(f.read())
            flash(
                f"新增 {report['created']},更新 {report['updated']},"
                f"归档 {report.get('archived', 0)},失败 {len(report['errors'])}",
                "success",
            )
            return render_template("pigments/import.html", report=report)
        except Exception as e:
            flash(f"导入失败:{e}", "danger")
    return render_template("pigments/import.html", report=None)
