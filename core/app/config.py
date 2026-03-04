from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # ─── App ───
    APP_NAME: str = "Enterprise Platform"
    VERSION: str = "1.0.0"
    DEBUG: bool = False

    # ─── Database ───
    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@db:5432/enterprise"

    # ─── Redis ───
    REDIS_URL: str = "redis://redis:6379/0"

    # ─── JWT ───
    JWT_SECRET: str = "change-me-in-production"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRATION_MINUTES: int = 60

    # ─── CORS ───
    ALLOWED_ORIGINS: str = "http://localhost"

    # ─── Admin bootstrap ───
    ADMIN_USERNAME: str = "admin"
    ADMIN_PASSWORD: str = "admin123"
    ADMIN_EMAIL: str = "admin@company.com"

    model_config = {"env_file": ".env", "extra": "ignore"}


@lru_cache()
def get_settings() -> Settings:
    return Settings()
