# 内部报价系统 (internal-quote)

公司内部报价明细系统 — 多部门分工填写（业务/工程/电子/啤机/喷油/搪胶/车缝/装配）+ 主管审核 + 受控导出 xlsx。

- **技术栈**: Node.js + Express，`node:sqlite`（内置，需 Node 22.5+），cookie-session 鉴权，ExcelJS 导出
- **自包含**: 不依赖 core/FastAPI，自带 SQLite 库与登录（与 `报价系统/baojia` 同类自包含 Node 应用）

## 接线状态（本 PR 已完成）
- ✅ `docker-compose.cloud.yml`: service `internal-quote`（bind-mount `backend/data` + `backend/uploads`，healthcheck `/health`）
- ✅ `nginx/nginx.cloud.conf`: 路由 `/internal-quote/`（api/静态/health，子路径前缀重写）
- ✅ `frontend/index.cloud.html`: 门户磁贴 + 详情卡 + 状态点
- ✅ `.env.cloud`: `INTERNAL_QUOTE_SESSION_SECRET`（必填）/ `INTERNAL_QUOTE_ADMIN_PASSWORD`（可选）
- ✅ 前端已做子路径适配（fetch 前缀 shim + 图片相对路径），`/internal-quote/` 与根路径都能跑

## 关键参数
- **service 名**: `internal-quote`（容器/DNS/nginx upstream 用，保持不变）
- **URL 路径**: `/internal-quote/`
- **端口**: 容器内 `3210`（`PORT` 可改）
- **持久化（bind-mount 两个目录）**:
  - `backend/data/`  — SQLite 数据库（`DB_FILE=/app/backend/data/data.db`）
  - `backend/uploads/` — 上传的模具图
- **环境变量**:
  - `SESSION_SECRET`（必填，生产随机长串）
  - `ADMIN_INITIAL_PASSWORD`（可选；不设则首启随机生成并打印在日志）
  - `NODE_ENV=production`（已在 Dockerfile 设置，启用 secure cookie；app 已 `trust proxy`）
- 首次启动自动建库种子：创建 `admin` 账号 + 各部门初始 PIN（见容器日志），登录后请立即改密。

## 本地运行
```bash
npm install
npm run dev   # node --watch backend/server.js → http://localhost:3210
```
