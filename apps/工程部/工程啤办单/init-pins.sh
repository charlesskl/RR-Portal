#!/bin/bash
# ============================================================
# 一次性 PIN 初始化脚本
# 用法: 在云服务器上执行
#   chmod +x init-pins.sh && ./init-pins.sh
#
# 说明:
#   - 通过 Docker 内部网络直接调用 API（不经过 nginx/外网）
#   - 为每位主管和经理生成随机 4 位数字 PIN
#   - 结果输出到屏幕，请记录后安全分发给各主管
#   - 运行完毕后请删除此脚本: rm init-pins.sh
# ============================================================

set -euo pipefail

API_BASE="http://127.0.0.1:3000/api/change-pin"
CONTAINER="rr-production"

# 主管列表
SUPERVISORS=("段新辉" "唐海林" "蒙海欢" "万志勇" "章发东" "刘际维" "甘勇辉" "王玉国")

# 经理列表
MANAGERS=("易东存")

echo "========================================="
echo "  工程啤办单 - PIN 码初始化"
echo "========================================="
echo ""

# 生成随机 4 位 PIN
gen_pin() {
  printf "%04d" $((RANDOM % 10000))
}

echo "--- 主管 PIN ---"
for name in "${SUPERVISORS[@]}"; do
  pin=$(gen_pin)
  result=$(docker compose exec -T "$CONTAINER" \
    wget -qO- --post-data="{\"name\":\"$name\",\"new_pin\":\"$pin\",\"role\":\"supervisor\"}" \
    --header="Content-Type: application/json" \
    "$API_BASE" 2>&1) || result="FAILED"
  if echo "$result" | grep -q '"success":true'; then
    printf "  %-10s  PIN: %s\n" "$name" "$pin"
  else
    printf "  %-10s  FAILED: %s\n" "$name" "$result"
  fi
done

echo ""
echo "--- 经理 PIN ---"
for name in "${MANAGERS[@]}"; do
  pin=$(gen_pin)
  result=$(docker compose exec -T "$CONTAINER" \
    wget -qO- --post-data="{\"name\":\"$name\",\"new_pin\":\"$pin\",\"role\":\"manager\"}" \
    --header="Content-Type: application/json" \
    "$API_BASE" 2>&1) || result="FAILED"
  if echo "$result" | grep -q '"success":true'; then
    printf "  %-10s  PIN: %s\n" "$name" "$pin"
  else
    printf "  %-10s  FAILED: %s\n" "$name" "$result"
  fi
done

echo ""
echo "========================================="
echo "  请截图或记录以上 PIN 码，安全分发给各主管/经理"
echo "  然后删除此脚本: rm init-pins.sh"
echo "========================================="
