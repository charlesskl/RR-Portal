"""
认证和权限模块
- 密码哈希
- 登录验证装饰器
- 角色权限装饰器
"""
import hashlib
from functools import wraps
from flask import session, jsonify, request, redirect, url_for


PASSWORD_SALT = 'huadeng_plush_2026_salt'


def hash_password(password):
    """密码哈希(加盐 SHA-256)"""
    return hashlib.sha256((password + PASSWORD_SALT).encode('utf-8')).hexdigest()


def check_password(password, password_hash):
    """验证密码"""
    return hash_password(password) == password_hash


def login_required(f):
    """装饰器:必须登录"""
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'user_id' not in session:
            if request.path.startswith('/api/'):
                return jsonify({'error': '未登录'}), 401
            return redirect(url_for('login_page'))
        return f(*args, **kwargs)
    return decorated


def role_required(*allowed_roles):
    """装饰器:指定角色才能访问"""
    def decorator(f):
        @wraps(f)
        def decorated(*args, **kwargs):
            if 'user_id' not in session:
                return jsonify({'error': '未登录'}), 401
            if session.get('role') not in allowed_roles:
                return jsonify({'error': '权限不足'}), 403
            return f(*args, **kwargs)
        return decorated
    return decorator


def current_user():
    """获取当前用户信息"""
    if 'user_id' not in session:
        return None
    return {
        'id': session.get('user_id'),
        'username': session.get('username'),
        'role': session.get('role'),
        'display_name': session.get('display_name')
    }
