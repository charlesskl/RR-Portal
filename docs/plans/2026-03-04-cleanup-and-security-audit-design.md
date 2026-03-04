# RR Portal 代码清理与安全审计设计

**日期**: 2026-03-04
**状态**: 已批准

## 背景

RR Portal 已迁移到阿里云 ECS 云服务器。本地 Windows 设备现在只作为：
- **开发机**：编辑代码、推送到 GitHub
- **3D 打印宿主机**：直接运行 3D 打印 Node.js 服务（连接局域网打印机）

不再需要在本地运行 Docker Compose 完整平台。

## 安全漏洞修复

| # | 严重度 | 问题 | 处理 |
|---|--------|------|------|
| S-1 | 极严重 | `deploy/_run.py` 硬编码旧服务器 root 密码 | 删除文件 |
| S-2 | 严重 | `plugins/3D打印/.env` 含设备凭证未被 gitignore 保护 | 更新 `.gitignore` 为 `**/.env` |
| S-3 | 严重 | `一键更新全部.bat` 含云端公网 IP | 删除文件 |
| S-4 | 高 | `docker-compose.yml` 暴露 DB/Redis 端口 | 删除文件 |
| S-5 | 高 | `docker-compose.yml` 挂载宿主机根目录 | 同 S-4 |
| S-6 | 中 | `core/app/config.py` 硬编码弱默认密码 | 保留（运行时从环境变量覆盖） |

## 删除文件清单

### 根目录
- `docker-compose.yml` — 本地 Docker 编排
- `docker-compose.local.yml` — 本地备用配置
- `启动Portal.bat` — 本地一键启动
- `一键更新全部.bat` — 含明文 IP

### deploy/ 目录
- `_run.py` — 硬编码旧密码

### deploy/ 文档（未提交的参考文档）
- `DEPLOYMENT_AUDIT.md`
- `ENV_CONTRACT.md`
- `STACK_INVENTORY.md`

### nginx/ 目录
- `nginx.conf` — 本地版配置
- `nginx.cloud.conf;D` — 异常残留文件

### 插件残留（已从 git 删除的 Python SDK 文件）
- `plugins/印尼小组/app/` (4文件) + `plugin.yaml` + `requirements.txt`
- `plugins/工程啤办单/app/` (4文件) + `Dockerfile` + `plugin.yaml` + `requirements.txt`
- `plugins/工程啤办单/部署教程.txt`
- `plugins/工程啤办单/deploy.bat`
- `plugins/工程啤办单/start.bat`
- `plugins/工程啤办单/start-auto-sync.bat`

## 保留文件

- `docker-compose.cloud.yml` — 云端部署
- `.env.cloud` / `.env.example` — 模板
- `plugins/3D打印/` — 完整保留（本地运行）
- `core/`、`plugin_sdk/`、`frontend/`、`scripts/` — 源代码
- `deploy/remote-exec.py`、`setup-server.sh`、`update-server.sh` — 云端部署工具
- `nginx/nginx.cloud.conf`、`.htpasswd` — 云端 nginx
- 各插件 `更新xxx.bat` — GitHub 更新脚本
- `操作手册.md` — 参考文档
- `docs/plans/` — 设计文档

## .gitignore 加固

```
# 之前: /.env （只保护根目录）
# 之后: **/.env （保护所有子目录）
**/.env
**/.env.local
```

## 设计决策

1. **不保留本地 Docker 备份** — git 历史可随时找回
2. **3D 打印保持宿主机运行** — 需要局域网直连打印机
3. **保留弱默认密码** — 只在开发环境生效，生产环境由环境变量覆盖
