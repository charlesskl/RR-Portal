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
  mkdir -p "$MAINT_FLAG_DIR/services"
  touch "$MAINT_FLAG_DIR/services/$key"
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
  rm -f "$MAINT_FLAG_DIR/services/$key"
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

# 构建镜像时旧容器继续服务。标志仅在单个系统切换容器前创建，
# 该服务健康后立即撤除；失败也只影响该系统，不留下全站维护开关。
deploy_service() {
  local svc="$1" rebuild="${2:-0}" switched_at grace
  if [[ "$rebuild" -eq 1 ]]; then
    ensure_service_base_images "$svc" || return
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" build "$svc" || return
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
