#!/bin/sh
# Fix bind-mount ownership at runtime, then drop privileges to app user.
# Host bind-mount directories are typically owned by root (UID 0); the app
# user inside the container (UID 1000) cannot write to them unless we chown
# on startup. We stay as root only long enough to chown, then exec as app.
set -e

if [ -d /app/uploads ]; then
  chown -R app:app /app/uploads 2>/dev/null || true
fi

exec gosu app "$@"
