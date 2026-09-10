import os
import sys
import json

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DATA_DIR = os.environ.get('DATA_PATH', BASE_DIR)

_secret = os.environ.get('SECRET_KEY', '')
if not _secret or _secret == 'huadeng-jiangping-2026':
    print("FATAL: SECRET_KEY env var is required and must not be the old default.", file=sys.stderr)
    sys.exit(1)

_login_username = os.environ.get('LOGIN_USERNAME', 'jp')
_login_password = os.environ.get('LOGIN_PASSWORD', 'jp123456')

# 额外登录账号: LOGIN_ACCOUNTS 为 JSON 对象 {"用户名":"密码",...},与主账号并存
try:
    _login_accounts = {
        **{str(k).strip(): str(v) for k, v in json.loads(os.environ.get('LOGIN_ACCOUNTS', '') or '{}').items()},
        **({_login_username: _login_password} if _login_username else {}),
    }
except json.JSONDecodeError:
    print('FATAL: LOGIN_ACCOUNTS 不是合法 JSON(应为 {"用户名":"密码"} 对象)', file=sys.stderr)
    sys.exit(1)

class Config:
    SECRET_KEY = _secret
    LOGIN_USERNAME = _login_username
    LOGIN_PASSWORD = _login_password
    LOGIN_ACCOUNTS = _login_accounts
    SQLALCHEMY_DATABASE_URI = 'sqlite:///' + os.path.join(DATA_DIR, 'data.db')
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    UPLOAD_FOLDER = os.environ.get('UPLOAD_FOLDER', os.path.join(BASE_DIR, 'uploads'))
    MAX_CONTENT_LENGTH = 16 * 1024 * 1024
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = 'Lax'
