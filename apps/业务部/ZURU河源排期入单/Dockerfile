FROM python:3.12-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt gunicorn
COPY . .
RUN mkdir -p uploads uploads/schedules exports data
EXPOSE 5006
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:5006/health || exit 1
CMD ["gunicorn", "--bind", "0.0.0.0:5006", "--workers", "1", "--threads", "4", "--timeout", "120", "app:app"]
