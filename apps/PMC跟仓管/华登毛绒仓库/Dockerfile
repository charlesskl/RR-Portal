FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

ENV PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple/
ENV PIP_TRUSTED_HOST=mirrors.aliyun.com

# gunicorn 用于生产（替代 waitress，跟 sibling Flask app 一致）
RUN pip install --no-cache-dir gunicorn==21.2.0

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# data/ 用 bind mount 覆盖，但镜像里需要存在目录占位以防裸跑
RUN mkdir -p /app/data

RUN addgroup --system appgroup && adduser --system --ingroup appgroup appuser && \
    chown -R appuser:appgroup /app

EXPOSE 5009

USER appuser

CMD ["gunicorn", "--bind", "0.0.0.0:5009", "--workers", "2", "--threads", "4", "--timeout", "120", "app:app"]
