FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# 运行时卷挂载点
RUN mkdir -p /app/data /app/uploads /app/exports

ENV PORT=5005
ENV DATA_PATH=/app

EXPOSE 5005

CMD ["gunicorn", "--bind", "0.0.0.0:5005", "--workers", "2", "--threads", "4", "--timeout", "300", "app:app"]
