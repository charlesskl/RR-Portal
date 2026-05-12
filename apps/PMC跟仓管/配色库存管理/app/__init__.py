import os

from flask import Flask
from werkzeug.middleware.proxy_fix import ProxyFix

from .config import Config
from .extensions import db

def create_app(config_class=Config):
    app = Flask(__name__, instance_relative_config=True)
    app.config.from_object(config_class)

    # 让 url_for() 在 nginx 子路径反代下生成正确链接（X-Forwarded-Prefix）
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1)

    os.makedirs(app.instance_path, exist_ok=True)

    _ensure_secret_key(app)
    _validate_auth_config(app)

    db.init_app(app)

    from .routes import dashboard, pigments, transactions, pending, settings as settings_routes, auth as auth_routes
    app.register_blueprint(auth_routes.bp)
    app.register_blueprint(dashboard.bp)
    app.register_blueprint(pigments.bp, url_prefix="/pigments")
    app.register_blueprint(transactions.bp, url_prefix="/transactions")
    app.register_blueprint(pending.bp, url_prefix="/pending")
    app.register_blueprint(settings_routes.bp, url_prefix="/settings")

    from .auth import install_login_guard
    install_login_guard(app)

    @app.route("/health")
    def _health():
        return {"status": "ok"}, 200

    from . import models  # noqa: F401
    with app.app_context():
        db.create_all()
        _migrate_uq_brand_code_partial()
        _migrate_pending_review_ref_tx_id()

    return app


def _migrate_pending_review_ref_tx_id():
    """把 pending_review.ref_tx_id 列加到老表(支持 type='edit_in')。幂等。"""
    from sqlalchemy import text
    conn = db.session.connection()
    cols = {r[1] for r in conn.execute(text("PRAGMA table_info(pending_review)"))}
    if "ref_tx_id" not in cols:
        conn.execute(text("ALTER TABLE pending_review ADD COLUMN ref_tx_id INTEGER"))
        db.session.commit()


def _ensure_secret_key(app):
    """SECRET_KEY 优先读 env;没设就从 instance/.secret_key 读或首次生成后落盘。
    instance/ 在云端是 bind mount,key 跨容器重启持久化。"""
    if app.config.get("SECRET_KEY"):
        return
    import secrets
    key_path = os.path.join(app.instance_path, ".secret_key")
    if os.path.exists(key_path):
        with open(key_path, "r", encoding="utf-8") as f:
            app.config["SECRET_KEY"] = f.read().strip()
            return
    os.makedirs(app.instance_path, exist_ok=True)
    new_key = secrets.token_hex(32)
    with open(key_path, "w", encoding="utf-8") as f:
        f.write(new_key)
    app.config["SECRET_KEY"] = new_key


def _validate_auth_config(app):
    """启动时必须有 AUTH_USERNAME / AUTH_PASSWORD,否则拒绝起服务。
    SECRET_KEY 由 _ensure_secret_key 保底,不在这里校验。"""
    missing = [k for k in ("AUTH_USERNAME", "AUTH_PASSWORD")
               if not app.config.get(k)]
    if missing:
        raise RuntimeError(
            f"启动配置缺失: {', '.join(missing)}。"
            f"请在 .env 里设置这些值(参考 .env.example)。"
        )


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
