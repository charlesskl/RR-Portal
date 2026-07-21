#!/usr/bin/env bash
set -euo pipefail

DATA_DIR="${DATA_PATH:-/app/data}"
DB_PATH="${SPRAYPLAN_DB_PATH:-${DATA_DIR}/sprayplan.db}"
SECRET_PATH="${DATA_DIR}/jwt-secret"

mkdir -p "$DATA_DIR" /app/server/SprayPlan.Api/storage/pdf

if [[ ! -f "$DB_PATH" ]]; then
  cp /app/prisma/seed.db "$DB_PATH"
  echo "Initialized independent SprayPlan database: $DB_PATH"
fi

if [[ -z "${JWT_SECRET:-}" ]]; then
  if [[ ! -f "$SECRET_PATH" ]]; then
    node -e "process.stdout.write(require('node:crypto').randomBytes(64).toString('base64url'))" > "$SECRET_PATH"
    chmod 600 "$SECRET_PATH"
  fi
  export JWT_SECRET="$(<"$SECRET_PATH")"
fi

export JWT_ISSUER="${JWT_ISSUER:-sprayplan}"
export Jwt__Secret="$JWT_SECRET"
export Jwt__Issuer="$JWT_ISSUER"
export SPRAYPLAN_DB_PATH="$DB_PATH"
export SPRAYPLAN_BASE_PATH="${NEXT_PUBLIC_BASE_PATH:-/sprayplan}"

(cd /app/server/SprayPlan.Api && exec dotnet publish/SprayPlan.Api.dll --urls http://127.0.0.1:5080) &
api_pid=$!
node /app/node_modules/next/dist/bin/next start -H 0.0.0.0 -p 8400 &
web_pid=$!

cleanup() {
  kill "$api_pid" "$web_pid" 2>/dev/null || true
  wait "$api_pid" "$web_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

while kill -0 "$api_pid" 2>/dev/null && kill -0 "$web_pid" 2>/dev/null; do
  sleep 2
done

echo "SprayPlan process exited unexpectedly" >&2
exit 1
