from flask import Blueprint, render_template
from sqlalchemy import func
from app.extensions import db
from app.models import Pigment, Stock, Transaction
from datetime import datetime

bp = Blueprint("dashboard", __name__)

@bp.route("/")
def index():
    total_pigments = Pigment.query.filter_by(is_archived=False).count()
    total_bottles = db.session.query(func.coalesce(func.sum(Stock.quantity), 0)).scalar()

    low_stock_rows = (db.session.query(Pigment, Stock)
                      .join(Stock, Stock.pigment_id == Pigment.id)
                      .filter(Pigment.is_archived == False,
                              Stock.quantity <= Pigment.min_stock)
                      .all())

    month_start = datetime.now().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    month_tx_count = Transaction.query.filter(Transaction.occurred_at >= month_start).count()

    family_rows = (db.session.query(Pigment.color_family, func.count(Pigment.id))
                   .filter(Pigment.is_archived == False)
                   .group_by(Pigment.color_family).all())

    return render_template("dashboard.html",
                           total_pigments=total_pigments,
                           total_bottles=total_bottles,
                           low_stock=low_stock_rows,
                           month_tx_count=month_tx_count,
                           family_data=family_rows)
