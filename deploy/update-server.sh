#!/usr/bin/env bash
set -euo pipefail

readonly INDO_SECRET_KEYS=(
  INDO_SQL_SA_PASSWORD_B64
  INDO_SQL_APP_PASSWORD_B64
  INDO_SHIPPING_JWT_KEY_B64
  INDO_SHIPPING_ADMIN_PASSWORD_B64
)

indo_compose_service_block() {
  local compose_file="$1"
  local service="$2"
  awk -v service="$service" '
    $0 == "  " service ":" { capture = 1 }
    capture && $0 ~ /^  [A-Za-z0-9][A-Za-z0-9_-]*:$/ && $0 != "  " service ":" { exit }
    capture && $0 ~ /^[^[:space:]]/ { exit }
    capture { print }
  ' "$compose_file"
}

indo_compose_services_changed() {
  local before_file="$1"
  local after_file="$2"
  local service
  for service in indo-sqlserver indo-shipping-init indo-shipping; do
    if [[ "$(indo_compose_service_block "$before_file" "$service")" != \
          "$(indo_compose_service_block "$after_file" "$service")" ]]; then
      return 0
    fi
  done
  return 1
}

indo_compose_services_changed_at_ref() {
  local before_ref="$1"
  local compose_path="$2"
  local after_file="$3"
  local before_file result=1
  before_file=$(mktemp)
  if ! git show "${before_ref}:${compose_path}" > "$before_file" 2>/dev/null; then
    : > "$before_file"
  fi
  if indo_compose_services_changed "$before_file" "$after_file"; then
    result=0
  fi
  rm -f "$before_file"
  return "$result"
}

indo_compose_without_target_services() {
  local compose_file="$1"
  awk '
    function is_target_header(line) {
      return line == "  indo-sqlserver:" || \
             line == "  indo-shipping-init:" || \
             line == "  indo-shipping:"
    }
    is_target_header($0) { skip = 1; next }
    skip {
      if ($0 ~ /^  [A-Za-z0-9][A-Za-z0-9_-]*:$/ || $0 ~ /^[^[:space:]]/) {
        skip = 0
      } else {
        next
      }
    }
    { print }
  ' "$compose_file"
}

indo_compose_non_target_services_changed() {
  local before_file="$1"
  local after_file="$2"
  [[ "$(indo_compose_without_target_services "$before_file")" != \
     "$(indo_compose_without_target_services "$after_file")" ]]
}

indo_compose_non_target_services_changed_at_ref() {
  local before_ref="$1"
  local compose_path="$2"
  local after_file="$3"
  local before_file result=1
  before_file=$(mktemp)
  if ! git show "${before_ref}:${compose_path}" > "$before_file" 2>/dev/null; then
    : > "$before_file"
  fi
  if indo_compose_non_target_services_changed "$before_file" "$after_file"; then
    result=0
  fi
  rm -f "$before_file"
  return "$result"
}

indo_dotenv_value() {
  local env_file="$1"
  local key="$2"
  [[ -f "$env_file" ]] || return 0
  grep -E "^${key}=" "$env_file" | head -n 1 | cut -d= -f2- || true
}

indo_validate_base64_secret() {
  local key="$1"
  local value="$2"
  if [[ -z "$value" ]] || ! printf '%s' "$value" | base64 --decode >/dev/null 2>&1; then
    echo "  [ERROR] Required Indonesia secret transport $key is missing or invalid."
    return 1
  fi
}

load_indo_secret_transport() {
  local env_file="$1"
  local key incoming persisted
  for key in "${INDO_SECRET_KEYS[@]}"; do
    incoming="${!key-}"
    persisted=$(indo_dotenv_value "$env_file" "$key")
    [[ -n "$incoming" ]] || incoming="$persisted"
    indo_validate_base64_secret "$key" "$incoming"
    printf -v "$key" '%s' "$incoming"
    export "$key"
  done
}

indo_secret_transport_changed() {
  local env_file="$1"
  local key
  for key in "${INDO_SECRET_KEYS[@]}"; do
    if [[ "$(indo_dotenv_value "$env_file" "$key")" != "${!key-}" ]]; then
      return 0
    fi
  done
  return 1
}

indo_sql_data_exists() {
  local data_dir="$1"
  [[ -d "$data_dir" ]] && [[ -n "$(find "$data_dir" -mindepth 1 -print -quit 2>/dev/null)" ]]
}

require_indo_seed_file() {
  local seed_file="$1"
  if [[ ! -s "$seed_file" ]]; then
    echo "  [ERROR] Private Indonesia seed is missing or empty: $seed_file"
    echo "  [ERROR] Provision the historical snapshot outside Git before deploying."
    return 1
  fi
}

indo_prepare_secret_env() {
  local env_file="$1"
  local temp_file key
  temp_file=$(mktemp "${env_file}.tmp.XXXXXX")
  if [[ -f "$env_file" ]]; then
    grep -Ev '^(INDO_SQL_SA_PASSWORD|INDO_SQL_APP_PASSWORD|INDO_SHIPPING_JWT_KEY|INDO_SHIPPING_ADMIN_PASSWORD)(_B64)?=' \
      "$env_file" > "$temp_file" || true
  fi
  for key in "${INDO_SECRET_KEYS[@]}"; do
    printf '%s=%s\n' "$key" "${!key}" >> "$temp_file"
  done
  chmod 600 "$temp_file"
  printf '%s\n' "$temp_file"
}

indo_prepare_sa_env() {
  local env_file="$1"
  local temp_file
  temp_file=$(mktemp "${env_file}.tmp.XXXXXX")
  if [[ -f "$env_file" ]]; then
    grep -Ev '^INDO_SQL_SA_PASSWORD(_B64)?=' "$env_file" > "$temp_file" || true
  fi
  printf 'INDO_SQL_SA_PASSWORD_B64=%s\n' "$INDO_SQL_SA_PASSWORD_B64" >> "$temp_file"
  chmod 600 "$temp_file"
  printf '%s\n' "$temp_file"
}

persist_indo_secret_transport() {
  local env_file="$1"
  local temp_file
  temp_file=$(indo_prepare_secret_env "$env_file")
  if ! mv "$temp_file" "$env_file"; then
    echo "  [ERROR] Could not atomically persist Indonesia secret transports."
    rm -f "$temp_file"
    return 1
  fi
  echo "  [GUARD] Indonesia secret transports synchronized (values masked)."
}

sync_indo_secret_transport() {
  local env_file="$1"
  local data_dir="$2"
  local rotate_callback="$3"
  local old_sa new_sa temp_file rotated=0

  old_sa=$(indo_dotenv_value "$env_file" INDO_SQL_SA_PASSWORD_B64)
  new_sa="$INDO_SQL_SA_PASSWORD_B64"
  [[ "$old_sa" != "$new_sa" ]] || return 0
  temp_file=$(indo_prepare_sa_env "$env_file")

  if [[ "$old_sa" != "$new_sa" ]] && indo_sql_data_exists "$data_dir"; then
    if [[ -z "$old_sa" ]]; then
      echo "  [ERROR] Existing Indonesia SQL data has no persisted SA transport; refusing unsafe rotation."
      rm -f "$temp_file"
      return 1
    fi
    if ! "$rotate_callback" "$old_sa" "$new_sa"; then
      echo "  [ERROR] SA rotation failed; persisted Indonesia secrets were not changed."
      rm -f "$temp_file"
      return 1
    fi
    rotated=1
  fi

  if ! mv "$temp_file" "$env_file"; then
    echo "  [ERROR] Could not atomically persist the rotated Indonesia SA transport."
    rm -f "$temp_file"
    if [[ "$rotated" -eq 1 ]]; then
      echo "  [GUARD] Attempting SA rollback because dotenv persistence failed."
      "$rotate_callback" "$new_sa" "$old_sa" || echo "  [ERROR] SA rollback failed; manual recovery is required."
    fi
    return 1
  fi
  echo "  [GUARD] Indonesia SA transport synchronized (value masked)."
}

deploy_non_indonesia_affected_services() {
  local svc
  for svc in "${AFFECTED_SERVICES[@]}"; do
    [[ "$svc" == "indo-shipping" ]] && continue
    echo "  [INCR] Rebuilding $svc (--no-deps)..."
    ensure_service_base_images "$svc"
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --build --no-deps "$svc"
  done
}

if [[ "${INDO_DEPLOY_LIBRARY_ONLY:-0}" == "1" ]]; then
  return 0 2>/dev/null || exit 0
fi

# ─── RR Portal Cloud Update Script — Diff-based incremental deploy ───
#
# 策略：根据本次 push 变动的文件路径，只 rebuild 影响到的服务。
# 对比老版本（全量 docker compose up --build）的优势：
#   - 改 paiji 不会把其他 16 个服务也 recreate / IP 重洗
#   - 改 nginx.conf 只 hot reload，零停机（而非 restart nginx）
#   - 改非部署文件（docs/scripts/markdown）跳过 deploy
#   - fallback：docker-compose.cloud.yml 变动时仍走全量（印尼首发路径除外）
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
MIN_INDO_AVAILABLE_MEMORY_MB=2500
MIN_INDO_FREE_DISK_MB=10240

cd "$INSTALL_DIR"

# ─── State tracking (supports resume) ───
save_state() { echo "$1" > "$STATE_FILE"; }
cleanup_state() { rm -f "$STATE_FILE"; }
check_resume() {
  if [[ -f "$STATE_FILE" ]]; then
    echo "[RESUME] Previous deploy interrupted at: $(cat $STATE_FILE). Re-running from start."
  fi
}

require_indo_shipping_resources() {
  local available_memory_mb free_disk_mb
  available_memory_mb=$(awk '/^MemAvailable:/ { print int($2 / 1024); exit }' /proc/meminfo)
  free_disk_mb=$(df -Pm "$INSTALL_DIR" | awk 'NR == 2 { print $4 }')

  if [[ ! "$available_memory_mb" =~ ^[0-9]+$ ]] || [[ ! "$free_disk_mb" =~ ^[0-9]+$ ]]; then
    echo "  [ERROR] Unable to determine available memory or free disk for Indonesia shipping preflight."
    return 1
  fi

  echo "  [PREFLIGHT] Available memory: ${available_memory_mb} MB (required: ${MIN_INDO_AVAILABLE_MEMORY_MB} MB)"
  echo "  [PREFLIGHT] Free disk: ${free_disk_mb} MB (required: ${MIN_INDO_FREE_DISK_MB} MB)"
  if (( available_memory_mb < MIN_INDO_AVAILABLE_MEMORY_MB )); then
    echo "  [ERROR] Indonesia shipping deploy aborted: insufficient available memory."
    return 1
  fi
  if (( free_disk_mb < MIN_INDO_FREE_DISK_MB )); then
    echo "  [ERROR] Indonesia shipping deploy aborted: insufficient free disk."
    return 1
  fi
}

wait_for_healthy() {
  local service="$1"
  local timeout_seconds="$2"
  local deadline=$((SECONDS + timeout_seconds))
  local container_id health_status

  while (( SECONDS < deadline )); do
    container_id=$(docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps -q "$service" 2>/dev/null || true)
    if [[ -n "$container_id" ]]; then
      health_status=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$container_id" 2>/dev/null || true)
      if [[ "$health_status" == "healthy" ]]; then
        echo "  [OK] $service is healthy."
        return 0
      fi
    fi
    sleep 3
  done

  echo "  [ERROR] $service did not become healthy within ${timeout_seconds}s."
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps "$service" || true
  return 1
}

rotate_indo_sa_password() {
  local old_sa_password_b64="$1"
  local new_sa_password_b64="$2"

  echo "  [GUARD] Starting only Indonesia SQL Server with the persisted SA credential for rotation."
  INDO_SQL_SA_PASSWORD_B64="$old_sa_password_b64" \
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --no-deps indo-sqlserver
  INDO_SQL_SA_PASSWORD_B64="$old_sa_password_b64" wait_for_healthy indo-sqlserver 180

  echo "  [GUARD] Rotating and verifying the Indonesia SQL SA login (values masked)."
  INDO_SQL_OLD_SA_PASSWORD_B64="$old_sa_password_b64" \
  INDO_SQL_SA_PASSWORD_B64="$new_sa_password_b64" \
  INDO_SQL_ROTATE_SA=1 \
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" run --rm --build --no-deps \
      -e INDO_SQL_ROTATE_SA \
      -e INDO_SQL_OLD_SA_PASSWORD_B64 \
      -e INDO_SQL_SA_PASSWORD_B64 \
      indo-shipping-init
}
trap cleanup_state EXIT

echo "=== RR Portal Update (diff-based) ==="
check_resume

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

NO_CODE_CHANGES=0
if [[ "$BEFORE_HEAD" == "$AFTER_HEAD" ]]; then
  NO_CODE_CHANGES=1
  echo "  No new commits; checking synchronized Indonesia secrets before deciding to skip."
fi

# Bash holds the old file inode after git pull replaces deploy/update-server.sh.
# If the script itself changed, re-exec from the new inode so PATH_TO_SERVICE etc.
# reflect the updated code. Guard with REEXECED=1 to prevent an infinite loop.
if [[ "$NO_CODE_CHANGES" -eq 0 ]] && [[ "${REEXECED:-0}" != "1" ]]; then
  if git diff --name-only "$BEFORE_HEAD" "$AFTER_HEAD" | grep -q '^deploy/update-server\.sh$'; then
    echo "  [INFO] deploy script updated — re-executing from new inode..."
    exec env REEXECED=1 BEFORE_COMMIT="$BEFORE_HEAD" bash "$0" "$@"
  fi
fi

# core.quotePath=false 让中文/非 ASCII 路径不被 \xxx 转义，否则 PATH_TO_SERVICE 前缀匹配会 fail
if [[ "$NO_CODE_CHANGES" -eq 1 ]]; then
  CHANGED_FILES=""
else
  CHANGED_FILES=$(git -c core.quotePath=false diff --name-only "$BEFORE_HEAD" "$AFTER_HEAD")
fi
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
  ["apps/生产部/生产计划管理系统/"]="production-plan"
  ["apps/生产部/喷油部生产管理系统/"]="penyou"
  ["apps/生产部/啤机外发系统/"]="pi-outsource"
  ["apps/生产部/品质管理系统/"]="qc"
  ["apps/PMC跟仓管/配色库存管理/"]="peise"
  ["apps/PMC跟仓管/华登包材管理/"]="huadeng"
  ["apps/PMC跟仓管/华登毛绒仓库/"]="huadeng-maorong"
  ["apps/PMC跟仓管/采购订单管理系统/"]="jiangping"
  ["apps/PMC跟仓管/成品核对系统/"]="liwenjuan"
  ["apps/PMC跟仓管/加工管理/"]="cpg"
  ["apps/PMC跟仓管/加工厂月度评审管理制度/"]="factory-review"
  ["apps/业务部/报价系统/"]="baojia"
  ["apps/业务部/TOMY排期核对系统/"]="tomy-paiqi"
  ["apps/业务部/ZURU接单表入单系统/"]="zuru-order-system"
  ["apps/业务部/ZURU总排期入单/"]="zuru-master-schedule"
  ["apps/业务部/ZURU河源排期入单/"]="hy-schedule-system"
  ["apps/业务部/内部报价系统/"]="internal-quote"
  ["apps/工程部/A-doc生成系統/"]="zouhuo"
  ["apps/工程部/工程啤办单/"]="rr-production"
  ["apps/工程部/模具手办采购订单系统/"]="figure-mold-cost-system"
  ["apps/船务部/船务管理系统/"]="shipping-management"
  ["apps/喷油部/喷油排期系统/"]="sprayplan"
  ["apps/印尼小组/印尼走货明细/"]="indo-shipping"
  ["apps/QA部/QA测试报告周结系统/"]="qa-weekly-report"
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

INDO_COMPOSE_CHANGED=0
if [[ "$COMPOSE_CHANGED" -eq 1 ]] && \
   indo_compose_services_changed_at_ref "$BEFORE_HEAD" "$COMPOSE_FILE" "$COMPOSE_FILE"; then
  INDO_COMPOSE_CHANGED=1
  NONRUNTIME_ONLY=0
  echo "  [TARGETED] Indonesia Compose service block changed."
fi

INDO_NON_TARGET_COMPOSE_CHANGED=0
if [[ "$COMPOSE_CHANGED" -eq 1 ]] && \
   indo_compose_non_target_services_changed_at_ref "$BEFORE_HEAD" "$COMPOSE_FILE" "$COMPOSE_FILE"; then
  INDO_NON_TARGET_COMPOSE_CHANGED=1
fi

# 强制全量（环境变量覆盖）
if [[ "${FORCE_FULL_REBUILD:-0}" == "1" ]]; then
  COMPOSE_CHANGED=1
  echo "  [FORCED] FORCE_FULL_REBUILD=1，走全量"
fi

INDO_SHIPPING_AFFECTED=0
load_indo_secret_transport "$ENV_FILE"
INDO_SECRET_CHANGED=0
if indo_secret_transport_changed "$ENV_FILE"; then
  INDO_SECRET_CHANGED=1
  NONRUNTIME_ONLY=0
  echo "  [TARGETED] Indonesia secret transport changed (values masked)."
fi

if [[ " ${AFFECTED_SERVICES[*]} " =~ " indo-shipping " ]] || \
   [[ "$INDO_COMPOSE_CHANGED" -eq 1 ]] || \
   [[ "$INDO_SECRET_CHANGED" -eq 1 ]]; then
  INDO_SHIPPING_AFFECTED=1
  if [[ ! " ${AFFECTED_SERVICES[*]} " =~ " indo-shipping " ]]; then
    AFFECTED_SERVICES+=("indo-shipping")
  fi
fi

if [[ "$INDO_SHIPPING_AFFECTED" -eq 1 ]] && [[ "$INDO_NON_TARGET_COMPOSE_CHANGED" -eq 1 ]]; then
  echo "  [ERROR] Indonesia and non-Indonesia service definitions changed together; refusing a mixed Compose deployment."
  echo "  [ERROR] Split the Compose changes into separate deployments so neither path can be skipped."
  exit 1
fi

if [[ -n "${DEPLOY_RESULT_FILE:-}" ]]; then
  printf 'TARGETED_INDONESIA=%s\n' "$INDO_SHIPPING_AFFECTED" > "$DEPLOY_RESULT_FILE"
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

# Indonesia shipping first deploy must fail before touching any container when
# the host cannot safely fit SQL Server. Global cleanup and unrelated guards are
# intentionally skipped for this targeted path.
if [[ "$INDO_SHIPPING_AFFECTED" -eq 1 ]]; then
  require_indo_seed_file data/indo-shipping-seed/business-data.json
  require_indo_shipping_resources
  mkdir -p data/indo-sqlserver backups/indo-sqlserver
  chown 10001:0 data/indo-sqlserver backups/indo-sqlserver
  chmod 770 data/indo-sqlserver backups/indo-sqlserver
  sync_indo_secret_transport "$ENV_FILE" data/indo-sqlserver rotate_indo_sa_password
  echo "[1/6] Targeted Indonesia deploy: skipping global container cleanup and unrelated service guards."
else
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

  # ─── internal-quote SESSION_SECRET 守卫（2026-06-17）───
  # internal-quote 生产环境强制要求 SESSION_SECRET，缺失即拒绝启动(crash-loop 502)。
  # 服务器 .env.cloud.production 若没有该值，自动生成一个持久随机值并 force-recreate 注入。
  if ! grep -qE '^INTERNAL_QUOTE_SESSION_SECRET=.+' "$ENV_FILE" 2>/dev/null; then
    sed -i '/^INTERNAL_QUOTE_SESSION_SECRET=/d' "$ENV_FILE" 2>/dev/null || true
    echo "INTERNAL_QUOTE_SESSION_SECRET=$(openssl rand -hex 32)" >> "$ENV_FILE"
    echo "[GUARD] INTERNAL_QUOTE_SESSION_SECRET 缺失 → 已生成持久随机值并写入"
  else
    echo "[GUARD] INTERNAL_QUOTE_SESSION_SECRET 已存在"
  fi
  if ! docker ps --format '{{.Names}}' | grep -q '^rr-portal-internal-quote-1$'; then
    echo "[GUARD] internal-quote 未在运行 → up -d --force-recreate 拉起（注入 SESSION_SECRET）"
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --no-deps --force-recreate internal-quote || true
  fi
fi

# ─── Step 4: 确保 data 目录存在 + 权限 ───
# Host 端 bind-mount 目录会覆盖镜像内的 chown。多数 app 用 non-root 用户（uid 100），
# 如果 host dir 是 git 创建的 root:root 755，容器内 appuser 写不进去 → SQLite 崩、上传崩。
# 沿用 paiji 一贯的 777 惯例。idempotent — 已是 777 就不再 chmod。
# 见 CLAUDE.md Learnings (PR #63 / #100 都因为这个崩过)。
save_state "directories"
echo "[4/6] Ensuring data/uploads directories + perms..."
if [[ "$INDO_SHIPPING_AFFECTED" -eq 1 ]]; then
  echo "  [TARGETED] Generic app permission sweep skipped; SQL directories are prepared immediately before SQL starts."
else
  python3 -c "
import re, os, stat, sys
with open('${COMPOSE_FILE}') as f:
    content = f.read()
for match in re.findall(r'^\s*-\s+\./([^:]+):', content, re.MULTILINE):
    path = match.strip()
    if not any(seg in path for seg in ['data', 'uploads', 'instance']):
        continue
    os.makedirs(path, exist_ok=True)
    # 只 chmod apps/ 下的 bind-mount。data/postgres 等基础设施 dir 跳过：
    # postgres 启动要求 data dir 是 700/750，给 777 会被拒绝。
    if not path.startswith('apps/'):
        continue
    try:
        cur = stat.S_IMODE(os.stat(path).st_mode)
        if cur != 0o777:
            os.chmod(path, 0o777)
            print(f'  [chmod 777] {path} (was {oct(cur)})')
    except OSError as e:
        print(f'  [WARN] chmod {path}: {e}', file=sys.stderr)
    # 文件级权限：data 目录下的所有文件，确保容器内 appuser (UID 100) 能读写
    # 之前 huadeng-maorong 初始 db 是 git 跟踪/CI root 拉的，appuser 启动时 CREATE TABLE 直接崩。
    # 用 OR 加权，不降级。pgsql 等基础设施不在 apps/ 下不会被走到。
    for root_dir, dirs, files in os.walk(path):
        for f in files:
            fp = os.path.join(root_dir, f)
            try:
                fst = os.stat(fp)
                fmode = stat.S_IMODE(fst.st_mode)
                want = fmode | 0o666
                if fmode != want:
                    os.chmod(fp, want)
                    print(f'  [chmod {oct(want)}] {fp} (was {oct(fmode)})')
            except OSError as e:
                print(f'  [WARN] chmod file {fp}: {e}', file=sys.stderr)
" || true
fi

# ─── Step 5: 备份数据库（只在影响 db 或全量时）───
if [[ "$INDO_SHIPPING_AFFECTED" -eq 1 ]]; then
  echo "[5/6] Targeted Indonesia deploy: skipping unrelated database backups."
elif [[ "$COMPOSE_CHANGED" -eq 1 ]] || [[ " ${AFFECTED_SERVICES[*]} " =~ " core " ]] || [[ "$DB_INIT_CHANGED" -eq 1 ]]; then
  save_state "backup"
  echo "[5/6] Backing up databases (core/db 会被动到)..."
  mkdir -p "$BACKUP_DIR"
  BACKUP_TS="$(date +%Y%m%d-%H%M%S)"
  if docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps db 2>/dev/null | grep -q "running"; then
    PG_BACKUP="${BACKUP_DIR}/postgres-${BACKUP_TS}.sql.gz"
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T db \
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

# ─── base image mirror guard（2026-07-21）───
# 背景: 服务器 /etc/docker/daemon.json 的 registry-mirror 指向 mirror.ccs.tencentyun.com
#       （腾讯云内网镜像），这台阿里云 ECS 上 DNS 解析失败（no such host）。base image
#       layer 不在本地缓存时，BuildKit 拉 python:3.12-slim 等基础镜像直接 "no such host"
#       → 构建失败（见 PR #295 部署两次同一错误）。
# 修复: 构建前把缺失的 Docker Hub 官方 base image 从可用的公共镜像站显式拉下来，tag 成短名。
#       BuildKit 的 FROM 就能从本地 image store 解析，不再碰坏掉的 daemon mirror。
# 特性: 幂等（本地已有就跳过）+ best-effort（镜像站全失败也只是回到原来的构建，绝不更糟）。
#       不改 daemon.json、不 restart docker，零停机、零副作用。
# 根治: 应在主机侧把 daemon.json 的 registry-mirror 换成可用的阿里云加速器；本守卫是兜底。
BASE_IMAGE_MIRRORS=(docker.m.daocloud.io docker.1ms.run docker.1panel.live dockerpull.org)

ensure_base_image() {
  local img="$1"   # 例: python:3.12-slim
  if docker image inspect "$img" >/dev/null 2>&1; then
    return 0
  fi
  echo "  [MIRROR-GUARD] base image 本地缺失: $img，尝试从公共镜像站拉取..."
  local mirror
  for mirror in "${BASE_IMAGE_MIRRORS[@]}"; do
    if docker pull "$mirror/library/$img" >/dev/null 2>&1; then
      docker tag "$mirror/library/$img" "$img"
      echo "  [MIRROR-GUARD] ✓ 已从 $mirror 拉取并 tag 为 $img"
      return 0
    fi
    echo "  [MIRROR-GUARD] ✗ $mirror 不可用，尝试下一个"
  done
  echo "  [MIRROR-GUARD][WARN] 所有公共镜像站均失败: $img（交回正常构建，可能仍失败）"
  return 0
}

# 给定 service 名，读取其 Dockerfile 的 FROM，确保用到的 Docker Hub 官方 base image 都在本地。
# 只处理不含 registry/namespace 的 library 镜像（如 python:3.12-slim / node:20-alpine），
# 自动跳过 mcr.microsoft.com/... 等非 Hub 镜像和多阶段 FROM <stage> 引用（无 tag 冒号）。
ensure_service_base_images() {
  local target_svc="$1"
  local prefix dockerfile img
  for prefix in "${!PATH_TO_SERVICE[@]}"; do
    [[ "${PATH_TO_SERVICE[$prefix]}" == "$target_svc" ]] || continue
    dockerfile="${prefix}Dockerfile"
    [[ -f "$dockerfile" ]] || return 0
    while read -r img; do
      [[ -n "$img" ]] && ensure_base_image "$img"
    done < <(grep -iE '^FROM ' "$dockerfile" | awk '{print $2}' \
             | grep -E ':' | grep -vE '/' | sort -u)
    return 0
  done
}

# ─── Step 6: 执行部署 ───
save_state "deploy"
echo "[6/6] Deploying..."

if [[ "$INDO_SHIPPING_AFFECTED" -eq 1 ]]; then
  echo "  [TARGETED] Deploying Indonesia SQL Server, bootstrap, and application only."
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --no-deps indo-sqlserver
  wait_for_healthy indo-sqlserver 180
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" run --rm --no-deps indo-shipping-init
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --build --no-deps indo-shipping
  persist_indo_secret_transport "$ENV_FILE"
  deploy_non_indonesia_affected_services
elif [[ "$COMPOSE_CHANGED" -eq 1 ]]; then
  # Compose 变动：可能只是 context path 改了（代码没变），也可能加新服务
  # 策略：先 up -d（无 --build），让 docker 用现有 image 只 recreate 容器
  # 这样纯 rename 几乎零成本；如果有新服务或 Dockerfile 变了再用 AFFECTED_SERVICES 做增量 build
  echo "  [COMPOSE] Compose 变动，recreate 容器（不强制 rebuild，避免 OOM 风险）"
  # --remove-orphans: 删除已从 compose 移除的服务遗留的孤儿容器，
  # 否则被下线/重命名的服务容器会继续运行（crash-loop 时甚至拖垮内存导致全站 OOM）
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --remove-orphans
  # 还要 rebuild 那些真的动了源码的服务（incremental）
  for svc in "${AFFECTED_SERVICES[@]}"; do
    echo "  [INCR] Rebuilding $svc (--no-deps)..."
    ensure_service_base_images "$svc"
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --build --no-deps "$svc"
  done
  # 容器 IP 全变，但 nginx 用动态 resolver 10 秒自动感知
elif [[ "${#AFFECTED_SERVICES[@]}" -gt 0 ]]; then
  # 增量：只 rebuild 影响的服务，带 --no-deps 不触发依赖链
  for svc in "${AFFECTED_SERVICES[@]}"; do
    echo "  [INCR] Rebuilding $svc (--no-deps)..."
    ensure_service_base_images "$svc"
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --build --no-deps "$svc"
  done
  # 容器 recreate 后 Docker bridge IP 会变，但因为 nginx 现在用动态 resolver
  # （resolver 127.0.0.11 valid=10s），10 秒内就重新解析了。不需要 restart nginx。
  echo "  [INFO] nginx 用动态 resolver，无需 restart（10 秒内自动感知新 IP）"
fi

# nginx 配置/前端文件变动 → recreate 容器（文件级 bind mount inode 必换）+ reload
# nginx.cloud.conf / frontend/*.html / logo.png 都是文件级 bind mount，绑定的是 inode。
# git pull 会删旧文件新建（新 inode），容器内 mount 仍指向旧 inode，
# nginx -s reload 读的是旧内容 → 必须 recreate 容器刷新 mount 再 reload。
if [[ "$NGINX_CHANGED" -eq 1 ]] || [[ "$FRONTEND_CHANGED" -eq 1 ]]; then
  echo "  [NGINX] config/frontend 文件变动，recreate 容器以刷新 bind mount inode（约 3s 停机）"
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --force-recreate --no-deps nginx

  echo "  [NGINX] hot reload（零停机）"
  _NGINX_TEST=$(docker exec rr-portal-nginx-1 nginx -t 2>&1 || true)
  if echo "$_NGINX_TEST" | grep -q "syntax is ok"; then
    docker exec rr-portal-nginx-1 nginx -s reload
    echo "  [OK] nginx reloaded"
  else
    echo "  [ERROR] nginx -t 失败，拒绝 reload（保持旧配置运行）"
    echo "$_NGINX_TEST"
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
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps --format "table {{.Name}}\t{{.Status}}" 2>/dev/null || true
