FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl gosu && rm -rf /var/lib/apt/lists/*

# 阿里云 PyPI 镜像（pypi.org 在国内不稳定，会超时）
ENV PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple/
ENV PIP_TRUSTED_HOST=mirrors.aliyun.com

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt gunicorn

RUN groupadd --system app && useradd --system --gid app --home /app app

COPY . .

RUN mkdir -p uploads && chown -R app:app /app && chmod +x /app/entrypoint.sh

EXPOSE 5004

ENV PORT=5004
ENV UPLOAD_FOLDER=/app/uploads

ENTRYPOINT ["/app/entrypoint.sh"]

CMD ["gunicorn", "-w", "2", "-b", "0.0.0.0:5004", "--timeout", "300", "app:app"]
