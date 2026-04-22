#!/bin/bash
# ============================================================
# deploy.sh — 首次部署生产订单管理系统
# 用法：bash deploy.sh
# ============================================================

set -e

REPO="https://github.com/hufan4308-blip/RR-production-system.git"
APP_DIR="/var/www/production-system"
APP_NAME="production-system"
PORT=3000

echo "========================================"
echo " 开始部署生产订单管理系统..."
echo "========================================"

# 1. 克隆代码
echo "[1/5] 拉取代码..."
if [ -d "$APP_DIR" ]; then
  echo "目录已存在，跳过克隆，直接更新..."
  cd "$APP_DIR" && git pull
else
  git clone "$REPO" "$APP_DIR"
  cd "$APP_DIR"
fi

# 2. 安装依赖
echo "[2/5] 安装依赖..."
cd "$APP_DIR"
npm install --production

# 3. 创建数据目录
echo "[3/5] 初始化数据目录..."
mkdir -p "$APP_DIR/data"

# 如果 data.json 不存在，创建空的初始数据文件
if [ ! -f "$APP_DIR/data/data.json" ]; then
  echo '{"orders":[],"eng_users":[],"clients":[],"material_prices":[]}' > "$APP_DIR/data/data.json"
  echo "已创建空数据文件，请记得上传真实的 data.json！"
fi

# 4. 启动服务
echo "[4/5] 启动服务..."
cd "$APP_DIR"
pm2 delete "$APP_NAME" 2>/dev/null || true
pm2 start server.js --name "$APP_NAME" --log /var/log/pm2-production.log
pm2 save

# 设置开机自启（输出的命令需要手动执行一次）
pm2 startup systemd -u root --hp /root

# 5. 配置 Nginx 反向代理
echo "[5/5] 配置 Nginx..."
cat > /etc/nginx/sites-available/production-system << EOF
server {
    listen 80;
    server_name _;

    # 上传文件大小限制
    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF

# 启用站点
ln -sf /etc/nginx/sites-available/production-system /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo ""
echo "========================================"
echo " 部署完成！"
echo ""
echo " 访问地址：http://$(curl -s ifconfig.me)"
echo ""
echo " ⚠️  重要：请上传 data.json 数据文件！"
echo "    本地执行：scp data/data.json root@服务器IP:${APP_DIR}/data/"
echo ""
echo " 查看日志：pm2 logs ${APP_NAME}"
echo " 重启服务：pm2 restart ${APP_NAME}"
echo "========================================"
