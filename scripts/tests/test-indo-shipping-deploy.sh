#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
export INDO_DEPLOY_LIBRARY_ONLY=1
# shellcheck source=../../deploy/update-server.sh
source "$ROOT/deploy/update-server.sh"
unset INDO_DEPLOY_LIBRARY_ONLY

fail() {
  echo "Indonesia deploy contract failed: $*" >&2
  exit 1
}

tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

before_compose="$tmp_dir/before.yml"
after_compose="$tmp_dir/after.yml"
cat > "$before_compose" <<'YAML'
services:
  unrelated:
    image: unrelated:v1
  indo-sqlserver:
    image: mcr.microsoft.com/mssql/server:2022-latest
  indo-shipping-init:
    image: indo:init-v1
  indo-shipping:
    image: indo:app-v1
networks:
  platform-net:
YAML
sed 's/indo:init-v1/indo:init-v2/' "$before_compose" > "$after_compose"
indo_compose_services_changed "$before_compose" "$after_compose" \
  || fail "compose-only Indonesia service changes must select the targeted path"
if indo_compose_non_target_services_changed "$before_compose" "$after_compose"; then
  fail "Indonesia-only Compose changes must not be classified as mixed"
fi

sed 's/unrelated:v1/unrelated:v2/' "$before_compose" > "$after_compose"
if indo_compose_services_changed "$before_compose" "$after_compose"; then
  fail "unrelated Compose changes must not be classified as Indonesia-targeted"
fi
indo_compose_non_target_services_changed "$before_compose" "$after_compose" \
  || fail "unrelated Compose changes must be classified as mixed"

seed_file="$tmp_dir/private-seed/business-data.json"
if require_indo_seed_file "$seed_file"; then
  fail "missing private seed must stop deployment"
fi
mkdir -p "$(dirname "$seed_file")"
printf '{"schemaVersion":"test","tables":{},"images":[],"users":[]}\n' > "$seed_file"
require_indo_seed_file "$seed_file" \
  || fail "non-empty private seed must pass deployment preflight"

docker_log="$tmp_dir/docker.log"
docker() {
  printf '%s\n' "$*" >> "$docker_log"
}
AFFECTED_SERVICES=(indo-shipping unrelated)
COMPOSE_FILE="$after_compose"
ENV_FILE="$tmp_dir/deploy.env"
deploy_non_indonesia_affected_services
grep -q 'up -d --build --no-deps unrelated' "$docker_log" \
  || fail "targeted deploy must rebuild other source-affected services"
if grep -q 'up -d --build --no-deps indo-shipping' "$docker_log"; then
  fail "generic affected-service helper must skip indo-shipping"
fi

env_file="$tmp_dir/production.env"
data_dir="$tmp_dir/sql-data"
mkdir -p "$data_dir"
touch "$data_dir/master.mdf"

old_sa=$(printf '%s' 'old sa $;"'"'"'\ edge ' | base64 | tr -d '\r\n')
new_sa=$(printf '%s' ' new sa $;"'"'"'\ edge ' | base64 | tr -d '\r\n')
old_app=$(printf '%s' 'old app' | base64 | tr -d '\r\n')
new_app=$(printf '%s' ' new app $;"'"'"'\ edge ' | base64 | tr -d '\r\n')
old_jwt=$(printf '%s' 'old-jwt-key-that-is-at-least-thirty-two-characters' | base64 | tr -d '\r\n')
new_jwt=$(printf '%s' ' new-jwt-$;"'"'"'\-key-that-is-at-least-thirty-two-characters ' | base64 | tr -d '\r\n')
old_admin=$(printf '%s' 'old-admin' | base64 | tr -d '\r\n')
new_admin=$(printf '%s' ' new admin $;"'"'"'\ edge ' | base64 | tr -d '\r\n')

cat > "$env_file" <<ENV
UNCHANGED=value
INDO_SQL_SA_PASSWORD_B64=$old_sa
INDO_SQL_APP_PASSWORD_B64=$old_app
INDO_SHIPPING_JWT_KEY_B64=$old_jwt
INDO_SHIPPING_ADMIN_PASSWORD_B64=$old_admin
ENV

export INDO_SQL_SA_PASSWORD_B64="$new_sa"
export INDO_SQL_APP_PASSWORD_B64="$new_app"
export INDO_SHIPPING_JWT_KEY_B64="$new_jwt"
export INDO_SHIPPING_ADMIN_PASSWORD_B64="$new_admin"

load_indo_secret_transport "$env_file"
indo_secret_transport_changed "$env_file" \
  || fail "any Indonesia secret change must select the targeted path"

rotation_log="$tmp_dir/rotation.log"
rotation_fails() {
  printf 'rotation-attempted\n' >> "$rotation_log"
  return 1
}

if sync_indo_secret_transport "$env_file" "$data_dir" rotation_fails; then
  fail "failed SA rotation must fail secret synchronization"
fi
grep -qx 'rotation-attempted' "$rotation_log" \
  || fail "existing SQL data must attempt SA rotation"
grep -qx "INDO_SQL_SA_PASSWORD_B64=$old_sa" "$env_file" \
  || fail "failed SA rotation must preserve the old dotenv value"
if grep -q "$new_sa" "$env_file"; then
  fail "failed SA rotation must not persist the new SA value"
fi

rotation_succeeds() {
  [[ "$1" == "$old_sa" ]] || return 1
  [[ "$2" == "$new_sa" ]] || return 1
  grep -qx "INDO_SQL_SA_PASSWORD_B64=$old_sa" "$env_file" || return 1
  printf 'rotation-succeeded\n' >> "$rotation_log"
}

sync_indo_secret_transport "$env_file" "$data_dir" rotation_succeeds
grep -qx 'rotation-succeeded' "$rotation_log" \
  || fail "SA rotation must complete before dotenv persistence"
grep -qx "INDO_SQL_SA_PASSWORD_B64=$new_sa" "$env_file" \
  || fail "successful SA rotation must persist the new value"
grep -qx "INDO_SQL_APP_PASSWORD_B64=$old_app" "$env_file" \
  || fail "non-SA values must remain old until init and app startup succeed"

persist_indo_secret_transport "$env_file"
grep -qx "INDO_SQL_APP_PASSWORD_B64=$new_app" "$env_file" \
  || fail "application password changes must be persisted"
grep -qx 'UNCHANGED=value' "$env_file" \
  || fail "atomic persistence must retain unrelated dotenv entries"

echo "Indonesia deploy shell contract OK"
