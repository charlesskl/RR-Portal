import os
import re
from datetime import datetime
from flask import Blueprint, render_template, request, jsonify, flash, redirect, url_for, current_app
from models import db, PurchaseOrder, PurchaseItem, Supplier, DeliveryNoteItem, DeliveryNote
from sqlalchemy import func
import pandas as pd

bp = Blueprint('purchase', __name__, url_prefix='/purchases')

@bp.route('/')
def list_purchases():
    suppliers = Supplier.query.order_by(Supplier.short_name).all()
    # Collect distinct years from purchase orders
    year_rows = db.session.query(
        db.func.distinct(db.extract('year', PurchaseOrder.po_date))
    ).filter(PurchaseOrder.po_date.isnot(None)).order_by(
        db.extract('year', PurchaseOrder.po_date).desc()
    ).all()
    years = [int(r[0]) for r in year_rows]
    return render_template('purchases.html', suppliers=suppliers, years=years)

@bp.route('/api/list')
def api_list():
    """Return item-level data in Excel format, grouped by PO."""
    query = db.session.query(PurchaseItem).join(PurchaseOrder).join(Supplier)

    supplier_id = request.args.get('supplier_id', type=int)
    if supplier_id:
        query = query.filter(PurchaseOrder.supplier_id == supplier_id)
    year = request.args.get('year', type=int)
    if year:
        query = query.filter(db.extract('year', PurchaseOrder.po_date) == year)
    date_from = request.args.get('date_from')
    if date_from:
        query = query.filter(PurchaseOrder.po_date >= date_from)
    date_to = request.args.get('date_to')
    if date_to:
        query = query.filter(PurchaseOrder.po_date <= date_to)
    po_no = request.args.get('po_no', '').strip()
    if po_no:
        query = query.filter(PurchaseOrder.po_no.contains(po_no))

    items = query.order_by(
        Supplier.short_name, PurchaseOrder.po_date.desc(), PurchaseOrder.po_no, PurchaseItem.id
    ).all()

    result = []
    last_po_no = None
    for item in items:
        order = item.order
        is_first = (order.po_no != last_po_no)
        last_po_no = order.po_no

        # Calculate delivered quantity from delivery notes
        delivered_qty = db.session.query(
            func.coalesce(func.sum(DeliveryNoteItem.quantity), 0)
        ).join(DeliveryNote).filter(
            DeliveryNoteItem.po_no == order.po_no,
            DeliveryNoteItem.product_name == item.product_name,
        ).scalar()
        delivered_qty = float(delivered_qty)
        purchase_qty = float(item.quantity or 0)
        outstanding = purchase_qty - delivered_qty

        result.append({
            'order_id': order.id,
            'item_id': item.id,
            'po_date': order.po_date.strftime('%#m/%#d') if order.po_date else '',
            'po_no': order.po_no or '',
            'product_code': item.product_code or '',
            'product_name': item.product_name or '',
            'quantity': item.quantity,
            'unit': item.unit or 'PCS',
            'unit_price': float(item.unit_price or 0),
            'amount': float(item.amount or 0),
            'delivered_qty': delivered_qty,
            'outstanding': outstanding,
            'delivery_date': order.delivery_date.strftime('%#m/%#d') if order.delivery_date and is_first else '',
            'remarks': item.remarks or '',
            'is_first': is_first,
        })
    return jsonify({'data': result})

@bp.route('/<int:order_id>')
def detail(order_id):
    order = PurchaseOrder.query.get_or_404(order_id)
    items = order.items.all()
    return render_template('purchase_detail.html', order=order, items=items)

@bp.route('/<int:order_id>/delete', methods=['POST'])
def delete_order(order_id):
    order = PurchaseOrder.query.get_or_404(order_id)
    db.session.delete(order)
    db.session.commit()
    flash(f'采购单 {order.po_no} 已删除', 'success')
    return redirect(url_for('purchase.list_purchases'))

@bp.route('/import-excel', methods=['POST'])
def import_excel():
    """Import purchase data from an Excel file (one sheet per supplier)."""
    if 'file' not in request.files:
        flash('没有选择文件', 'danger')
        return redirect(url_for('purchase.list_purchases'))

    file = request.files['file']
    if not file.filename.lower().endswith(('.xls', '.xlsx')):
        flash('请上传 Excel 文件 (.xls 或 .xlsx)', 'danger')
        return redirect(url_for('purchase.list_purchases'))

    filepath = os.path.join(current_app.config['UPLOAD_FOLDER'], file.filename)
    file.save(filepath)

    try:
        xls = pd.ExcelFile(filepath)
        total_orders = 0
        total_items = 0

        for sheet_name in xls.sheet_names:
            df = pd.read_excel(xls, sheet_name=sheet_name, header=None)
            if df.empty or len(df) < 2:
                continue

            supplier_short = sheet_name.strip()

            # Find or create supplier
            supplier = Supplier.query.filter_by(short_name=supplier_short).first()
            if not supplier:
                supplier = Supplier(name=supplier_short, short_name=supplier_short)
                db.session.add(supplier)
                db.session.flush()

            # Detect column mapping from header row (row 0)
            header = [str(c).strip() for c in df.iloc[0].tolist()]
            col_map = _detect_columns(header)
            if col_map is None:
                continue  # Skip unrecognized sheets

            current_po_no = None
            current_po_date = None
            current_delivery_date = None
            current_order = None

            for idx in range(1, len(df)):
                row = df.iloc[idx]

                def cell(key):
                    ci = col_map.get(key)
                    if ci is None or ci >= len(row):
                        return None
                    v = row.iloc[ci]
                    return v if pd.notna(v) else None

                product_name = str(cell('product_name') or '').strip()
                if not product_name or product_name == 'nan':
                    continue

                po_no_val = cell('po_no')
                po_date_val = cell('po_date')
                product_code = str(cell('product_code') or '').strip()
                quantity = cell('quantity') or 0
                unit = str(cell('unit') or 'PCS').strip()
                unit_price = cell('unit_price') or 0
                amount = cell('amount') or 0
                delivery_date_val = cell('delivery_date')
                remarks = str(cell('remarks') or '').strip()

                # Skip if po_no is actually a date (datetime object or date-like string)
                if po_no_val is not None and isinstance(po_no_val, datetime):
                    if not current_po_date:
                        current_po_date = po_no_val.date()
                    po_no_val = None
                elif po_no_val is not None:
                    po_str = str(po_no_val).strip()
                    # Detect date-like strings: "2025-07-22 00:00:00" or "2025-07-22"
                    if re.match(r'^\d{4}-\d{2}-\d{2}', po_str):
                        if not current_po_date:
                            current_po_date = _parse_excel_date(po_no_val)
                        po_no_val = None

                # New order if PO.NO is present
                if po_no_val is not None and str(po_no_val).strip() and str(po_no_val).strip() != 'nan':
                    current_po_no = str(po_no_val).strip()
                    current_po_date = _parse_excel_date(po_date_val)
                    current_delivery_date = _parse_excel_date(delivery_date_val)

                    current_order = PurchaseOrder.query.filter_by(po_no=current_po_no).first()
                    if not current_order:
                        current_order = PurchaseOrder(
                            po_no=current_po_no,
                            po_date=current_po_date,
                            supplier_id=supplier.id,
                            delivery_date=current_delivery_date,
                            receiver='',
                            total_amount=0,
                            pdf_filename='',
                        )
                        db.session.add(current_order)
                        db.session.flush()
                        total_orders += 1
                else:
                    if delivery_date_val is not None:
                        dd = _parse_excel_date(delivery_date_val)
                        if dd:
                            current_delivery_date = dd

                if not current_order:
                    continue

                # Parse numeric values
                try:
                    quantity = int(float(quantity)) if quantity else 0
                except (ValueError, TypeError):
                    quantity = 0
                try:
                    unit_price = float(unit_price) if unit_price else 0
                except (ValueError, TypeError):
                    unit_price = 0
                try:
                    amount = float(amount) if amount else 0
                except (ValueError, TypeError):
                    amount = 0

                # Handle product_code that might be numeric
                if product_code and product_code != 'nan':
                    try:
                        pc = float(product_code)
                        product_code = str(int(pc)) if pc == int(pc) else str(pc)
                    except (ValueError, TypeError):
                        pass
                else:
                    product_code = ''

                item = PurchaseItem(
                    purchase_order_id=current_order.id,
                    product_code=product_code,
                    product_name=product_name,
                    specification='',
                    quantity=quantity,
                    unit=unit if unit != 'nan' else 'PCS',
                    unit_price=unit_price,
                    amount=amount,
                    remarks=remarks if remarks != 'nan' else '',
                )
                db.session.add(item)
                total_items += 1

            # Update order totals
            for order in PurchaseOrder.query.filter_by(supplier_id=supplier.id).all():
                order.total_amount = sum(
                    float(i.amount or 0) for i in order.items.all()
                )

        db.session.commit()
        flash(f'导入成功！共导入 {total_orders} 个采购单，{total_items} 条明细', 'success')

    except Exception as e:
        db.session.rollback()
        flash(f'导入失败: {str(e)}', 'danger')

    return redirect(url_for('purchase.list_purchases'))


def _detect_columns(header):
    """Detect column indices from header row by matching known column names."""
    col_map = {}
    name_mapping = {
        'po_date': ('PO期', '日期'),
        'po_no': ('PO.NO', '采购单号', 'PO.No'),
        'product_code': ('货号',),
        'product_name': ('货品名称', '产品名称', '品名'),
        'quantity': ('数量',),
        'unit': ('单位RMB', '单位'),
        'unit_price': ('单价RMB', '单价'),
        'amount': ('金额RMB', '金额'),
        'delivery_date': ('交货期', '交货日期'),
        'remarks': ('备注',),
    }
    for key, names in name_mapping.items():
        for i, h in enumerate(header):
            if h in names:
                col_map[key] = i
                break

    # Must have at least po_no and product_name to be valid
    if 'po_no' not in col_map or 'product_name' not in col_map:
        return None
    return col_map


def _parse_excel_date(val):
    """Parse various date formats from Excel."""
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return None
    if isinstance(val, datetime):
        return val.date()
    if isinstance(val, pd.Timestamp):
        return val.date()
    try:
        # Excel serial date number
        if isinstance(val, (int, float)):
            return pd.Timestamp('1899-12-30') + pd.Timedelta(days=int(val))
    except Exception:
        pass
    try:
        return datetime.strptime(str(val).strip(), '%Y-%m-%d').date()
    except Exception:
        return None


@bp.route('/api/create', methods=['POST'])
def api_create():
    """Create a new purchase order with items."""
    data = request.get_json()
    if not data:
        return jsonify({'error': '无数据'}), 400

    supplier_id = data.get('supplier_id')
    if not supplier_id:
        return jsonify({'error': '请选择供应商'}), 400

    po_no = (data.get('po_no') or '').strip()
    if not po_no:
        return jsonify({'error': '请输入采购单号'}), 400

    # Check duplicate
    existing = PurchaseOrder.query.filter_by(po_no=po_no).first()
    if existing:
        return jsonify({'error': f'采购单号 {po_no} 已存在'}), 400

    po_date = None
    if data.get('po_date'):
        try:
            po_date = datetime.strptime(data['po_date'], '%Y-%m-%d').date()
        except ValueError:
            pass

    delivery_date = None
    if data.get('delivery_date'):
        try:
            delivery_date = datetime.strptime(data['delivery_date'], '%Y-%m-%d').date()
        except ValueError:
            pass

    order = PurchaseOrder(
        po_no=po_no,
        po_date=po_date,
        supplier_id=supplier_id,
        delivery_date=delivery_date,
        receiver='',
        total_amount=0,
        pdf_filename='',
    )
    db.session.add(order)
    db.session.flush()

    for it in data.get('items', []):
        product_name = (it.get('product_name') or '').strip()
        if not product_name:
            continue
        item = PurchaseItem(
            purchase_order_id=order.id,
            product_code=(it.get('product_code') or '').strip(),
            product_name=product_name,
            specification='',
            quantity=int(float(it.get('quantity') or 0)),
            unit=(it.get('unit') or 'PCS').strip(),
            unit_price=float(it.get('unit_price') or 0),
            amount=float(it.get('amount') or 0),
            remarks=(it.get('remarks') or '').strip(),
        )
        db.session.add(item)

    order.total_amount = sum(float(i.get('amount') or 0) for i in data.get('items', []))
    db.session.commit()
    return jsonify({'success': True, 'order_id': order.id})


@bp.route('/api/item/<int:item_id>', methods=['PUT'])
def api_update_item(item_id):
    """Update a purchase item."""
    item = PurchaseItem.query.get_or_404(item_id)
    data = request.get_json()
    for field in ['product_code', 'product_name', 'specification', 'remarks']:
        if field in data:
            setattr(item, field, (data[field] or '').strip())
    if 'unit' in data:
        item.unit = (data['unit'] or 'PCS').strip()
    for field in ['quantity']:
        if field in data:
            try:
                setattr(item, field, int(float(data[field] or 0)))
            except (ValueError, TypeError):
                pass
    for field in ['unit_price', 'amount']:
        if field in data:
            try:
                setattr(item, field, float(data[field] or 0))
            except (ValueError, TypeError):
                pass

    # Recalculate order total
    order = item.order
    db.session.flush()
    order.total_amount = sum(float(i.amount or 0) for i in order.items.all())
    db.session.commit()
    return jsonify({'success': True})


@bp.route('/api/item/<int:item_id>', methods=['DELETE'])
def api_delete_item(item_id):
    """Delete a purchase item."""
    item = PurchaseItem.query.get_or_404(item_id)
    order = item.order
    db.session.delete(item)
    db.session.flush()

    # If order has no more items, delete the order too
    if order.items.count() == 0:
        db.session.delete(order)
    else:
        order.total_amount = sum(float(i.amount or 0) for i in order.items.all())

    db.session.commit()
    return jsonify({'success': True})


@bp.route('/api/order/<int:order_id>', methods=['DELETE'])
def api_delete_order(order_id):
    """Delete an entire purchase order."""
    order = PurchaseOrder.query.get_or_404(order_id)
    db.session.delete(order)
    db.session.commit()
    return jsonify({'success': True})


@bp.route('/item/<int:item_id>/update', methods=['POST'])
def update_item(item_id):
    item = PurchaseItem.query.get_or_404(item_id)
    data = request.get_json()
    for field in ['product_code', 'product_name', 'specification', 'quantity', 'unit', 'unit_price', 'amount', 'remarks']:
        if field in data:
            setattr(item, field, data[field])
    db.session.commit()
    return jsonify({'success': True})
