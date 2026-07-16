#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/rr-portal}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.cloud.yml}"
ENV_FILE="${ENV_FILE:-${INSTALL_DIR}/.env.cloud.production}"
APP_DIR="${INSTALL_DIR}/apps/船务部/船务管理系统"
SEED_BLOB="${APP_DIR}/seed/history.sqlite3.gz.enc"
TARGET_DIR="${APP_DIR}/data/import"
TARGET_DB="${TARGET_DIR}/history.sqlite3"
SHIPPING_DB="${APP_DIR}/data/shipping.db"
MARKER="${APP_DIR}/data/.history_seeded"

cd "$INSTALL_DIR"

count_shipments() {
  local db_path="$1"
  if [[ ! -f "$db_path" ]]; then
    echo 0
    return 0
  fi

  SHIPPING_COUNT_DB="$db_path" python3 -c '
import os
import sqlite3

db_path = os.environ["SHIPPING_COUNT_DB"]
try:
    con = sqlite3.connect(db_path)
    rows = con.execute("select count(*) from shipments_shipment").fetchone()[0]
    con.close()
    print(rows)
except Exception:
    print(0)
'
}

if [[ ! -f "$SEED_BLOB" ]]; then
  echo "[shipping-history] encrypted seed not present; skipping."
  exit 0
fi

if [[ -z "${SHIPPING_HISTORY_SEED_PASSPHRASE:-}" ]]; then
  echo "[shipping-history][FAIL] SHIPPING_HISTORY_SEED_PASSPHRASE is empty." >&2
  exit 1
fi

tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

mkdir -p "$TARGET_DIR"

echo "[shipping-history] decrypting private seed..."
printf '%s' "$SHIPPING_HISTORY_SEED_PASSPHRASE" \
  | openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 -salt \
      -pass stdin \
      -in "$SEED_BLOB" \
      -out "${tmp_dir}/history.sqlite3.gz"

gzip -dc "${tmp_dir}/history.sqlite3.gz" > "${tmp_dir}/history.sqlite3"

SEED_CHECK_DB="${tmp_dir}/history.sqlite3" python3 -c '
import os
import sqlite3
import sys

db_path = os.environ["SEED_CHECK_DB"]
con = sqlite3.connect(db_path)
cur = con.cursor()
integrity = cur.execute("pragma integrity_check").fetchone()[0]
shipments = cur.execute("select count(*) from shipments_shipment").fetchone()[0]
items = cur.execute("select count(*) from shipments_shipmentitem").fetchone()[0]
emails = cur.execute("select count(*) from emails_emailrecord").fetchone()[0]
con.close()
print(f"[shipping-history] seed integrity={integrity}, shipments={shipments}, items={items}, emails={emails}")
if integrity != "ok" or shipments <= 0 or items <= 0:
    sys.exit(1)
'

seed_shipments=$(SEED_CHECK_DB="${tmp_dir}/history.sqlite3" python3 -c '
import os
import sqlite3

con = sqlite3.connect(os.environ["SEED_CHECK_DB"])
rows = con.execute("select count(*) from shipments_shipment").fetchone()[0]
con.close()
print(rows)
')

mv "${tmp_dir}/history.sqlite3" "$TARGET_DB"
chmod 666 "$TARGET_DB"
echo "[shipping-history] seed installed at $TARGET_DB"

current_shipments="$(count_shipments "$SHIPPING_DB")"
if [[ -f "$MARKER" ]] && [[ "${current_shipments:-0}" -ge "$seed_shipments" ]]; then
  echo "[shipping-history] marker exists and shipping.db already has shipments=$current_shipments; skipping replace."
  exit 0
fi

if [[ "${current_shipments:-0}" -lt "$seed_shipments" ]]; then
  if [[ -f "$SHIPPING_DB" ]]; then
    backup="${SHIPPING_DB}.pre-history-seed.$(date +%Y%m%d-%H%M%S)"
    cp "$SHIPPING_DB" "$backup"
    echo "[shipping-history] backed up existing shipping.db (shipments=$current_shipments) to $backup"
  fi

  cp "$TARGET_DB" "$SHIPPING_DB"
  chmod 666 "$SHIPPING_DB"
  printf 'seed_db=%s\nseed_shipments=%s\ninstalled_at=%s\n' \
    "$TARGET_DB" "$seed_shipments" "$(date -Iseconds)" > "$MARKER"
  echo "[shipping-history] replaced shipping.db with history seed (shipments=$seed_shipments)"
else
  echo "[shipping-history] shipping.db has shipments=$current_shipments, seed has shipments=$seed_shipments; leaving existing db in place."
fi

echo "[shipping-history] recreating shipping-management to trigger import..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --no-deps --force-recreate shipping-management

for _ in $(seq 1 30); do
  rows="$(count_shipments "$SHIPPING_DB")"
  if [[ "${rows:-0}" -ge "$seed_shipments" ]]; then
    echo "[shipping-history] history visible in shipping.db: shipments=$rows"
    exit 0
  fi
  sleep 2
done

echo "[shipping-history][FAIL] shipping.db did not reach seed shipment count ($seed_shipments) after restart." >&2
docker logs rr-portal-shipping-management-1 --tail 120 2>&1 || true
exit 1
