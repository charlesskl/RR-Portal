from flask import Flask
from .config import Config
from .extensions import db

def create_app(config_class=Config):
    app = Flask(__name__, instance_relative_config=True)
    app.config.from_object(config_class)

    import os
    os.makedirs(app.instance_path, exist_ok=True)

    db.init_app(app)

    from .routes import dashboard, pigments, transactions
    app.register_blueprint(dashboard.bp)
    app.register_blueprint(pigments.bp, url_prefix="/pigments")
    app.register_blueprint(transactions.bp, url_prefix="/transactions")

    @app.route("/health")
    def _health():
        return {"status": "ok"}, 200

    from . import models  # noqa: F401
    with app.app_context():
        db.create_all()
        _migrate_uq_brand_code_partial()

    return app


def _migrate_uq_brand_code_partial():
    """把旧版全行唯一的 uq_brand_code 迁移成部分唯一索引(WHERE code != '')。

    早期版本定义为 UniqueConstraint,SQLite 实际落成无 WHERE 的 UNIQUE INDEX;
    支持多个待填色粉(code='')共存就得改成部分索引。幂等。"""
    from sqlalchemy import text
    conn = db.session.connection()
    row = conn.execute(text(
        "SELECT sql FROM sqlite_master WHERE type='index' AND name='uq_brand_code'"
    )).fetchone()
    current_sql = (row[0] if row else "") or ""
    if " WHERE " in current_sql.upper():
        return  # 已经是部分索引
    conn.execute(text("DROP INDEX IF EXISTS uq_brand_code"))
    conn.execute(text(
        "CREATE UNIQUE INDEX uq_brand_code ON pigment(brand, code) WHERE code != ''"
    ))
    db.session.commit()
