# 云端部署（国内 VPS，2核4G）

> 本地开发端口用 8091（避开贴纸机系统的 8090）；生产服务器独占，PocketBase 用 8090，
> 前端用相对路径 `/` 访问 API（见 src/pb.ts），由 Nginx 反代，无需改前端配置。

## 1. 准备
- VPS（阿里云/腾讯云），Ubuntu 22.04，开放 80/443
- 域名解析到 VPS 公网 IP

## 2. 上传文件到 /opt/factory-review/
- `pocketbase`（**linux_amd64** 版本，从 GitHub releases 下载，不是本地的 darwin 版）
- `pb_migrations/`、`pb_hooks/`
- `dist/`（本地 `npm run build` 产物）
- `deploy/backup.sh`

## 3. PocketBase 作为 systemd 服务
创建 `/etc/systemd/system/factory-review.service`：
```ini
[Unit]
Description=Factory Review PocketBase
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/factory-review
ExecStart=/opt/factory-review/pocketbase serve --http=127.0.0.1:8090 --dir=pb_data --migrationsDir=pb_migrations
Restart=always

[Install]
WantedBy=multi-user.target
```
启用并启动（首次 serve 会自动应用 pb_migrations 里的 JS 迁移）：
```bash
systemctl enable --now factory-review
journalctl -u factory-review -f   # 看启动日志，确认无 migration/hook 报错
```

## 4. Nginx + HTTPS
```bash
cp deploy/nginx.conf /etc/nginx/sites-available/factory-review
ln -s /etc/nginx/sites-available/factory-review /etc/nginx/sites-enabled/
# 编辑 server_name 为实际域名
certbot --nginx -d your-domain.com    # 申请证书并自动续签
nginx -t && systemctl reload nginx
```

## 5. 首次初始化
- 访问 `https://your-domain.com/_/` 创建超级管理员
- 用 `/admin/users` 创建各岗位账号（采购按工艺设 craft）

## 6. 备份（每日凌晨2点）
```bash
chmod +x /opt/factory-review/deploy/backup.sh
crontab -e
# 加一行：
0 2 * * * /opt/factory-review/deploy/backup.sh >> /var/log/factory-review-backup.log 2>&1
```

## 7. 更新发布
- 前端改动：本地 `npm run build` → 上传 `dist/` 覆盖
- 迁移/钩子改动：上传 `pb_migrations/` `pb_hooks/` → `systemctl restart factory-review`
