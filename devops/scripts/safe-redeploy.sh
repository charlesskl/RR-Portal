#!/usr/bin/env bash
# safe-redeploy.sh — 单服务安全部署封装
#
# 封装以下安全检查：
#   1. 扫僵尸容器（Created/Restarting）并清理
#   2. 检查 ECS 可用内存
#   3. --no-deps build / restart 指定服务（不触发全站 recreate）
#   4. nginx -t 验证配置
#   5. nginx -s reload（零停机重载，而非 restart）
#   6. 健康检查
#   7. 任何一步失败立即停
#
# 使用：
#   ./devops/scripts/safe-redeploy.sh <service>
#   ./devops/scripts/safe-redeploy.sh <service> --restart-only   # 代码没变只重启进程
#   ./devops/scripts/safe-redeploy.sh --help

set -euo pipefail

SSH_ALIAS="${SSH_ALIAS:-rr-portal}"
COMPOSE_FILE="docker-compose.cloud.yml"
ENV_FILE=".env.cloud.production"
PROJECT_DIR="/opt/rr-portal"
NGINX_AUTH="${NGINX_AUTH:-rr:leo123456}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${BLUE}▶${NC} $*"; }
ok()   { echo -e "${GREEN}✓${NC} $*"; }
warn() { echo -e "${YELLOW}⚠${NC} $*"; }
fail() { echo -e "${RED}✗${NC} $*" >&2; exit 1; }

# ─── 参数解析 ───
SERVICE=""
RESTART_ONLY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h)
      head -20 "$0" | tail -18 | sed 's/^# \?//'
      exit 0
      ;;
    --restart-only)
      RESTART_ONLY=1
      shift
      ;;
    -*)
      fail "Unknown option: $1"
      ;;
    *)
      if [[ -z "$SERVICE" ]]; then
        SERVICE="$1"
      else
        fail "Too many positional args. Usage: $0 <service> [--restart-only]"
      fi
      shift
      ;;
  esac
done

[[ -z "$SERVICE" ]] && fail "Missing service name. Usage: $0 <service> [--restart-only]"

# ─── Step 0: SSH 可达 + compose 文件存在 ───
log "SSH 可达检查 ($SSH_ALIAS)"
ssh -o ConnectTimeout=10 "$SSH_ALIAS" "test -f $PROJECT_DIR/$COMPOSE_FILE" \
  || fail "SSH 不通或 $PROJECT_DIR/$COMPOSE_FILE 不存在"
ok "SSH + compose 文件 OK"

# ─── Step 1: 服务名合法性 ───
log "验证服务名 '$SERVICE' 是 compose 里定义的服务"
if ! ssh "$SSH_ALIAS" "cd $PROJECT_DIR && docker compose -f $COMPOSE_FILE --env-file $ENV_FILE config --services 2>/dev/null | grep -qx '$SERVICE'"; then
  fail "$SERVICE 不是 $COMPOSE_FILE 里的服务"
fi
ok "服务名合法"

# ─── Step 2: 扫僵尸容器 ───
log "扫僵尸容器（Created/Restarting）"
ORPHANS=$(ssh "$SSH_ALIAS" "docker ps -a --filter status=created --filter status=restarting --format '{{.Names}}' 2>/dev/null" || true)
if [[ -n "$ORPHANS" ]]; then
  warn "发现僵尸容器，清理中:"
  echo "$ORPHANS" | sed 's/^/    /'
  ssh "$SSH_ALIAS" "docker ps -a --filter status=created --filter status=restarting -q | xargs -r docker rm"
  ok "僵尸清理完成"
else
  ok "无僵尸"
fi

# ─── Step 3: 内存检查 ───
log "ECS 内存检查"
MEM_AVAIL_MB=$(ssh "$SSH_ALIAS" "free -m | awk '/^Mem:/ {print \$7}'")
log "  available: ${MEM_AVAIL_MB} MB"
if [[ "$RESTART_ONLY" -eq 0 ]]; then
  if (( MEM_AVAIL_MB < 1000 )); then
    fail "可用内存 <1GB 不建议 build（OOM 风险）。用 --restart-only 或先释放内存"
  elif (( MEM_AVAIL_MB < 1500 )); then
    warn "可用内存 <1.5GB，含前端 build 的服务（paiji/tomy-paiqi 等）可能 OOM。谨慎继续"
  fi
fi
ok "内存检查通过"

# ─── Step 4: 当前服务状态 ───
log "当前 $SERVICE 状态"
ssh "$SSH_ALIAS" "docker ps --filter name=rr-portal-$SERVICE --format '  {{.Names}} | {{.Status}}'" || true

# ─── Step 5: 执行部署 ───
if [[ "$RESTART_ONLY" -eq 1 ]]; then
  log "执行 restart（不 recreate 容器，保持 IP 不变）"
  ssh "$SSH_ALIAS" "cd $PROJECT_DIR && docker compose -f $COMPOSE_FILE --env-file $ENV_FILE restart $SERVICE" \
    || fail "restart 失败"
  ok "restart 完成"
else
  log "执行 build + up（带 --no-deps，不触发依赖链 recreate）"
  ssh "$SSH_ALIAS" "cd $PROJECT_DIR && docker compose -f $COMPOSE_FILE --env-file $ENV_FILE up -d --build --no-deps $SERVICE" 2>&1 | tail -15 \
    || fail "build/up 失败"
  ok "build + up 完成"
fi

# ─── Step 6: 等待容器 healthy ───
log "等待 $SERVICE healthy（最多 60 秒）"
HEALTHY=0
for i in $(seq 1 12); do
  STATUS=$(ssh "$SSH_ALIAS" "docker inspect --format '{{.State.Health.Status}}' rr-portal-$SERVICE-1 2>/dev/null" || echo "missing")
  case "$STATUS" in
    healthy)
      HEALTHY=1
      ok "容器 healthy（耗时 ~$((i*5)) 秒）"
      break
      ;;
    unhealthy)
      ssh "$SSH_ALIAS" "docker logs --tail=20 rr-portal-$SERVICE-1" || true
      fail "容器变 unhealthy，看上面日志"
      ;;
    starting|"")
      echo -n "."
      sleep 5
      ;;
    *)
      echo -n " [$STATUS]"
      sleep 5
      ;;
  esac
done
echo
[[ "$HEALTHY" -eq 0 ]] && fail "60 秒内容器未 healthy"

# ─── Step 7: nginx 配置验证（如果改了 nginx 本身，脚本外部应该单独处理；这里只验证现状 OK）───
log "nginx 配置验证"
if ! ssh "$SSH_ALIAS" "docker exec rr-portal-nginx-1 nginx -t 2>&1" | grep -q "syntax is ok"; then
  fail "nginx -t 失败！nginx 配置有问题，不 reload"
fi
ok "nginx -t 通过"

# ─── Step 8: nginx 热重载（零停机，不用 restart）───
# 注意：不用 `docker compose restart nginx`（会整个 kill + start）
# 用 `nginx -s reload` 优雅重载，worker 进程逐步替换，现有连接不断
log "nginx 热重载"
ssh "$SSH_ALIAS" "docker exec rr-portal-nginx-1 nginx -s reload" \
  || fail "nginx reload 失败"
ok "nginx reload 完成"

# ─── Step 9: 健康检查 ───
# 服务名 → URL path 映射
declare -A PATH_MAP=(
  [core]="/health"
  [nginx]="/nginx-health"
  [rr-production]="/rr/health"
  [zouhuo]="/zouhuo/health"
  [paiji]="/paiji/health"
  [peise]="/peise/health"
  [jiangping]="/jiangping/health"
  [baojia]="/baojia/health"
  [tomy-paiqi]="/tomy-paiqi/health"
  [liwenjuan]="/liwenjuan/health"
  [zuru-master-schedule]="/zuru-master/health"
  [zuru-order-system]="/zuru-order-system/health"
  [new-product-schedule]="/new-product-schedule/health"
  [figure-mold-cost-system]="/figure-mold-cost-system/health"
  [huadeng]="/huadeng/health"
)

HEALTH_PATH="${PATH_MAP[$SERVICE]:-}"
if [[ -n "$HEALTH_PATH" ]]; then
  log "HTTP 健康检查: $HEALTH_PATH"
  CODE=$(ssh "$SSH_ALIAS" "curl -sS -o /dev/null -w '%{http_code}' -u '$NGINX_AUTH' 'http://127.0.0.1${HEALTH_PATH}'")
  if [[ "$CODE" == "200" || "$CODE" == "302" ]]; then
    ok "HTTP $CODE"
  else
    fail "HTTP $CODE（期望 200/302）"
  fi
else
  warn "$SERVICE 没有 health path 映射，跳过 HTTP 检查"
fi

# ─── 总结 ───
echo
ok "部署完成: $SERVICE"
log "最终状态:"
ssh "$SSH_ALIAS" "docker ps --filter name=rr-portal-$SERVICE --format '  {{.Names}} | {{.Status}}'" || true
