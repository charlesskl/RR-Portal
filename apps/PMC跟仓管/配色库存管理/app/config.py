import os
import json
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
    # 额外登录账号: AUTH_ACCOUNTS 为 JSON 对象 {"用户名":"密码",...},与上面的主账号并存
    try:
        AUTH_ACCOUNTS = {
            **{str(k).strip(): str(v) for k, v in json.loads(os.environ.get("AUTH_ACCOUNTS", "") or "{}").items()},
            **({AUTH_USERNAME: AUTH_PASSWORD} if AUTH_USERNAME else {}),
        }
    except json.JSONDecodeError:
        raise RuntimeError("AUTH_ACCOUNTS 不是合法 JSON(应为 {\"用户名\":\"密码\"} 对象)")
    # "记住我"勾选后 session 保留 7 天
    PERMANENT_SESSION_LIFETIME = timedelta(days=7)
