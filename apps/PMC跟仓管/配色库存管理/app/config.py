import os
from datetime import timedelta

# python run.py 方式启动时不会自动加载 .env (Flask 的自动加载只在 flask CLI 下生效),
# 在读取 env 之前显式 load_dotenv。python-dotenv 找不到 .env 就安静跳过。
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass


class Config:
    SECRET_KEY = os.environ.get("SECRET_KEY", "")
    SQLALCHEMY_DATABASE_URI = "sqlite:///peise.db"
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    # 登录配置(单密码模式)
    AUTH_USERNAME = os.environ.get("AUTH_USERNAME", "").strip()
    AUTH_PASSWORD = os.environ.get("AUTH_PASSWORD", "").strip()
    # "记住我"勾选后 session 保留 7 天
    PERMANENT_SESSION_LIFETIME = timedelta(days=7)
