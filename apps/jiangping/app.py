import os
from flask import Flask, jsonify
from config import Config
from models import db


class PrefixMiddleware:
    """Set SCRIPT_NAME so url_for generates correct URLs behind a reverse proxy."""
    def __init__(self, app, prefix=''):
        self.app = app
        self.prefix = prefix

    def __call__(self, environ, start_response):
        environ['SCRIPT_NAME'] = self.prefix
        return self.app(environ, start_response)


def create_app():
    app = Flask(__name__)
    app.config.from_object(Config)
    os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

    # Apply BASE_PATH prefix for sub-path reverse proxy
    base_path = os.environ.get('BASE_PATH', '')
    if base_path:
        app.wsgi_app = PrefixMiddleware(app.wsgi_app, prefix=base_path)

    db.init_app(app)
    with app.app_context():
        db.create_all()

    from routes.upload import bp as upload_bp
    from routes.purchase import bp as purchase_bp
    from routes.supplier import bp as supplier_bp
    from routes.delivery import bp as delivery_bp
    from routes.export import bp as export_bp
    from routes.dashboard import bp as dashboard_bp
    from routes.delivery_mgmt import bp as delivery_mgmt_bp
    from routes.problems import bp as problems_bp

    app.register_blueprint(upload_bp)
    app.register_blueprint(purchase_bp)
    app.register_blueprint(supplier_bp)
    app.register_blueprint(delivery_bp)
    app.register_blueprint(export_bp)
    app.register_blueprint(dashboard_bp)
    app.register_blueprint(delivery_mgmt_bp)
    app.register_blueprint(problems_bp)

    @app.route('/')
    def index():
        from flask import redirect, url_for
        return redirect(url_for('upload.upload_page'))

    @app.route('/health')
    def health():
        return jsonify({'status': 'ok'})

    return app


if __name__ == '__main__':
    import os
    app = create_app()
    app.run(debug=os.environ.get('FLASK_DEBUG', '0') == '1', port=5001)
