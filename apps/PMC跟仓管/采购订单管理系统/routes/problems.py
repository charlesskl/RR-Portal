from datetime import datetime, timedelta
from flask import Blueprint, render_template, jsonify
from models import db, PurchaseOrder, PurchaseItem, DeliveryNote, DeliveryNoteItem, MatchProblem

bp = Blueprint('problems', __name__, url_prefix='/problems')


@bp.route('/')
def list_problems():
    # Auto-delete resolved problems older than 30 minutes
    cutoff = datetime.now() - timedelta(minutes=30)
    MatchProblem.query.filter(
        MatchProblem.status == 'resolved',
        MatchProblem.resolved_at.isnot(None),
        MatchProblem.resolved_at <= cutoff,
    ).delete()
    db.session.commit()

    problems = MatchProblem.query.order_by(
        MatchProblem.status.desc(),  # unresolved first
        MatchProblem.id,
    ).all()
    unresolved = sum(1 for p in problems if p.status == 'unresolved')
    return render_template('problems.html', problems=problems, unresolved=unresolved)


@bp.route('/api/resolve/<int:problem_id>', methods=['POST'])
def resolve(problem_id):
    """Mark a single problem as resolved."""
    p = MatchProblem.query.get_or_404(problem_id)
    p.status = 'resolved'
    p.resolved_at = datetime.now()
    db.session.commit()
    return jsonify({'success': True})


@bp.route('/api/unresolve/<int:problem_id>', methods=['POST'])
def unresolve(problem_id):
    """Mark a resolved problem back to unresolved."""
    p = MatchProblem.query.get_or_404(problem_id)
    p.status = 'unresolved'
    p.resolved_at = None
    db.session.commit()
    return jsonify({'success': True})


@bp.route('/api/clear-resolved', methods=['POST'])
def clear_resolved():
    """Delete all resolved problems."""
    MatchProblem.query.filter_by(status='resolved').delete()
    db.session.commit()
    return jsonify({'success': True})


@bp.route('/api/rematch', methods=['POST'])
def rematch():
    """Re-check all unresolved problems against current purchase data.
    If matched, mark as resolved.
    """
    # Build purchase lookup
    purchase_lookup = {}
    for pi in PurchaseItem.query.join(PurchaseOrder).all():
        po_no = pi.order.po_no or ''
        if po_no:
            purchase_lookup.setdefault(po_no, []).append(pi)

    unresolved = MatchProblem.query.filter_by(status='unresolved').all()
    matched_count = 0
    for p in unresolved:
        if _is_matched(p, purchase_lookup):
            p.status = 'resolved'
            p.resolved_at = datetime.now()
            matched_count += 1

    db.session.commit()
    remaining = MatchProblem.query.filter_by(status='unresolved').count()
    return jsonify({'success': True, 'matched': matched_count, 'remaining': remaining})


def refresh_problems():
    """Regenerate problems from delivery data. Called after import.
    - New problems are added as unresolved
    - Existing problems that now match are marked resolved
    - Already tracked problems are not duplicated
    """
    # Auto-delete old resolved
    cutoff = datetime.now() - timedelta(minutes=30)
    MatchProblem.query.filter(
        MatchProblem.status == 'resolved',
        MatchProblem.resolved_at.isnot(None),
        MatchProblem.resolved_at <= cutoff,
    ).delete()

    # Build purchase lookup
    purchase_lookup = {}
    for pi in PurchaseItem.query.join(PurchaseOrder).all():
        po_no = pi.order.po_no or ''
        if po_no:
            purchase_lookup.setdefault(po_no, []).append(pi)

    # Build set of existing problem keys to avoid duplicates
    existing = {}
    for p in MatchProblem.query.all():
        key = (p.po_no, p.product_name, p.delivery_no)
        existing[key] = p

    # Scan all delivery items
    seen_keys = set()
    for di in DeliveryNoteItem.query.join(DeliveryNote).all():
        po_no = (di.po_no or '').strip()
        if not po_no:
            continue

        note = di.note
        date_str = note.delivery_date.strftime('%Y/%m/%d') if note.delivery_date else ''
        supplier = note.supplier.short_name or note.supplier.name if note.supplier else ''
        qty = float(di.quantity or 0)
        qty_str = str(int(qty)) if qty == int(qty) else str(qty)
        delivery_no = note.delivery_no or ''

        # Check if this delivery item has a problem
        problem_type = None
        if po_no not in purchase_lookup:
            problem_type = 'po_missing'
        else:
            pi_list = purchase_lookup[po_no]
            match = False
            for pi in pi_list:
                if pi.product_name and di.product_name:
                    if (pi.product_name == di.product_name
                            or di.product_name in pi.product_name
                            or pi.product_name in di.product_name):
                        match = True
                        break
                if pi.product_code and di.product_code and pi.product_code == di.product_code:
                    match = True
                    break
            if not match:
                problem_type = 'product_missing'

        key = (po_no, di.product_name or '', delivery_no)
        seen_keys.add(key)

        if problem_type:
            if key in existing:
                # Already tracked - if it was resolved but problem persists, re-open
                ep = existing[key]
                if ep.status == 'resolved':
                    # Problem still exists, keep as resolved (will auto-delete)
                    pass
            else:
                # New problem
                p = MatchProblem(
                    type=problem_type,
                    po_no=po_no,
                    product_name=di.product_name or '',
                    quantity=qty_str,
                    supplier=supplier,
                    delivery_no=delivery_no,
                    delivery_date=date_str,
                    status='unresolved',
                )
                db.session.add(p)
        else:
            # No problem - if previously tracked, mark resolved
            if key in existing and existing[key].status == 'unresolved':
                existing[key].status = 'resolved'
                existing[key].resolved_at = datetime.now()

    db.session.commit()


def _is_matched(problem, purchase_lookup):
    """Check if a problem is now resolved by current purchase data."""
    po_no = problem.po_no
    if po_no not in purchase_lookup:
        return False
    if problem.type == 'po_missing':
        return True  # PO now exists

    pi_list = purchase_lookup[po_no]
    for pi in pi_list:
        if pi.product_name and problem.product_name:
            if (pi.product_name == problem.product_name
                    or problem.product_name in pi.product_name
                    or pi.product_name in problem.product_name):
                return True
        if pi.product_code and problem.product_name and pi.product_code in problem.product_name:
            return True
    return False
