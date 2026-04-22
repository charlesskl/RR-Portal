FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

ENV PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple/
ENV PIP_TRUSTED_HOST=mirrors.aliyun.com

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p /app/data

RUN addgroup --system appgroup && adduser --system --ingroup appgroup appuser && \
    chown -R appuser:appgroup /app

EXPOSE 5007

USER appuser

CMD ["gunicorn", "--bind", "0.0.0.0:5007", "--workers", "2", "--threads", "2", "--timeout", "120", "app:app"]
