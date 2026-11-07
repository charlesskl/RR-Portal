#!/usr/bin/env bash
# macOS / Linux: all required checks, with authoritative reports and retained logs.
set -euo pipefail
export PATH="$HOME/erp-tools/node/bin:$HOME/.dotnet:$PATH"
TASK_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [[ "${1:-}" == "--help" ]]; then
  printf '用法：ERP_TEST_DB=... scripts/check-all.sh\n必须连接 erp_test。日志保存到 tmp/check-all；任何失败、跳过或待办均非 0 退出。\n'
  exit 0
fi
if [[ $# -ne 0 ]]; then
  printf '不支持参数；查看 scripts/check-all.sh --help。\n' >&2
  exit 2
fi
for task_tool in python3 dotnet node npm git tee; do
  command -v "$task_tool" >/dev/null || { printf '缺少依赖：%s\n' "$task_tool" >&2; exit 2; }
done
python3 "$TASK_ROOT/scripts/require-test-db.py"
# The cloud checkout tracks wwwroot as a relative link to the Debug output.
# Fresh checkouts have no generated target yet; API integration tests still
# construct a PhysicalFileProvider before any frontend production build.
TASK_WEBROOT="$TASK_ROOT/src/ErpApi/wwwroot"
if [[ -L "$TASK_WEBROOT" ]]; then
  [[ "$(readlink "$TASK_WEBROOT")" == "bin/Debug/net8.0/wwwroot" ]] || {
    printf '测试静态目录链接目标异常，拒绝自动创建。\n' >&2; exit 2;
  }
  mkdir -p "$TASK_ROOT/src/ErpApi/bin/Debug/net8.0/wwwroot"
else
  mkdir -p "$TASK_WEBROOT"
fi
# WebApplicationFactory 等 API 测试也必须使用测试库，不能继承开发库 ERP_DB。
export ERP_DB="$ERP_TEST_DB"
export ERP_JWT_KEY="${ERP_JWT_KEY:-erp-dev-jwt-key-0123456789abcdef}"
export CI=1 NO_COLOR=1 DOTNET_CLI_TELEMETRY_OPTOUT=1
for task_binary in vitest tsc oxlint; do
  [[ -x "$TASK_ROOT/web2/node_modules/.bin/$task_binary" ]] || {
    printf '缺少前端依赖 %s；先在 web2 运行 npm ci。\n' "$task_binary" >&2; exit 2;
  }
done
TASK_LOG_DIR="$TASK_ROOT/tmp/check-all/$(date '+%Y%m%d-%H%M%S')-$$"
mkdir -p "$TASK_LOG_DIR"
TASK_SUMMARY="$TASK_LOG_DIR/summary.md"
printf '# 全量检查\n\n数据库：erp_test\n\n| 检查 | 结果 | 日志 |\n| --- | --- | --- |\n' > "$TASK_SUMMARY"
TASK_STEP="环境检查"
finish() {
  task_exit=$?
  trap - EXIT
  if [[ $task_exit -eq 0 ]]; then
    printf '\n全部必需检查通过。\n' | tee -a "$TASK_SUMMARY"
  else
    printf '\n检查未通过，停止于「%s」，退出码 %s。后续检查未执行。\n' "$TASK_STEP" "$task_exit" | tee -a "$TASK_SUMMARY" >&2
  fi
  printf '完整日志与摘要：%s\n' "$TASK_LOG_DIR"
  exit "$task_exit"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
run_step() {
  local task_name="$1" task_directory="$2" task_command_exit=0 task_report_exit=0
  shift 2
  TASK_STEP="$task_name"
  printf '\n==> %s\n' "$task_name"
  # Every real check runs with a fresh sanitized child environment. Do not pass
  # locally sourced Paiji/SprayPlan/Engineering credentials to integration tests.
  (cd "$task_directory" && python3 "$TASK_ROOT/scripts/run-isolated-check.py" "$@") 2>&1 | tee "$TASK_LOG_DIR/$task_name.log" || task_command_exit=$?
  if [[ "$task_name" == "01-backend-tests" ]]; then
    python3 "$TASK_ROOT/scripts/check-test-results.py" backend "$TASK_LOG_DIR/backend.trx" 2>&1 | tee -a "$TASK_LOG_DIR/$task_name.log" || task_report_exit=$?
  elif [[ "$task_name" == "02-frontend-tests" ]]; then
    python3 "$TASK_ROOT/scripts/check-test-results.py" frontend "$TASK_LOG_DIR/frontend.json" 2>&1 | tee -a "$TASK_LOG_DIR/$task_name.log" || task_report_exit=$?
  fi
  if [[ $task_command_exit -ne 0 || $task_report_exit -ne 0 ]]; then
    printf '| %s | 失败 | [%s.log](%s.log) |\n' "$task_name" "$task_name" "$task_name" >> "$TASK_SUMMARY"
    if [[ $task_command_exit -ne 0 ]]; then exit "$task_command_exit"; else exit "$task_report_exit"; fi
  fi
  printf '| %s | 通过 | [%s.log](%s.log) |\n' "$task_name" "$task_name" "$task_name" >> "$TASK_SUMMARY"
}

run_step 01-backend-tests "$TASK_ROOT" dotnet test tests/ErpApi.Tests --logger 'trx;LogFileName=backend.trx' --results-directory "$TASK_LOG_DIR"
run_step 02-frontend-tests "$TASK_ROOT/web2" ./node_modules/.bin/vitest run --reporter=default --reporter=json --outputFile="$TASK_LOG_DIR/frontend.json"
run_step 03-types "$TASK_ROOT/web2" ./node_modules/.bin/tsc -b
run_step 04-lint "$TASK_ROOT/web2" ./node_modules/.bin/oxlint --deny-warnings
run_step 05-production-build "$TASK_ROOT/web2" npm run build
run_step 06-diff-check "$TASK_ROOT" git diff --check
run_step 07-staged-diff-check "$TASK_ROOT" git diff --cached --check
