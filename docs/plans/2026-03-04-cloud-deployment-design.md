# RR Portal — Batch A 云部署设计

> 日期: 2026-03-04
> 状态: 已批准

## 目标

将 Batch A（core + nginx + db + redis + rr-production + indonesia-export）部署到阿里云 ECS，使多个工厂可通过公网 IP 访问。

## 服务器选型

- **平台**: 阿里云 ECS
- **地域**: 华南（广州/深圳）
- **配置**: ecs.c6.large — 2 vCPU, 4GB RAM, 40GB SSD
- **操作系统**: Ubuntu 22.04 LTS
- **网络**: 公网 IP，按流量计费
- **预算**: ~¥150-200/月

## 部署流程

```bash
# 1. SSH 登录
ssh root@<公网IP>

# 2. 安装 Docker + Docker Compose
curl -fsSL https://get.docker.com | sh
apt install -y docker-compose-plugin

# 3. 克隆项目
cd /opt
git clone https://github.com/charlesskl/RR-Portal.git rr-portal
cd rr-portal

# 4. 配置环境变量
cp .env.cloud .env.cloud.local
# 编辑 .env.cloud.local，填入所有 REQUIRED 字段

# 5. 启动服务
docker compose -f docker-compose.cloud.yml --env-file .env.cloud.local up -d --build

# 6. 验证
curl http://localhost/nginx-health
```

## 安全加固

1. **SSH**: 禁用密码登录，只用密钥；可选修改端口
2. **安全组**: 只开放 80（HTTP）和 SSH 端口
3. **数据库/Redis**: 不暴露端口（已在 compose 中配置）
4. **强密码**: .env.cloud 中 DB_PASSWORD, REDIS_PASSWORD, JWT_SECRET, ADMIN_PASSWORD
5. **防火墙**: ufw allow 80, ufw allow ssh

## 数据备份

- PostgreSQL: `./data/postgres/`（bind mount）
- rr-production: `./plugins/工程啤办单/data/`
- 建议: crontab 每日备份到阿里云 OSS

## 更新流程

```bash
ssh root@<IP>
cd /opt/rr-portal
git pull
docker compose -f docker-compose.cloud.yml --env-file .env.cloud.local up -d --build
```

## 访问方式

- 工厂浏览器访问: `http://<公网IP>/`
- 暂不配 HTTPS（IP 直连无法申请 SSL）
- 以后加域名时再配置 HTTPS

## 不包含

- Batch B 服务（3D打印、排期系统、Zuru MA）
- 域名和 HTTPS
- 自动 CI/CD
- 数据库自动备份（手动或 crontab）
