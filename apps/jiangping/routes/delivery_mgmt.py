import os
from datetime import datetime
from flask import Blueprint, render_template, request, jsonify, flash, redirect, url_for, current_app
from models import db, DeliveryNote, DeliveryNoteItem, Supplier, PurchaseOrder, PurchaseItem
import pandas as pd

bp = Blueprint('delivery_mgmt', __name__, url_prefix='/delivery-mgmt')


@bp.route('/')
def list_deliveries():
    suppliers = Supplier.query.order_by(Supplier.short_name).all()
    return render_template('delivery_mgmt.html', suppliers=suppliers)


@bp.route('/api/list')
def api_list():
    """Return delivery note items, grouped by delivery note."""
    query = db.session.query(DeliveryNoteItem).join(DeliveryNote).join(Supplier)

    supplier_id = request.args.get('supplier_id', type=int)
    if supplier_id:
        query = query.filter(DeliveryNote.supplier_id == supplier_id)
    date_from = request.args.get('date_from')
    if date_from:
        query = query.filter(DeliveryNote.delivery_date >= date_from)
    date_to = request.args.get('date_to')
    if date_to:
        query = query.filter(DeliveryNote.delivery_date <= date_to)
    po_no = request.args.get('po_no', '').strip()
    if po_no:
        query = query.filter(DeliveryNoteItem.po_no.contains(po_no))

    items = query.order_by(
        Supplier.short_name,
        DeliveryNote.delivery_date.desc(),
        DeliveryNote.delivery_no,
        DeliveryNoteItem.id,
    ).all()

    result = []
    last_note_id = None
    for item in items:
        note = item.note
        is_first = (note.id != last_note_id)
        last_note_id = note.id

        result.append({
            'note_id': note.id,
            'item_id': item.id,
            'delivery_date': note.delivery_date.strftime('%Y/%#m/%#d') if note.delivery_date and is_first else '',
            'supplier': (note.supplier.short_name or note.supplier.name) if is_first else '',
            'delivery_no': note.delivery_no if is_first else '',
            'product_code': item.product_code or '',
            'product_name': item.product_name or '',
            'quantity': float(item.quantity or 0),
            'unit': item.unit or 'PCS',
            'unit_price': float(item.unit_price or 0),
            'amount': float(item.amount or 0),
            'po_no': item.po_no or '',
            'is_first': is_first,
        })
    return jsonify({'data': result})


@bp.route('/import-excel', methods=['POST'])
def import_excel():
    """Import delivery data from an Excel file (one sheet per supplier)."""
    if 'file' not in request.files:
        flash('没有选择文件', 'danger')
        return redirect(url_for('delivery_mgmt.list_deliveries'))

    file = request.files['file']
    if not file.filename.lower().endswith(('.xls', '.xlsx')):
        flash('请上传 Excel 文件 (.xls 或 .xlsx)', 'danger')
        return redirect(url_for('delivery_mgmt.list_deliveries'))

    filepath = os.path.join(current_app.config['UPLOAD_FOLDER'], file.filename)
    file.save(filepath)

    try:
        xls = pd.ExcelFile(filepath)
        total_notes = 0
        total_items = 0

        for sheet_name in xls.sheet_names:
            df = pd.read_excel(xls, sheet_name=sheet_name, header=None)
            if df.empty or len(df) < 2:
                continue

            # A1 contains the supplier name
            supplier_short = str(df.iloc[0, 0]).strip() if pd.notna(df.iloc[0, 0]) else sheet_name.strip()
            if not supplier_short or supplier_short == 'nan':
                supplier_short = sheet_name.strip()

            # Find or create supplier
            supplier = Supplier.query.filter_by(short_name=supplier_short).first()
            if not supplier:
                supplier = Supplier(name=supplier_short, short_name=supplier_short)
                db.session.add(supplier)
                db.session.flush()

            # Detect columns from header row
            header = [str(c).strip() for c in df.iloc[0].tolist()]
            col_map = _detect_delivery_columns(header)
            if col_map is None:
                continue

            current_note = None

            for idx in range(1, len(df)):
                row = df.iloc[idx]

                def cell(key):
                    ci = col_map.get(key)
                    if ci is None or ci >= len(row):
                        return None
                    v = row.iloc[ci]
                    return v if pd.notna(v) else None

                product_name = str(cell('product_name') or '').strip()
                quantity = cell('quantity')

                # Skip empty rows and subtotal rows (only amount, no product_name)
                if not product_name or product_name == 'nan':
                    # Check if it's a subtotal row (only J column has value)
                    continue

                delivery_no_val = cell('delivery_no')
                delivery_date_val = cell('delivery_date')

                # New delivery note if delivery_no is present
                if delivery_no_val is not None and str(delivery_no_val).strip() and str(delivery_no_val).strip() != 'nan':
                    dn_no = str(delivery_no_val).strip()
                    # Clean up numeric delivery_no
                    try:
                        dn_num = float(dn_no)
                        dn_no = str(int(dn_num)) if dn_num == int(dn_num) else dn_no
                    except (ValueError, TypeError):
                        pass

                    dn_date = _parse_excel_date(delivery_date_val)

                    # Check for existing delivery note to avoid duplicates
                    current_note = DeliveryNote.query.filter_by(
                        supplier_id=supplier.id,
                        delivery_no=dn_no,
                    ).first()
                    if current_note:
                        # Delete old items to re-import
                        DeliveryNoteItem.query.filter_by(delivery_note_id=current_note.id).delete()
                        current_note.delivery_date = dn_date
                        db.session.flush()
                    else:
                        current_note = DeliveryNote(
                            supplier_id=supplier.id,
                            delivery_no=dn_no,
                            delivery_date=dn_date,
                            total_amount=0,
                        )
                        db.session.add(current_note)
                        db.session.flush()
                        total_notes += 1

                if not current_note:
                    continue

                # Parse values
                product_code = str(cell('product_code') or '').strip()
                if product_code == 'nan':
                    product_code = ''
                unit = str(cell('unit') or 'PCS').strip()
                if unit == 'nan':
                    unit = 'PCS'
                unit_price = cell('unit_price') or 0
                amount = cell('amount') or 0
                po_no = str(cell('po_no') or '').strip()
                if po_no == 'nan':
                    po_no = ''

                try:
                    quantity = float(quantity) if quantity else 0
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

                dn_item = DeliveryNoteItem(
                    delivery_note_id=current_note.id,
                    po_no=po_no,
                    product_code=product_code,
                    product_name=product_name,
                    quantity=quantity,
                    unit=unit,
                    unit_price=unit_price,
                    amount=amount,
                    remarks='',
                )
                db.session.add(dn_item)
                total_items += 1

                # Update matching purchase item remarks with "M/D送qty"
                if po_no and current_note.delivery_date and quantity:
                    _update_purchase_remarks(
                        po_no, product_name, product_code,
                        current_note.delivery_date, quantity,
                    )

            # Update note totals for this supplier
            for note in DeliveryNote.query.filter_by(supplier_id=supplier.id).all():
                note.total_amount = sum(
                    float(i.amount or 0) for i in note.items.all()
                )

        db.session.commit()

        # Refresh match problems
        from routes.problems import refresh_problems
        refresh_problems()

        flash(f'导入成功！共导入 {total_notes} 个交货单，{total_items} 条明细', 'success')

    except Exception as e:
        db.session.rollback()
        flash(f'导入失败: {str(e)}', 'danger')

    return redirect(url_for('delivery_mgmt.list_deliveries'))


@bp.route('/api/parse', methods=['POST'])
def api_parse():
    """Upload and OCR a delivery note PDF/image, return parsed data."""
    if 'file' not in request.files:
        return jsonify({'error': '没有选择文件'}), 400
    file = request.files['file']
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ('.pdf', '.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.tif'):
        return jsonify({'error': '请上传 PDF 或图片文件'}), 400

    filepath = os.path.join(current_app.config['UPLOAD_FOLDER'], file.filename)
    file.save(filepath)

    try:
        from parser.delivery_parser import parse_delivery_file
        data = parse_delivery_file(filepath)

        # Auto-match purchase data for each item
        for item in data.get('items', []):
            po_no = item.get('po_no', '')
            product_name = item.get('product_name', '')
            product_code = item.get('product_code', '')
            match = _find_purchase_item(po_no, product_name, product_code)
            if match:
                item['unit'] = match.unit or item.get('unit', 'PCS')
                item['unit_price'] = float(match.unit_price or 0)
                item['amount'] = round(float(item.get('quantity', 0)) * float(match.unit_price or 0), 2)
                # Also fill in matched product info for accuracy
                if not item.get('product_code'):
                    item['product_code'] = match.product_code or ''
            else:
                item.setdefault('unit', 'PCS')
                item.setdefault('unit_price', 0)
                item.setdefault('amount', 0)

        return jsonify(data)
    except Exception as e:
        return jsonify({'error': f'解析失败: {str(e)}'}), 400


@bp.route('/api/match-purchase', methods=['POST'])
def api_match_purchase():
    """Match a po_no + product to get unit/price from purchase data."""
    data = request.get_json()
    po_no = (data.get('po_no') or '').strip()
    product_name = (data.get('product_name') or '').strip()
    product_code = (data.get('product_code') or '').strip()

    match = _find_purchase_item(po_no, product_name, product_code)
    if match:
        return jsonify({
            'found': True,
            'unit': match.unit or 'PCS',
            'unit_price': float(match.unit_price or 0),
            'product_code': match.product_code or '',
            'product_name': match.product_name or '',
        })
    return jsonify({'found': False})


@bp.route('/api/purchase-items', methods=['GET'])
def api_purchase_items():
    """Return all items for a given po_no, for dropdown selection."""
    po_no = request.args.get('po_no', '').strip()
    if not po_no:
        return jsonify({'items': []})
    order = PurchaseOrder.query.filter_by(po_no=po_no).first()
    if not order:
        return jsonify({'items': []})
    items = []
    for item in order.items.all():
        items.append({
            'product_code': item.product_code or '',
            'product_name': item.product_name or '',
            'unit': item.unit or 'PCS',
            'unit_price': float(item.unit_price or 0),
            'quantity': int(item.quantity or 0),
        })
    return jsonify({'items': items})


@bp.route('/api/suggest/po-no')
def api_suggest_po_no():
    """Fuzzy suggestions for 采购单号. Sources: PurchaseOrder + DeliveryNoteItem."""
    q = request.args.get('q', '').strip()
    if not q:
        return jsonify({'suggestions': []})
    like = f'%{q}%'
    pos = db.session.query(PurchaseOrder.po_no).filter(PurchaseOrder.po_no.ilike(like)).limit(50).all()
    dns = db.session.query(DeliveryNoteItem.po_no).filter(DeliveryNoteItem.po_no.ilike(like)).limit(50).all()
    seen, out = set(), []
    for (v,) in list(pos) + list(dns):
        if v and v not in seen:
            seen.add(v)
            out.append(v)
        if len(out) >= 20:
            break
    return jsonify({'suggestions': out})


@bp.route('/api/suggest/product-code')
def api_suggest_product_code():
    """Fuzzy suggestions for 货号. Sources: PurchaseItem + DeliveryNoteItem."""
    q = request.args.get('q', '').strip()
    if not q:
        return jsonify({'suggestions': []})
    like = f'%{q}%'
    pis = db.session.query(PurchaseItem.product_code, PurchaseItem.product_name).filter(PurchaseItem.product_code.ilike(like)).limit(50).all()
    dns = db.session.query(DeliveryNoteItem.product_code, DeliveryNoteItem.product_name).filter(DeliveryNoteItem.product_code.ilike(like)).limit(50).all()
    seen, out = set(), []
    for code, name in list(pis) + list(dns):
        if code and code not in seen:
            seen.add(code)
            out.append({'code': code, 'name': name or ''})
        if len(out) >= 20:
            break
    return jsonify({'suggestions': out})


@bp.route('/api/clear-all', methods=['POST'])
def api_clear_all():
    """Delete all delivery notes and items. Requires confirm=true in body."""
    data = request.get_json(silent=True) or {}
    if not data.get('confirm'):
        return jsonify({'success': False, 'error': '请传入 {"confirm": true} 确认删除'}), 400
    count = DeliveryNote.query.count()
    DeliveryNoteItem.query.delete()
    DeliveryNote.query.delete()
    db.session.commit()
    return jsonify({'success': True, 'deleted': count})


@bp.route('/api/create', methods=['POST'])
def api_create():
    """Create a new delivery note with items."""
    data = request.get_json()
    if not data:
        return jsonify({'error': '无数据'}), 400

    supplier_id = data.get('supplier_id')
    if not supplier_id:
        return jsonify({'error': '请选择供应商'}), 400

    delivery_date = None
    if data.get('delivery_date'):
        try:
            delivery_date = datetime.strptime(data['delivery_date'], '%Y-%m-%d').date()
        except ValueError:
            pass

    note = DeliveryNote(
        supplier_id=supplier_id,
        delivery_no=data.get('delivery_no', ''),
        delivery_date=delivery_date,
        total_amount=0,
    )
    db.session.add(note)
    db.session.flush()

    items_data = data.get('items', [])
    for it in items_data:
        product_name = (it.get('product_name') or '').strip()
        if not product_name:
            continue
        qty = float(it.get('quantity') or 0)
        unit_price = float(it.get('unit_price') or 0)
        amount = float(it.get('amount') or 0)
        po_no = (it.get('po_no') or '').strip()
        product_code = (it.get('product_code') or '').strip()

        item = DeliveryNoteItem(
            delivery_note_id=note.id,
            po_no=po_no,
            product_code=product_code,
            product_name=product_name,
            quantity=qty,
            unit=(it.get('unit') or 'PCS').strip(),
            unit_price=unit_price,
            amount=amount,
            remarks='',
        )
        db.session.add(item)

        if po_no and delivery_date and qty:
            _update_purchase_remarks(po_no, product_name, product_code, delivery_date, qty)

    note.total_amount = sum(float(i.get('amount') or 0) for i in items_data)
    db.session.commit()
    return jsonify({'success': True, 'note_id': note.id})


@bp.route('/api/item/<int:item_id>', methods=['PUT'])
def api_update_item(item_id):
    """Update a delivery note item."""
    item = DeliveryNoteItem.query.get_or_404(item_id)
    data = request.get_json()

    old_po_no = item.po_no
    old_name = item.product_name
    old_code = item.product_code
    old_qty = float(item.quantity or 0)
    old_date = item.note.delivery_date

    for field in ['product_code', 'product_name', 'po_no', 'unit', 'remarks']:
        if field in data:
            setattr(item, field, (data[field] or '').strip())
    for field in ['quantity', 'unit_price', 'amount']:
        if field in data:
            try:
                setattr(item, field, float(data[field] or 0))
            except (ValueError, TypeError):
                pass

    # Recalculate note total
    note = item.note
    db.session.flush()
    note.total_amount = sum(float(i.amount or 0) for i in note.items.all())

    # Update purchase remarks: remove old entry, add new
    if old_date and old_qty and old_po_no:
        _remove_purchase_remarks(old_po_no, old_name, old_code, old_date, old_qty)
    new_qty = float(item.quantity or 0)
    if item.po_no and note.delivery_date and new_qty:
        _update_purchase_remarks(
            item.po_no, item.product_name, item.product_code,
            note.delivery_date, new_qty,
        )

    db.session.commit()
    return jsonify({'success': True})


@bp.route('/api/item/<int:item_id>', methods=['DELETE'])
def api_delete_item(item_id):
    """Delete a delivery note item."""
    item = DeliveryNoteItem.query.get_or_404(item_id)
    note = item.note

    # Remove from purchase remarks
    if item.po_no and note.delivery_date and item.quantity:
        _remove_purchase_remarks(
            item.po_no, item.product_name, item.product_code,
            note.delivery_date, float(item.quantity),
        )

    db.session.delete(item)
    db.session.flush()

    # If note has no more items, delete the note too
    if note.items.count() == 0:
        db.session.delete(note)
    else:
        note.total_amount = sum(float(i.amount or 0) for i in note.items.all())

    db.session.commit()
    return jsonify({'success': True})


@bp.route('/api/note/<int:note_id>', methods=['DELETE'])
def api_delete_note(note_id):
    """Delete an entire delivery note and all its items."""
    note = DeliveryNote.query.get_or_404(note_id)

    # Remove all purchase remarks for this note's items
    for item in note.items.all():
        if item.po_no and note.delivery_date and item.quantity:
            _remove_purchase_remarks(
                item.po_no, item.product_name, item.product_code,
                note.delivery_date, float(item.quantity),
            )

    db.session.delete(note)
    db.session.commit()
    return jsonify({'success': True})


@bp.route('/api/item/add', methods=['POST'])
def api_add_item():
    """Add an item to an existing delivery note."""
    data = request.get_json()
    note_id = data.get('note_id')
    note = DeliveryNote.query.get_or_404(note_id)

    product_name = (data.get('product_name') or '').strip()
    if not product_name:
        return jsonify({'error': '请输入货号名称'}), 400

    qty = float(data.get('quantity') or 0)
    unit_price = float(data.get('unit_price') or 0)
    amount = float(data.get('amount') or 0)
    po_no = (data.get('po_no') or '').strip()
    product_code = (data.get('product_code') or '').strip()

    item = DeliveryNoteItem(
        delivery_note_id=note.id,
        po_no=po_no,
        product_code=product_code,
        product_name=product_name,
        quantity=qty,
        unit=(data.get('unit') or 'PCS').strip(),
        unit_price=unit_price,
        amount=amount,
        remarks='',
    )
    db.session.add(item)
    db.session.flush()
    note.total_amount = sum(float(i.amount or 0) for i in note.items.all())

    if po_no and note.delivery_date and qty:
        _update_purchase_remarks(po_no, product_name, product_code, note.delivery_date, qty)

    db.session.commit()
    return jsonify({'success': True, 'item_id': item.id})


@bp.route('/<int:note_id>/delete', methods=['POST'])
def delete_note(note_id):
    note = DeliveryNote.query.get_or_404(note_id)
    for item in note.items.all():
        if item.po_no and note.delivery_date and item.quantity:
            _remove_purchase_remarks(
                item.po_no, item.product_name, item.product_code,
                note.delivery_date, float(item.quantity),
            )
    db.session.delete(note)
    db.session.commit()
    flash(f'交货单 {note.delivery_no} 已删除', 'success')
    return redirect(url_for('delivery_mgmt.list_deliveries'))


def _update_purchase_remarks(po_no, product_name, product_code, delivery_date, quantity):
    """Append 'M/D送qty' to matching purchase item remarks."""
    order = PurchaseOrder.query.filter_by(po_no=po_no).first()
    if not order:
        return

    # Try matching by product_name first, then by product_code
    match = None
    if product_name:
        match = PurchaseItem.query.filter_by(
            purchase_order_id=order.id, product_name=product_name
        ).first()
    if not match and product_code:
        match = PurchaseItem.query.filter_by(
            purchase_order_id=order.id, product_code=product_code
        ).first()

    if not match:
        return

    # Format: "M/D送qty"
    m = delivery_date.month
    d = delivery_date.day
    qty_str = str(int(quantity)) if quantity == int(quantity) else str(quantity)
    new_entry = f'{m}/{d}送{qty_str}'

    current = (match.remarks or '').strip()
    if new_entry in current:
        return  # Already recorded
    if current:
        match.remarks = current + '，' + new_entry
    else:
        match.remarks = new_entry


def _find_purchase_item(po_no, product_name, product_code):
    """Find matching purchase item by po_no + product_name/product_code."""
    if not po_no:
        return None
    order = PurchaseOrder.query.filter_by(po_no=po_no).first()
    if not order:
        return None
    match = None
    # Exact match by product_name
    if product_name:
        match = PurchaseItem.query.filter_by(
            purchase_order_id=order.id, product_name=product_name
        ).first()
    # Exact match by product_code
    if not match and product_code:
        match = PurchaseItem.query.filter_by(
            purchase_order_id=order.id, product_code=product_code
        ).first()
    # Fuzzy match by product_name (LIKE)
    if not match and product_name:
        match = PurchaseItem.query.filter(
            PurchaseItem.purchase_order_id == order.id,
            PurchaseItem.product_name.contains(product_name),
        ).first()
    # Reverse fuzzy: purchase product_name contains in delivery product_name
    if not match and product_name:
        for pi in order.items.all():
            if pi.product_name and pi.product_name in product_name:
                match = pi
                break
    return match


def _remove_purchase_remarks(po_no, product_name, product_code, delivery_date, quantity):
    """Remove 'M/D送qty' from matching purchase item remarks."""
    order = PurchaseOrder.query.filter_by(po_no=po_no).first()
    if not order:
        return

    match = None
    if product_name:
        match = PurchaseItem.query.filter_by(
            purchase_order_id=order.id, product_name=product_name
        ).first()
    if not match and product_code:
        match = PurchaseItem.query.filter_by(
            purchase_order_id=order.id, product_code=product_code
        ).first()
    if not match:
        return

    m = delivery_date.month
    d = delivery_date.day
    qty_str = str(int(quantity)) if quantity == int(quantity) else str(quantity)
    entry = f'{m}/{d}送{qty_str}'

    current = (match.remarks or '').strip()
    if entry not in current:
        return

    # Remove the entry and clean up separators
    parts = [p.strip() for p in current.replace('、', '，').replace(',', '，').split('，') if p.strip()]
    parts = [p for p in parts if p != entry]
    match.remarks = '，'.join(parts)




def _detect_delivery_columns(header):
    """Detect column indices from header row."""
    col_map = {}
    name_mapping = {
        'delivery_date': ('日期',),
        'delivery_no': ('送货单号',),
        'product_code': ('货号',),
        'product_name': ('货号名称', '货品名称', '品名'),
        'quantity': ('数量',),
        'unit': ('单位RMB', '单位'),
        'unit_price': ('单价RMB', '单价'),
        'amount': ('金额RMB', '金额'),
        'po_no': ('备注',),
    }
    for key, names in name_mapping.items():
        for i, h in enumerate(header):
            if h in names:
                col_map[key] = i
                break

    # Must have at least delivery_no and product_name
    if 'product_name' not in col_map:
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
        if isinstance(val, (int, float)):
            serial = int(val)
            # Valid Excel serial dates are roughly 1 ~ 73050 (1900-01-01 ~ 2099-12-31)
            if 1 <= serial <= 73050:
                return (pd.Timestamp('1899-12-30') + pd.Timedelta(days=serial)).date()
    except Exception:
        pass
    try:
        return datetime.strptime(str(val).strip(), '%Y-%m-%d').date()
    except Exception:
        return None
