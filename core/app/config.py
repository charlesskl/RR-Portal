import sys
from pydantic_settings import BaseSettings
from pydantic import field_validator
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
    JWT_SECRET: str  # No default — must be set via env
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRATION_MINUTES: int = 60

    # ─── CORS ───
    ALLOWED_ORIGINS: str = "http://localhost"

    # ─── Admin bootstrap ───
    ADMIN_USERNAME: str = "admin"
    ADMIN_PASSWORD: str  # No default — must be set via env
    ADMIN_EMAIL: str = "admin@company.com"

    @field_validator("JWT_SECRET")
    @classmethod
    def jwt_secret_must_be_strong(cls, v: str) -> str:
        banned = {"change-me-in-production", "change-me", "secret", ""}
        if v in banned or len(v) < 32:
            print("FATAL: JWT_SECRET must be at least 32 characters and not a known default.", file=sys.stderr)
            sys.exit(1)
        return v

    @field_validator("ADMIN_PASSWORD")
    @classmethod
    def admin_password_must_be_strong(cls, v: str) -> str:
        banned = {"admin123", "password", "admin", "changeme", ""}
        if v in banned or len(v) < 10:
            print("FATAL: ADMIN_PASSWORD must be at least 10 characters and not a known default.", file=sys.stderr)
            sys.exit(1)
        return v

    model_config = {"env_file": ".env", "extra": "ignore"}


@lru_cache()
def get_settings() -> Settings:
    return Settings()
