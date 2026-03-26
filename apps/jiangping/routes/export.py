import io
from flask import Blueprint, request, send_file
from models import db, Supplier, PurchaseOrder, PurchaseItem, DeliveryNote, DeliveryNoteItem
from sqlalchemy import func
from openpyxl.utils import get_column_letter
import pandas as pd

bp = Blueprint('export', __name__, url_prefix='/export')


def _auto_fit_columns(writer):
    """Auto-fit column widths based on cell content length."""
    for sheet_name in writer.sheets:
        ws = writer.sheets[sheet_name]
        for col in ws.columns:
            max_len = 0
            col_letter = get_column_letter(col[0].column)
            for cell in col:
                val = str(cell.value) if cell.value is not None else ''
                # Chinese characters count as ~2 width
                length = 0
                for ch in val:
                    length += 2 if ord(ch) > 127 else 1
                if length > max_len:
                    max_len = length
            ws.column_dimensions[col_letter].width = min(max_len + 3, 60)


@bp.route('/excel')
def export_excel():
    supplier_id = request.args.get('supplier_id', type=int)
    date_from = request.args.get('date_from')
    date_to = request.args.get('date_to')
    year = request.args.get('year', type=int)
    query = db.session.query(PurchaseItem).join(PurchaseOrder).join(Supplier)
    if supplier_id:
        query = query.filter(PurchaseOrder.supplier_id == supplier_id)
    if year:
        query = query.filter(db.extract('year', PurchaseOrder.po_date) == year)
    if date_from:
        query = query.filter(PurchaseOrder.po_date >= date_from)
    if date_to:
        query = query.filter(PurchaseOrder.po_date <= date_to)
    items = query.order_by(Supplier.short_name, PurchaseOrder.po_date).all()
    supplier_data = {}
    for item in items:
        order = item.order
        supplier = order.supplier
        key = supplier.short_name or supplier.name
        if key not in supplier_data:
            supplier_data[key] = []
        delivered_qty = db.session.query(
            func.coalesce(func.sum(DeliveryNoteItem.quantity), 0)
        ).join(DeliveryNote).filter(
            DeliveryNoteItem.po_no == order.po_no,
            DeliveryNoteItem.product_name == item.product_name,
        ).scalar()
        delivered_qty = float(delivered_qty)
        purchase_qty = float(item.quantity or 0)
        outstanding = purchase_qty - delivered_qty

        if outstanding > 0:
            outstanding_str = int(outstanding) if outstanding == int(outstanding) else outstanding
        elif outstanding == 0 and delivered_qty > 0:
            outstanding_str = '已送完'
        else:
            outstanding_str = ''

        supplier_data[key].append({
            '日期': order.po_date.strftime('%#m/%#d') if order.po_date else '',
            '采购单号': order.po_no,
            '货号': item.product_code or '',
            '货品名称': item.product_name or '',
            '数量': item.quantity,
            '单位RMB': item.unit,
            '单价RMB': float(item.unit_price or 0),
            '金额RMB': float(item.amount or 0),
            '交货期': order.delivery_date.strftime('%#m/%#d') if order.delivery_date else '',
            '备注': item.remarks or '',
            '欠数': outstanding_str,
        })
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        if not supplier_data:
            pd.DataFrame().to_excel(writer, sheet_name='无数据', index=False)
        for sheet_name, rows in supplier_data.items():
            df = pd.DataFrame(rows)
            df.to_excel(writer, sheet_name=sheet_name[:31], index=False)
        _auto_fit_columns(writer)
    output.seek(0)
    return send_file(
        output,
        mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        as_attachment=True,
        download_name='采购数据.xlsx'
    )


@bp.route('/delivery-excel')
def export_delivery_excel():
    supplier_id = request.args.get('supplier_id', type=int)
    date_from = request.args.get('date_from')
    date_to = request.args.get('date_to')
    po_no = request.args.get('po_no', '').strip()
    query = db.session.query(DeliveryNoteItem).join(DeliveryNote).join(Supplier)
    if supplier_id:
        query = query.filter(DeliveryNote.supplier_id == supplier_id)
    if date_from:
        query = query.filter(DeliveryNote.delivery_date >= date_from)
    if date_to:
        query = query.filter(DeliveryNote.delivery_date <= date_to)
    if po_no:
        query = query.filter(DeliveryNoteItem.po_no.contains(po_no))
    items = query.order_by(
        Supplier.short_name, DeliveryNote.delivery_date, DeliveryNote.delivery_no, DeliveryNoteItem.id
    ).all()
    supplier_data = {}
    for item in items:
        note = item.note
        supplier = note.supplier
        key = supplier.short_name or supplier.name
        if key not in supplier_data:
            supplier_data[key] = []
        supplier_data[key].append({
            '日期': note.delivery_date.strftime('%#m/%#d') if note.delivery_date else '',
            '供应商': key,
            '送货单号': note.delivery_no or '',
            '货号': item.product_code or '',
            '货号名称': item.product_name or '',
            '数量': float(item.quantity or 0),
            '单位RMB': item.unit or 'PCS',
            '单价RMB': float(item.unit_price or 0),
            '金额RMB': float(item.amount or 0),
            '采购单号': item.po_no or '',
        })
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        if not supplier_data:
            pd.DataFrame().to_excel(writer, sheet_name='无数据', index=False)
        for sheet_name, rows in supplier_data.items():
            df = pd.DataFrame(rows)
            df.to_excel(writer, sheet_name=sheet_name[:31], index=False)
        _auto_fit_columns(writer)
    output.seek(0)
    return send_file(
        output,
        mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        as_attachment=True,
        download_name='交货数据.xlsx'
    )
