import os

class Config:
    SECRET_KEY = os.environ.get("SECRET_KEY", "dev-key-change-me")
    SQLALCHEMY_DATABASE_URI = "sqlite:///peise.db"
    SQLALCHEMY_TRACK_MODIFICATIONS = False
