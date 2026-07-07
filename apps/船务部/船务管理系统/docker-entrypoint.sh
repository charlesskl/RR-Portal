#!/bin/sh
set -e

mkdir -p "${DATA_DIR:-/app/data}" "${MEDIA_ROOT:-/app/data/media}"

if [ -z "${DJANGO_SECRET_KEY:-}" ]; then
  SECRET_FILE="${DJANGO_SECRET_KEY_FILE:-/app/data/.django_secret_key}"
  mkdir -p "$(dirname "$SECRET_FILE")"
  if [ ! -s "$SECRET_FILE" ]; then
    python -c "import secrets; print(secrets.token_urlsafe(50))" > "$SECRET_FILE"
  fi
  export DJANGO_SECRET_KEY="$(cat "$SECRET_FILE")"
fi

python manage.py migrate --noinput
python manage.py seed_admin

exec gunicorn config.wsgi:application \
  --bind "0.0.0.0:${PORT:-8000}" \
  --workers "${GUNICORN_WORKERS:-2}" \
  --timeout "${GUNICORN_TIMEOUT:-300}"
