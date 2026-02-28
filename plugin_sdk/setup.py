from setuptools import setup, find_packages

setup(
    name="enterprise-plugin-sdk",
    version="1.0.0",
    packages=find_packages(),
    install_requires=[
        "fastapi>=0.115.0",
        "uvicorn[standard]>=0.34.0",
        "sqlalchemy[asyncio]>=2.0.30",
        "asyncpg>=0.30.0",
        "pydantic>=2.10.0",
        "pydantic-settings>=2.7.0",
        "python-jose[cryptography]>=3.3.0",
        "redis[hiredis]>=5.2.0",
        "httpx>=0.28.0",
        "pyyaml>=6.0",
    ],
    python_requires=">=3.12",
)
