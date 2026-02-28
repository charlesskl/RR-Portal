FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*

# Install Plugin SDK (build context is project root)
COPY plugin_sdk /tmp/plugin_sdk
RUN pip install --no-cache-dir /tmp/plugin_sdk && rm -rf /tmp/plugin_sdk

# Install plugin dependencies
COPY plugins/RR-production-system/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy plugin code
COPY plugins/RR-production-system/ .

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
