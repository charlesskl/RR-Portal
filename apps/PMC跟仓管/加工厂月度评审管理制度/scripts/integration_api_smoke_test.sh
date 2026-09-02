#!/usr/bin/env bash
# 只读冒烟测试：对接车缝核价对比系统集成 API。
# 用法: ./scripts/integration_api_smoke_test.sh <base_url> <api_key>
# 例:   ./scripts/integration_api_smoke_test.sh https://example.com/factory-review <key>
# 只发起 GET 请求，绝不写数据；任一检查失败以非零退出。
set -u

BASE_URL="${1:-}"
API_KEY="${2:-}"
API="${BASE_URL%/}/api/integration/v1"

if [ -z "$BASE_URL" ] || [ -z "$API_KEY" ]; then
  echo "用法: $0 <base_url> <api_key>" >&2
  exit 2
fi

FAILED=0

pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; FAILED=1; }

# get <url> [with_auth] -> 写 body 到 $BODY，http code 到 $CODE
get() {
  local url="$1" auth="${2:-yes}" tmp
  tmp="$(mktemp)"
  if [ "$auth" = "yes" ]; then
    CODE="$(curl -sS -o "$tmp" -w '%{http_code}' -H "Authorization: Bearer ${API_KEY}" "$url")"
  else
    CODE="$(curl -sS -o "$tmp" -w '%{http_code}' "$url")"
  fi
  BODY="$(cat "$tmp")"
  rm -f "$tmp"
}

# json_check <expr>：用 python3 对 $BODY 执行断言表达式，expr 中可用变量 d
json_check() {
  python3 -c "
import json, sys
try:
    d = json.loads(sys.stdin.read())
except Exception:
    sys.exit(1)
sys.exit(0 if ($1) else 1)
" <<< "$BODY"
}

# 1. health 200
get "$API/health"
if [ "$CODE" = "200" ] && json_check "d.get('status')=='ok' and d.get('service')=='factory-review-integration' and d.get('version')=='v1'"; then
  pass "GET /health 返回 200 且 status=ok"
else
  fail "GET /health 期望 200，实际 $CODE，body: $BODY"
fi

# 2. 无 key 401
get "$API/health" no
if [ "$CODE" = "401" ] && json_check "d.get('code')==401"; then
  pass "无 Authorization 返回 401"
else
  fail "无 Authorization 期望 401，实际 $CODE，body: $BODY"
fi

# 3. 单独传 cursor_id 400
get "$API/factories?cursor_id=abc"
if [ "$CODE" = "400" ] && json_check "d.get('code')==400"; then
  pass "单独传 cursor_id 返回 400"
else
  fail "单独传 cursor_id 期望 400，实际 $CODE，body: $BODY"
fi

# 4. factories 200 且返回结构含游标字段
get "$API/factories?page_size=1"
if [ "$CODE" = "200" ] && json_check "isinstance(d.get('data'), list) and 'next_cursor_id' in d and 'next_updated_after' in d and 'has_more' in d and d.get('sort')=='updated_at,id'"; then
  pass "GET /factories 返回 200 且结构含 next_cursor_id/has_more"
else
  fail "GET /factories 期望 200 且含游标字段，实际 $CODE，body: $BODY"
fi

# 5. orders 200 且返回结构含游标字段
get "$API/orders?page_size=1"
if [ "$CODE" = "200" ] && json_check "isinstance(d.get('data'), list) and 'next_cursor_id' in d and 'has_more' in d and d.get('sort')=='updated_at,id'"; then
  pass "GET /orders 返回 200 且结构含 next_cursor_id/has_more"
else
  fail "GET /orders 期望 200 且含游标字段，实际 $CODE，body: $BODY"
fi

if [ "$FAILED" -ne 0 ]; then
  echo "冒烟测试未通过" >&2
  exit 1
fi
echo "冒烟测试全部通过"
