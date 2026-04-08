FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt gunicorn

COPY . .

RUN mkdir -p uploads

EXPOSE 5004

ENV PORT=5004
ENV UPLOAD_FOLDER=/app/uploads

CMD ["gunicorn", "-w", "2", "-b", "0.0.0.0:5004", "--timeout", "300", "app:app"]
