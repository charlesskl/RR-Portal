from flask import Blueprint, render_template, request, jsonify
from models import db, PurchaseOrder, PurchaseItem, DeliveryRecord, Supplier
from sqlalchemy import func

bp = Blueprint('delivery', __name__, url_prefix='/delivery')

@bp.route('/')
def delivery_page():
    suppliers = Supplier.query.order_by(Supplier.short_name).all()
    return render_template('delivery.html', suppliers=suppliers)

@bp.route('/api/reconciliation')
def api_reconciliation():
    supplier_id = request.args.get('supplier_id', type=int)
    po_no = request.args.get('po_no', '').strip()
    query = db.session.query(PurchaseItem).join(PurchaseOrder).join(Supplier)
    if supplier_id:
        query = query.filter(PurchaseOrder.supplier_id == supplier_id)
    if po_no:
        query = query.filter(PurchaseOrder.po_no.contains(po_no))
    items = query.order_by(PurchaseOrder.po_date.desc()).all()
    result = []
    for item in items:
        delivered_qty = db.session.query(
            func.coalesce(func.sum(DeliveryRecord.delivered_quantity), 0)
        ).filter(DeliveryRecord.purchase_item_id == item.id).scalar()
        diff = delivered_qty - item.quantity
        if delivered_qty == 0:
            status = 'undelivered'
        elif diff < 0:
            status = 'partial'
        elif diff == 0:
            status = 'complete'
        else:
            status = 'over'
        result.append({
            'item_id': item.id, 'po_no': item.order.po_no,
            'po_date': item.order.po_date.strftime('%Y-%m-%d') if item.order.po_date else '',
            'supplier': item.order.supplier.short_name or item.order.supplier.name,
            'product_code': item.product_code, 'product_name': item.product_name,
            'quantity': item.quantity, 'delivered_qty': delivered_qty,
            'diff': diff, 'status': status,
            'delivery_date': item.order.delivery_date.strftime('%Y-%m-%d') if item.order.delivery_date else '',
        })
    return jsonify({'data': result})

@bp.route('/api/record', methods=['POST'])
def add_delivery_record():
    data = request.get_json()
    record = DeliveryRecord(
        purchase_item_id=data['item_id'],
        delivery_date=data.get('delivery_date'),
        delivered_quantity=data.get('delivered_quantity', 0),
        remarks=data.get('remarks', ''),
    )
    db.session.add(record)
    db.session.commit()
    return jsonify({'success': True})
