FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt gunicorn

COPY . .

RUN mkdir -p /app/data/uploads /app/data/output

ENV PORT=5003
ENV DATA_PATH=/app/data

EXPOSE 5003

CMD ["gunicorn", "--bind", "0.0.0.0:5003", "--workers", "2", "--threads", "4", "--timeout", "300", "app:app"]
