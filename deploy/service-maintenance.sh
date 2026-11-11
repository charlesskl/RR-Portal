#!/usr/bin/env bash
# Sourced by update-server.sh. Flags belong to a single application route group.
# MAINT_FLAG_DIR, COMPOSE_FILE and ENV_FILE are supplied by the caller.

maintenance_key() {
  case "$1" in
    nginx|db|redis|autoheal|task-api) return 0 ;;
    voyageplex-web|voyageplex-api|voyageplex-parser) echo voyageplex ;;
    qc-plan-web|qc-plan-api) echo qc-plan ;;
    qc-report-worker) echo qc-report ;;
    erp-sqlserver|erp-db-init|erp-api) echo erp ;;
    *) printf '%s\n' "$1" ;;
  esac
}

maintenance_on() {
  local key
  key=$(maintenance_key "$1")
  [[ -n "$key" ]] || return 0
  mkdir -p "$MAINT_FLAG_DIR/services" || return
  touch "$MAINT_FLAG_DIR/services/$key" || return
  echo "  [MAINT] $key 维护开启，门户与其他系统继续服务"
}

service_is_ready() {
  local cid state
  cid=$(docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps -a -q "$1" | head -1)
  [[ -n "$cid" ]] || return 1
  state=$(docker inspect -f '{{.State.Status}}/{{.State.ExitCode}}/{{.HostConfig.RestartPolicy.Name}}/{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid") || return 1
  case "$state" in
    running/*/*/healthy|running/*/*/none|exited/0/no/*) return 0 ;;
    *) return 1 ;;
  esac
}

wait_service_ready() {
  local svc="$1" deadline
  deadline=$((SECONDS + ${MAINT_HEALTH_TIMEOUT_SECONDS:-300}))
  while (( SECONDS < deadline )); do
    if service_is_ready "$svc"; then
      echo "  [OK] $svc ready"
      return 0
    fi
    sleep 5
  done
  echo "  [ERROR] $svc 未在 ${MAINT_HEALTH_TIMEOUT_SECONDS:-300}s 内就绪；仅该系统保留维护提示"
  return 1
}

qc_gateway_url() {
  local binding port
  binding=$(docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" port nginx 80 2>/dev/null) || return 1
  port="${binding##*:}"
  [[ "$port" =~ ^[0-9]+$ ]] || return 1
  printf 'http://127.0.0.1:%s' "$port"
}

qc_gateway_ready() {
  local url response
  url=$(qc_gateway_url) || return 1
  response=$(curl --noproxy '*' --max-time 5 -sS -w '\n%{http_code}' "$url/qc/api/health" 2>/dev/null) || return 1
  [[ "${response##*$'\n'}" == 200 ]] || return 1
  printf '%s' "${response%$'\n'*}" | python3 -c 'import json, sys; sys.exit(json.load(sys.stdin).get("ok") is not True)' 2>/dev/null
}

qc_maintenance_on() {
  local url response='' nginx_id flag="$MAINT_FLAG_DIR/services/qc" already_enabled=0
  if [[ -f "$flag" ]]; then already_enabled=1; fi
  maintenance_on qc || return
  if url=$(qc_gateway_url); then
    response=$(curl --noproxy '*' --max-time 5 -sS -D - -o /dev/null -w '\n%{http_code}' "$url/qc/" 2>/dev/null) || response=''
  fi
  if [[ "${response##*$'\n'}" == 503 ]] && printf '%s\n' "$response" | grep -iqE '^Retry-After:[[:blank:]]*60[[:space:]]*$'; then
    if [[ "${MAINT_QC_DEFER_RELEASE:-0}" == 1 ]] || ! service_is_ready qc || qc_gateway_ready; then
      return 0
    fi
    echo '  [ERROR] 品质健康探测未穿过现有维护保护，请先更新网关配置' >&2
  elif [[ "${MAINT_QC_GATEWAY_BOOTSTRAP:-0}" == 1 ]] &&
      nginx_id=$(docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps --status running -q nginx) && [[ -z "$nginx_id" ]]; then
    echo '  [MAINT] 网关尚未启动，启动后验证品质网关再放行'
    MAINT_QC_DEFER_RELEASE=1
    return 0
  else
    echo '  [ERROR] 网关未进入品质维护状态，已停止容器切换' >&2
  fi
  if [[ "$already_enabled" -eq 0 ]]; then rm -f "$flag"; fi
  return 1
}

maintenance_off() {
  local key svc
  key=$(maintenance_key "$1")
  [[ -n "$key" ]] || return 0
  # 多容器系统共用一个标志，只有整个系统就绪才撤除；不掩盖此前失败的兄弟服务。
  while IFS= read -r svc; do
    [[ -n "$svc" ]] || continue
    [[ "$(maintenance_key "$svc")" == "$key" ]] || continue
    if ! service_is_ready "$svc"; then
      echo "  [MAINT] $key 的 $svc 尚未就绪，保留该系统的维护提示"
      return 0
    fi
  done <<< "$MAINT_COMPOSE_SERVICES"
  if [[ "$key" == qc ]] && ! qc_gateway_ready; then
    echo '  [MAINT] 品质网关尚未就绪，保留维护提示'
    return 0
  fi
  rm -f "$MAINT_FLAG_DIR/services/$key" || return
  echo "  [MAINT] $key 维护关闭"
}

recover_maintenance_flags() {
  local svc key
  while IFS= read -r svc; do
    [[ -n "$svc" ]] || continue
    key=$(maintenance_key "$svc")
    [[ -n "$key" ]] || continue
    [[ -f "$MAINT_FLAG_DIR/services/$key" ]] || continue
    maintenance_off "$svc"
  done <<< "$MAINT_COMPOSE_SERVICES"
}

require_maintenance_cleared() {
  local key
  key=$(maintenance_key "$1")
  [[ -n "$key" ]] || return 0
  if [[ -f "$MAINT_FLAG_DIR/services/$key" ]]; then
    echo "  [ERROR] $key 仍有未就绪服务，保留单系统维护提示；部署未完成"
    return 1
  fi
}

finish_qc_rollout() {
  local deadline=$((SECONDS + ${MAINT_HEALTH_TIMEOUT_SECONDS:-300}))
  while (( SECONDS < deadline )); do
    maintenance_off qc || return
    if [[ ! -f "$MAINT_FLAG_DIR/services/qc" ]]; then return 0; fi
    sleep 2
  done
  echo '  [ERROR] 品质服务未通过网关健康检查，保留品质维护提示' >&2
  return 1
}

deploy_qc_service() {
  local action="$1" switched_at grace
  if [[ "$action" != restart && "$action" != up ]]; then return 2; fi
  qc_maintenance_on || return
  if [[ "$action" == restart ]]; then
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" restart qc || return
  else
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --no-build --no-deps qc || return
  fi
  # 旧容器完全切走后再计 DNS 缓存窗口，防止切换过程仍缓存旧地址。
  switched_at=$SECONDS
  wait_service_ready qc || return
  grace=$((switched_at + ${MAINT_DNS_GRACE_SECONDS:-10} - SECONDS))
  if (( grace > 0 )); then sleep "$grace"; fi
  if [[ "${MAINT_QC_DEFER_RELEASE:-0}" == 1 ]]; then
    MAINT_QC_RELEASE_PENDING=1
    return 0
  fi
  finish_qc_rollout
}

# 构建镜像时旧容器继续服务。标志仅在单个系统切换容器前创建，
# 该服务健康后立即撤除；失败也只影响该系统，不留下全站维护开关。
deploy_service() {
  local svc="$1" rebuild="${2:-0}" switched_at grace
  if [[ "$rebuild" -eq 1 ]]; then
    ensure_service_base_images "$svc" || return
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" build "$svc" || return
  fi
  if [[ "$svc" == qc ]]; then
    deploy_qc_service up
    return
  fi
  maintenance_on "$svc" || return
  switched_at=$SECONDS
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --no-build --no-deps "$svc" || return
  wait_service_ready "$svc" || return
  # 动态 resolver 可能仍缓存旧容器 IP；至少覆盖 nginx 的 10s DNS 缓存窗口。
  grace=$((switched_at + ${MAINT_DNS_GRACE_SECONDS:-10} - SECONDS))
  if (( grace > 0 )); then sleep "$grace"; fi
  maintenance_off "$svc"
}
