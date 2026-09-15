#!/usr/bin/env bash
set -euo pipefail

test_dir="$(mktemp -d /tmp/voyageplex-auth-test.XXXXXX)"
port="${VOYAGEPLEX_TEST_PORT:-5199}"
base_url="http://127.0.0.1:${port}"
api_dll="server/VoyagePlex.Api/bin/Debug/net8.0/VoyagePlex.Api.dll"

cleanup() {
  kill "${server_pid:-0}" 2>/dev/null || true
  rm -rf "$test_dir"
}
trap cleanup EXIT

dotnet build server/VoyagePlex.Api/VoyagePlex.Api.csproj --no-restore >/dev/null
ConnectionStrings__Default="Data Source=${test_dir}/test.db" ASPNETCORE_URLS="$base_url" dotnet "$api_dll" >"${test_dir}/server.log" 2>&1 &
server_pid=$!

for _ in {1..30}; do
  curl -fsS "${base_url}/api/health" >/dev/null 2>&1 && break
  sleep 0.2
done

status() { curl -sS -o /dev/null -w '%{http_code}' "$@"; }
json=(-H 'content-type: application/json')

test "$(status "${json[@]}" -d '{"username":"admin01","displayName":"系统管理员","password":"AdminTest123!"}' "${base_url}/api/auth/setup")" = "201"
test "$(status -c "${test_dir}/admin.cookies" "${json[@]}" -d '{"username":"admin01","password":"AdminTest123!"}' "${base_url}/api/auth/login")" = "200"
test "$(status -b "${test_dir}/admin.cookies" "${json[@]}" -d '{"username":"warehouse01","displayName":"仓库文员","role":"warehouse","password":"Warehouse123!"}' "${base_url}/api/users")" = "201"
test "$(status -c "${test_dir}/warehouse.cookies" "${json[@]}" -d '{"username":"warehouse01","password":"Warehouse123!"}' "${base_url}/api/auth/login")" = "200"
test "$(status -b "${test_dir}/warehouse.cookies" "${base_url}/api/users")" = "403"
test "$(status -b "${test_dir}/warehouse.cookies" "${json[@]}" -d '{"customer":"越权测试"}' "${base_url}/api/shipments")" = "403"
test "$(status -b "${test_dir}/admin.cookies" -X PUT "${json[@]}" -d '{"displayName":"系统管理员","role":"shipping","isActive":true}' "${base_url}/api/users/1")" = "400"
test "$(status -b "${test_dir}/admin.cookies" "${json[@]}" -d '{"password":"Warehouse456!"}' "${base_url}/api/users/2/reset-password")" = "204"
test "$(status -b "${test_dir}/warehouse.cookies" "${base_url}/api/auth/me")" = "401"

echo "用户认证与权限测试通过"
