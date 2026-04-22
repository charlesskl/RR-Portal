import os
from datetime import datetime
from flask import Blueprint, render_template, request, jsonify, current_app
from werkzeug.utils import secure_filename
from parser.pdf_parser import parse_purchase_pdf
from models import db, Supplier, PurchaseOrder, PurchaseItem


def _parse_date(date_str):
    if not date_str:
        return None
    try:
        return datetime.strptime(date_str, '%Y-%m-%d').date()
    except (ValueError, TypeError):
        return None


bp = Blueprint('upload', __name__, url_prefix='/upload')


@bp.route('/')
def upload_page():
    return render_template('upload.html')


@bp.route('/parse', methods=['POST'])
def parse_pdf():
    if 'file' not in request.files:
        return jsonify({'error': '没有选择文件'}), 400
    file = request.files['file']
    if not file.filename.lower().endswith('.pdf'):
        return jsonify({'error': '请上传PDF文件'}), 400
    original_name = file.filename
    safe_name = secure_filename(original_name)
    if not safe_name:
        return jsonify({'error': '文件名无效'}), 400
    filepath = os.path.join(current_app.config['UPLOAD_FOLDER'], safe_name)
    file.save(filepath)
    try:
        data = parse_purchase_pdf(filepath)
        data['pdf_filename'] = original_name
        existing = PurchaseOrder.query.filter_by(po_no=data.get('po_no', '')).first()
        if existing:
            data['warning'] = f"采购单 {data['po_no']} 已存在，保存将覆盖原有数据"
        return jsonify(data)
    except Exception as e:
        current_app.logger.exception('PDF parse failed for %s', safe_name)
        return jsonify({'error': 'PDF解析失败，请确认文件格式正确'}), 400


@bp.route('/save', methods=['POST'])
def save_parsed():
    data = request.get_json()
    if not data:
        return jsonify({'error': '无数据'}), 400
    po_no = data.get('po_no', '')
    supplier_name = data.get('supplier_name', '')
    supplier = Supplier.query.filter_by(name=supplier_name).first()
    if not supplier:
        supplier = Supplier(
            name=supplier_name,
            short_name=supplier_name[:2] if supplier_name else '',
            contact=data.get('supplier_contact', ''),
            tel=data.get('supplier_tel', ''),
            fax=data.get('supplier_fax', ''),
        )
        db.session.add(supplier)
        db.session.flush()
    existing = PurchaseOrder.query.filter_by(po_no=po_no).first()
    if existing:
        db.session.delete(existing)
        db.session.flush()
    order = PurchaseOrder(
        po_no=po_no,
        po_date=_parse_date(data.get('po_date')),
        supplier_id=supplier.id,
        delivery_date=_parse_date(data.get('delivery_date')),
        receiver=data.get('receiver', ''),
        total_amount=sum(item.get('amount', 0) for item in data.get('items', [])),
        pdf_filename=data.get('pdf_filename', ''),
    )
    db.session.add(order)
    db.session.flush()
    for item_data in data.get('items', []):
        item = PurchaseItem(
            purchase_order_id=order.id,
            material_code=item_data.get('material_code', ''),
            product_code=item_data.get('product_code', ''),
            product_name=item_data.get('product_name', ''),
            specification=item_data.get('specification', ''),
            quantity=item_data.get('quantity', 0),
            unit=item_data.get('unit', 'PCS'),
            unit_price=item_data.get('unit_price', 0),
            amount=item_data.get('amount', 0),
            remarks=item_data.get('remarks', ''),
        )
        db.session.add(item)
    db.session.commit()
    return jsonify({'success': True, 'message': f'采购单 {po_no} 已保存，共 {len(data.get("items", []))} 条明细'})
