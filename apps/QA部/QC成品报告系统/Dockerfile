FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=3410

WORKDIR /app
RUN groupadd --system qc && useradd --system --gid qc --home-dir /app qc
COPY requirements.txt ./
# 阿里云 PyPI 镜像（国内 ECS 构建加速，避免拉包超时）
RUN pip config set global.index-url https://mirrors.aliyun.com/pypi/simple/ \
    && pip install --no-cache-dir -r requirements.txt
COPY app.py ai_service.py pdf_service.py task_queue.py unified_pdf.py worker.py ./
COPY alembic.ini ./
COPY migrations ./migrations
COPY templates ./templates
COPY static ./static
RUN mkdir -p /app/storage /app/data && chown -R qc:qc /app
USER qc
EXPOSE 3410
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD python -c "import os, urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\", \"3410\")}/health', timeout=3)"
CMD ["sh", "-c", "exec gunicorn --bind 0.0.0.0:${PORT:-3410} --workers ${WEB_CONCURRENCY:-1} --threads 4 --timeout 120 app:app"]
