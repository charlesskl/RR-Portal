FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# 运行时卷挂载点（SQLite 数据）
RUN mkdir -p /app/data

ENV PCBA_DB=/app/data/pcba.db

EXPOSE 5011

CMD ["uvicorn", "pcba.main:app", "--host", "0.0.0.0", "--port", "5011"]
