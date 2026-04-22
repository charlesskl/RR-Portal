#!/usr/bin/env bash
set -euo pipefail

# ─── RR Portal Cloud Update Script — Diff-based incremental deploy ───
#
# 策略：根据本次 push 变动的文件路径，只 rebuild 影响到的服务。
# 对比老版本（全量 docker compose up --build）的优势：
#   - 改 paiji 不会把其他 16 个服务也 recreate / IP 重洗
#   - 改 nginx.conf 只 hot reload，零停机（而非 restart nginx）
#   - 改非部署文件（docs/scripts/markdown）跳过 deploy
#   - fallback：docker-compose.cloud.yml 变动时仍走全量（保守策略）
#
# 使用：
#   bash /opt/rr-portal/deploy/update-server.sh
#
# 强制全量部署（调试用）：
#   FORCE_FULL_REBUILD=1 bash /opt/rr-portal/deploy/update-server.sh

INSTALL_DIR="/opt/rr-portal"
ENV_FILE="${INSTALL_DIR}/.env.cloud.production"
COMPOSE_FILE="docker-compose.cloud.yml"
STATE_FILE="${INSTALL_DIR}/deploy/.deploy-state"
BACKUP_DIR="${INSTALL_DIR}/deploy/backups"

cd "$INSTALL_DIR"

# ─── State tracking (supports resume) ───
save_state() { echo "$1" > "$STATE_FILE"; }
cleanup_state() { rm -f "$STATE_FILE"; }
check_resume() {
  if [[ -f "$STATE_FILE" ]]; then
    echo "[RESUME] Previous deploy interrupted at: $(cat $STATE_FILE). Re-running from start."
  fi
}
trap cleanup_state EXIT

echo "=== RR Portal Update (diff-based) ==="
check_resume

# ─── Step 1: 清理僵尸容器（可能上次部署残留）───
save_state "cleanup"
echo "[1/6] Cleaning up orphan containers..."
ORPHANS=$(docker ps -a --filter status=created --filter status=restarting --format '{{.Names}}' 2>/dev/null || true)
if [[ -n "$ORPHANS" ]]; then
  echo "  Removing:"
  echo "$ORPHANS" | sed 's/^/    /'
  # 用 -f 强删（restarting 状态的容器 docker rm 会拒绝）
  docker ps -a --filter status=created --filter status=restarting -q | xargs -r docker rm -f
fi

# ─── Step 2: Pull latest + 算出变动文件 ───
save_state "pulling"
echo "[2/6] Pulling latest code..."

# BEFORE_HEAD 优先级：
#   1. env BEFORE_COMMIT（GitHub Action 传入 github.event.before，最可靠）
#   2. 当前 HEAD（下面 pull 之前的状态）
# 这样即使有人在 workflow 之外先 pull 了，也能算出真实 diff
if [[ -n "${BEFORE_COMMIT:-}" ]] && git rev-parse "$BEFORE_COMMIT" >/dev/null 2>&1; then
  BEFORE_HEAD=$(git rev-parse "$BEFORE_COMMIT")
  echo "  BEFORE_HEAD from env BEFORE_COMMIT: ${BEFORE_HEAD:0:7}"
else
  BEFORE_HEAD=$(git rev-parse HEAD)
  echo "  BEFORE_HEAD from local HEAD: ${BEFORE_HEAD:0:7}"
fi

git fetch origin
git checkout main
git pull --ff-only origin main
AFTER_HEAD=$(git rev-parse HEAD)

if [[ "$BEFORE_HEAD" == "$AFTER_HEAD" ]]; then
  echo "  No new commits. Nothing to deploy."
  exit 0
fi

# core.quotePath=false 让中文/非 ASCII 路径不被 \xxx 转义，否则 PATH_TO_SERVICE 前缀匹配会 fail
CHANGED_FILES=$(git -c core.quotePath=false diff --name-only "$BEFORE_HEAD" "$AFTER_HEAD")
echo "  Changed files (${BEFORE_HEAD:0:7} → ${AFTER_HEAD:0:7}):"
echo "$CHANGED_FILES" | sed 's/^/    /'

# ─── Step 3: 算出影响的服务 ───
save_state "analyze"
echo "[3/6] Analyzing affected services..."

# path → service 映射（compose service name 为准）
# 匹配规则：CHANGED_FILES 里任一行以下列 prefix 开头，就标记对应 service
declare -A PATH_TO_SERVICE=(
  ["core/"]="core"
  # 业务 app：按部门 nested。service 名保持英文（DNS/nginx 依赖）
  ["apps/生产部/注塑啤机排产系统/"]="paiji"
  ["apps/PMC跟仓管/配色库存管理/"]="peise"
  ["apps/PMC跟仓管/华登包材管理/"]="huadeng"
  ["apps/PMC跟仓管/采购订单管理系统/"]="jiangping"
  ["apps/PMC跟仓管/成品核对系统/"]="liwenjuan"
  ["apps/业务部/套客表系统/"]="quotation"
  ["apps/业务部/TOMY排期核对系统/"]="tomy-paiqi"
  ["apps/业务部/ZURU接单表入单系统/"]="zuru-order-system"
  ["apps/业务部/ZURU总排期入单/"]="zuru-master-schedule"
  ["apps/业务部/ZURU河源排期入单/"]="hy-schedule-system"
  ["apps/工程部/A-doc生成系統/"]="zouhuo"
  ["apps/工程部/工程啤办单/"]="rr-production"
  ["apps/工程部/模具手办采购订单系统/"]="figure-mold-cost-system"
  ["apps/task-api/"]="task-api"
)

AFFECTED_SERVICES=()
NGINX_CHANGED=0
FRONTEND_CHANGED=0
COMPOSE_CHANGED=0
DB_INIT_CHANGED=0
PLUGIN_SDK_CHANGED=0
NONRUNTIME_ONLY=1  # 默认假设只改了非运行时文件，遇到需部署的就翻转

while IFS= read -r file; do
  [[ -z "$file" ]] && continue

  # 忽略纯文档/脚本/归档（不影响容器）
  case "$file" in
    *.md|docs/*|devops/logs/*|LICENSE|.gitignore|.github/*|devops/scripts/*|deploy/*|archived/*)
      continue ;;
  esac

  # docker-compose.cloud.yml 变动 = 触发全量（服务定义/网络/volume 可能变）
  if [[ "$file" == "docker-compose.cloud.yml" ]]; then
    COMPOSE_CHANGED=1
    NONRUNTIME_ONLY=0
    continue
  fi

  # nginx 配置 = hot reload，不 rebuild
  if [[ "$file" == nginx/* ]]; then
    NGINX_CHANGED=1
    NONRUNTIME_ONLY=0
    continue
  fi

  # frontend 静态文件 = nginx 会重新读（bind mount），reload 触发
  if [[ "$file" == frontend/* ]]; then
    FRONTEND_CHANGED=1
    NONRUNTIME_ONLY=0
    continue
  fi

  # plugin_sdk 变动 = 所有使用 plugin_sdk 的插件要重 build
  # 当前没有 plugin_sdk 插件在运行，保留这个检查防未来
  if [[ "$file" == plugin_sdk/* ]]; then
    PLUGIN_SDK_CHANGED=1
    NONRUNTIME_ONLY=0
    continue
  fi

  # scripts/init-db.sql 变动 = 重建 db 的种子，需要特殊处理
  if [[ "$file" == scripts/init-db.sql ]]; then
    DB_INIT_CHANGED=1
    NONRUNTIME_ONLY=0
    continue
  fi

  # 尝试匹配服务路径
  MATCHED=0
  for prefix in "${!PATH_TO_SERVICE[@]}"; do
    if [[ "$file" == "$prefix"* ]]; then
      svc="${PATH_TO_SERVICE[$prefix]}"
      # 去重添加
      if [[ ! " ${AFFECTED_SERVICES[*]} " =~ " $svc " ]]; then
        AFFECTED_SERVICES+=("$svc")
      fi
      MATCHED=1
      NONRUNTIME_ONLY=0
      break
    fi
  done

  if [[ "$MATCHED" -eq 0 ]]; then
    echo "  [WARN] 未识别路径: $file（不确定影响哪个服务，保守起见后面会观察）"
  fi
done <<< "$CHANGED_FILES"

# 强制全量（环境变量覆盖）
if [[ "${FORCE_FULL_REBUILD:-0}" == "1" ]]; then
  COMPOSE_CHANGED=1
  echo "  [FORCED] FORCE_FULL_REBUILD=1，走全量"
fi

# 打印决策
echo "  Decision:"
echo "    Affected services: ${AFFECTED_SERVICES[*]:-<none>}"
echo "    Nginx config:      $([ $NGINX_CHANGED -eq 1 ] && echo 'changed → will reload' || echo 'unchanged')"
echo "    Frontend static:   $([ $FRONTEND_CHANGED -eq 1 ] && echo 'changed → will trigger nginx reload' || echo 'unchanged')"
echo "    Compose:           $([ $COMPOSE_CHANGED -eq 1 ] && echo 'changed → FULL RECREATE' || echo 'unchanged')"
echo "    DB init script:    $([ $DB_INIT_CHANGED -eq 1 ] && echo 'changed (manual action may be needed)' || echo 'unchanged')"
echo "    Plugin SDK:        $([ $PLUGIN_SDK_CHANGED -eq 1 ] && echo 'changed → all SDK plugins would rebuild' || echo 'unchanged')"

# 没有运行时变动，跳过 deploy
if [[ "$NONRUNTIME_ONLY" -eq 1 ]] && [[ "${#AFFECTED_SERVICES[@]}" -eq 0 ]]; then
  echo "  [SKIP] 只改了文档/脚本/workflow/*.md，不触发部署。"
  exit 0
fi

# ─── Step 4: 确保 data 目录存在 ───
save_state "directories"
echo "[4/6] Ensuring data directories..."
python3 -c "
import re, os
with open('${COMPOSE_FILE}') as f:
    content = f.read()
for match in re.findall(r'^\s*-\s+\./([^:]+):', content, re.MULTILINE):
    path = match.strip()
    if any(seg in path for seg in ['data', 'uploads', 'instance']):
        os.makedirs(path, exist_ok=True)
" 2>/dev/null || true

# ─── Step 5: 备份数据库（只在影响 db 或全量时）───
if [[ "$COMPOSE_CHANGED" -eq 1 ]] || [[ " ${AFFECTED_SERVICES[*]} " =~ " core " ]] || [[ "$DB_INIT_CHANGED" -eq 1 ]]; then
  save_state "backup"
  echo "[5/6] Backing up databases (core/db 会被动到)..."
  mkdir -p "$BACKUP_DIR"
  BACKUP_TS="$(date +%Y%m%d-%H%M%S)"
  if docker compose -f "$COMPOSE_FILE" ps db 2>/dev/null | grep -q "running"; then
    PG_BACKUP="${BACKUP_DIR}/postgres-${BACKUP_TS}.sql.gz"
    docker compose -f "$COMPOSE_FILE" exec -T db \
      pg_dump -U "${DB_USER:-rrportal}" "${DB_NAME:-rrportal}" 2>/dev/null \
      | gzip > "$PG_BACKUP" \
      && echo "  [OK] PostgreSQL → ${PG_BACKUP}" \
      || echo "  [WARN] PostgreSQL backup failed"
  fi
  find apps/ plugins/ -path '*/data/*.db' -type f 2>/dev/null | while read -r db_file; do
    backup_name="$(echo "$db_file" | tr '/' '-')-${BACKUP_TS}"
    cp "$db_file" "${BACKUP_DIR}/${backup_name}" && echo "  [OK] ${db_file}"
  done
  ls -t "$BACKUP_DIR"/postgres-*.sql.gz 2>/dev/null | tail -n +6 | xargs rm -f 2>/dev/null || true
  ls -t "$BACKUP_DIR"/*.db-* 2>/dev/null | tail -n +11 | xargs rm -f 2>/dev/null || true
else
  echo "[5/6] DB 未被影响，跳过备份"
fi

# ─── Step 6: 执行部署 ───
save_state "deploy"
echo "[6/6] Deploying..."

if [[ "$COMPOSE_CHANGED" -eq 1 ]]; then
  # Compose 变动：可能只是 context path 改了（代码没变），也可能加新服务
  # 策略：先 up -d（无 --build），让 docker 用现有 image 只 recreate 容器
  # 这样纯 rename 几乎零成本；如果有新服务或 Dockerfile 变了再用 AFFECTED_SERVICES 做增量 build
  echo "  [COMPOSE] Compose 变动，recreate 容器（不强制 rebuild，避免 OOM 风险）"
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d
  # 还要 rebuild 那些真的动了源码的服务（incremental）
  for svc in "${AFFECTED_SERVICES[@]}"; do
    echo "  [INCR] Rebuilding $svc (--no-deps)..."
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --build --no-deps "$svc"
  done
  # 容器 IP 全变，但 nginx 用动态 resolver 10 秒自动感知
elif [[ "${#AFFECTED_SERVICES[@]}" -gt 0 ]]; then
  # 增量：只 rebuild 影响的服务，带 --no-deps 不触发依赖链
  for svc in "${AFFECTED_SERVICES[@]}"; do
    echo "  [INCR] Rebuilding $svc (--no-deps)..."
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --build --no-deps "$svc"
  done
  # 容器 recreate 后 Docker bridge IP 会变，但因为 nginx 现在用动态 resolver
  # （resolver 127.0.0.11 valid=10s），10 秒内就重新解析了。不需要 restart nginx。
  echo "  [INFO] nginx 用动态 resolver，无需 restart（10 秒内自动感知新 IP）"
fi

# nginx 配置变动 → hot reload（零停机）
if [[ "$NGINX_CHANGED" -eq 1 ]] || [[ "$FRONTEND_CHANGED" -eq 1 ]]; then
  echo "  [NGINX] 配置/前端变动，hot reload（零停机）"
  if docker exec rr-portal-nginx-1 nginx -t 2>&1 | grep -q "syntax is ok"; then
    docker exec rr-portal-nginx-1 nginx -s reload
    echo "  [OK] nginx reloaded"
  else
    echo "  [ERROR] nginx -t 失败，拒绝 reload（保持旧配置运行）"
    docker exec rr-portal-nginx-1 nginx -t 2>&1
    exit 1
  fi
fi

# plugin_sdk 变动 → 提示（当前无 plugin_sdk 插件）
if [[ "$PLUGIN_SDK_CHANGED" -eq 1 ]]; then
  echo "  [WARN] plugin_sdk/ 变动，但当前无 plugin_sdk 插件在运行。如未来有 SDK 插件需同时 rebuild。"
fi

# DB init 变动 → 提示（不自动跑，避免数据风险）
if [[ "$DB_INIT_CHANGED" -eq 1 ]]; then
  echo "  [WARN] scripts/init-db.sql 变动。不自动执行（数据风险），需人工检查后手动 psql -f。"
fi

# ─── Health check (等 nginx) ───
echo "  Waiting for nginx health..."
for i in $(seq 1 15); do
  if curl -sf http://localhost/nginx-health > /dev/null 2>&1; then
    echo "  [OK] nginx healthy (${i}x2s)"
    break
  fi
  sleep 2
done

echo "[OK] Update complete."
echo "=== Container Status ==="
docker compose -f "$COMPOSE_FILE" ps --format "table {{.Name}}\t{{.Status}}" 2>/dev/null || true
