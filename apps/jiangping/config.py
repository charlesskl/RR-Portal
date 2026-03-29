import os
import sys

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DATA_DIR = os.environ.get('DATA_PATH', BASE_DIR)

_secret = os.environ.get('SECRET_KEY', '')
if not _secret or _secret == 'huadeng-jiangping-2026':
    print("FATAL: SECRET_KEY env var is required and must not be the old default.", file=sys.stderr)
    sys.exit(1)

class Config:
    SECRET_KEY = _secret
    SQLALCHEMY_DATABASE_URI = 'sqlite:///' + os.path.join(DATA_DIR, 'data.db')
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    UPLOAD_FOLDER = os.environ.get('UPLOAD_FOLDER', os.path.join(BASE_DIR, 'uploads'))
    MAX_CONTENT_LENGTH = 16 * 1024 * 1024
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = 'Lax'
