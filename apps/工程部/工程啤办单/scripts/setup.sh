#!/bin/bash
# ============================================================
# setup.sh — 云服务器初始化（只需运行一次）
# 适用系统：Ubuntu 22.04
# 用法：bash setup.sh
# ============================================================

set -e
echo "========================================"
echo " 开始初始化服务器环境..."
echo "========================================"

# 1. 更新系统
echo "[1/6] 更新系统..."
apt update -y && apt upgrade -y

# 2. 安装 Node.js 20
echo "[2/6] 安装 Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# 3. 安装 Git
echo "[3/6] 安装 Git..."
apt install -y git

# 4. 安装 PM2
echo "[4/6] 安装 PM2..."
npm install -g pm2

# 5. 安装 Nginx
echo "[5/6] 安装 Nginx..."
apt install -y nginx

# 6. 配置防火墙
echo "[6/6] 配置防火墙..."
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw allow 3000
ufw --force enable

echo ""
echo "========================================"
echo " 环境初始化完成！"
echo " Node 版本: $(node -v)"
echo " NPM  版本: $(npm -v)"
echo " PM2  版本: $(pm2 -v)"
echo " 下一步：运行 bash deploy.sh"
echo "========================================"
