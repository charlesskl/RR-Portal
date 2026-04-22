#!/bin/sh
# Fix bind-mount ownership at runtime, then drop privileges to node user.
# Host bind-mount directories are typically owned by root (UID 0); the node
# user inside the container (UID 1000) cannot write to them unless we chown
# on startup. We stay as root only long enough to chown, then exec as node.
set -e

if [ -d /app/server/data ]; then
  chown -R node:node /app/server/data 2>/dev/null || true
fi

exec su-exec node "$@"
