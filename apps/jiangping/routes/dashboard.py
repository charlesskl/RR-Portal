from flask import Blueprint, render_template, request, jsonify
from models import db, PurchaseOrder, PurchaseItem, Supplier, DeliveryRecord
from sqlalchemy import func

bp = Blueprint('dashboard', __name__, url_prefix='/dashboard')

@bp.route('/')
def dashboard_page():
    return render_template('dashboard.html')

@bp.route('/api/by_supplier')
def by_supplier():
    rows = db.session.query(
        Supplier.short_name, func.sum(PurchaseOrder.total_amount).label('total')
    ).join(PurchaseOrder).group_by(Supplier.id).order_by(func.sum(PurchaseOrder.total_amount).desc()).all()
    return jsonify({'labels': [r[0] or '未知' for r in rows], 'data': [float(r[1] or 0) for r in rows]})

@bp.route('/api/by_month')
def by_month():
    rows = db.session.query(
        func.strftime('%Y-%m', PurchaseOrder.po_date).label('month'),
        func.sum(PurchaseOrder.total_amount).label('total')
    ).group_by('month').order_by('month').all()
    return jsonify({'labels': [r[0] for r in rows], 'data': [float(r[1] or 0) for r in rows]})

@bp.route('/api/by_product')
def by_product():
    n = request.args.get('n', 20, type=int)
    rows = db.session.query(
        PurchaseItem.product_code, func.sum(PurchaseItem.quantity).label('total_qty'),
        func.sum(PurchaseItem.amount).label('total_amount')
    ).group_by(PurchaseItem.product_code).order_by(func.sum(PurchaseItem.quantity).desc()).limit(n).all()
    return jsonify({'labels': [r[0] or '未知' for r in rows], 'quantities': [int(r[1] or 0) for r in rows], 'amounts': [float(r[2] or 0) for r in rows]})

@bp.route('/api/delivery_stats')
def delivery_stats():
    items = PurchaseItem.query.all()
    stats = {'on_time': 0, 'late': 0, 'undelivered': 0, 'partial': 0}
    for item in items:
        delivered_qty = db.session.query(
            func.coalesce(func.sum(DeliveryRecord.delivered_quantity), 0)
        ).filter(DeliveryRecord.purchase_item_id == item.id).scalar()
        if delivered_qty == 0:
            stats['undelivered'] += 1
        elif delivered_qty < item.quantity:
            stats['partial'] += 1
        else:
            last_delivery = DeliveryRecord.query.filter_by(purchase_item_id=item.id).order_by(DeliveryRecord.delivery_date.desc()).first()
            if last_delivery and item.order.delivery_date and last_delivery.delivery_date and last_delivery.delivery_date <= item.order.delivery_date:
                stats['on_time'] += 1
            else:
                stats['late'] += 1
    return jsonify(stats)

@bp.route('/api/period_compare')
def period_compare():
    p1_from = request.args.get('p1_from')
    p1_to = request.args.get('p1_to')
    p2_from = request.args.get('p2_from')
    p2_to = request.args.get('p2_to')
    def get_period_data(date_from, date_to):
        rows = db.session.query(
            Supplier.short_name, func.sum(PurchaseOrder.total_amount).label('total')
        ).join(PurchaseOrder).filter(
            PurchaseOrder.po_date >= date_from, PurchaseOrder.po_date <= date_to
        ).group_by(Supplier.id).all()
        return {r[0] or '未知': float(r[1] or 0) for r in rows}
    data1 = get_period_data(p1_from, p1_to) if p1_from and p1_to else {}
    data2 = get_period_data(p2_from, p2_to) if p2_from and p2_to else {}
    all_suppliers = sorted(set(list(data1.keys()) + list(data2.keys())))
    return jsonify({'labels': all_suppliers, 'period1': [data1.get(s, 0) for s in all_suppliers], 'period2': [data2.get(s, 0) for s in all_suppliers]})
