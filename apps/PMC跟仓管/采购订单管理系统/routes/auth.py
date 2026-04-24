from urllib.parse import urlparse
from flask import Blueprint, render_template, request, redirect, url_for, session, current_app, flash

bp = Blueprint('auth', __name__)


def _safe_next(target: str) -> bool:
    if not target:
        return False
    parsed = urlparse(target)
    return not parsed.netloc and not parsed.scheme and target.startswith('/')


@bp.route('/login', methods=['GET', 'POST'])
def login():
    if session.get('logged_in'):
        return redirect(url_for('index'))

    error = None
    if request.method == 'POST':
        username = request.form.get('username', '').strip()
        password = request.form.get('password', '')
        if (username == current_app.config['LOGIN_USERNAME']
                and password == current_app.config['LOGIN_PASSWORD']):
            session['logged_in'] = True
            session.permanent = False
            next_url = request.args.get('next') or request.form.get('next')
            if next_url and _safe_next(next_url):
                return redirect(next_url)
            return redirect(url_for('index'))
        error = '账号或密码错误'

    return render_template('login.html', error=error, next=request.args.get('next', ''))


@bp.route('/logout')
def logout():
    session.clear()
    flash('已退出登录', 'info')
    return redirect(url_for('auth.login'))
