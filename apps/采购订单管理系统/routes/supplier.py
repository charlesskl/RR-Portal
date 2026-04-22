from flask import Blueprint, render_template, request, jsonify
from models import db, Supplier, PurchaseOrder
from sqlalchemy import func

bp = Blueprint('supplier', __name__, url_prefix='/suppliers')

@bp.route('/')
def list_suppliers():
    suppliers = db.session.query(
        Supplier,
        func.count(PurchaseOrder.id).label('order_count'),
        func.coalesce(func.sum(PurchaseOrder.total_amount), 0).label('total_amount')
    ).outerjoin(PurchaseOrder).group_by(Supplier.id).order_by(Supplier.short_name).all()
    return render_template('suppliers.html', suppliers=suppliers)

@bp.route('/<int:supplier_id>/update', methods=['POST'])
def update_supplier(supplier_id):
    supplier = Supplier.query.get_or_404(supplier_id)
    data = request.get_json()
    for field in ['name', 'short_name', 'contact', 'tel', 'fax', 'address']:
        if field in data:
            setattr(supplier, field, data[field])
    db.session.commit()
    return jsonify({'success': True})
