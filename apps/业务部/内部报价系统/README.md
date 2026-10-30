# 内部报价系统 (internal-quote)

公司内部报价明细系统 — 多部门分工填写（业务/工程/电子/啤机/喷油/搪胶/车缝/装配）+ 主管审核 + 受控导出 xlsx。

- **技术栈**: Node.js + Express + PostgreSQL，cookie-session 鉴权，ExcelJS 导出

## 报客表英文翻译

复制 `.env.example` 为 `.env`，填写百度翻译开放平台凭据：

```env
BAIDU_APPID=your_app_id
BAIDU_KEY=your_secret_key
```

`.env` 已被 Git 忽略，不会提交凭据。SPIN/TOMY 报价单页面的“自动翻译英文”按钮会优先使用已保存英文；常见内部名称使用本地词典，其余中文调用百度翻译。
- **数据隔离**: 共用 RR-Portal PostgreSQL 实例，使用独立 `internal_quote` schema，不与 core 表混用

## 接线状态（本 PR 已完成）
- ✅ `docker-compose.cloud.yml`: service `internal-quote`（PostgreSQL + bind-mount `backend/uploads`，healthcheck `/health`）
- ✅ `nginx/nginx.cloud.conf`: 路由 `/internal-quote/`（api/静态/health，子路径前缀重写）
- ✅ `frontend/index.cloud.html`: 门户磁贴 + 详情卡 + 状态点
- ✅ `.env.cloud`: `INTERNAL_QUOTE_SESSION_SECRET`（必填）/ `INTERNAL_QUOTE_ADMIN_PASSWORD`（可选）
- ✅ 前端已做子路径适配（fetch 前缀 shim + 图片相对路径），`/internal-quote/` 与根路径都能跑

## 关键参数
- **service 名**: `internal-quote`（容器/DNS/nginx upstream 用，保持不变）
- **URL 路径**: `/internal-quote/`
- **端口**: 容器内 `3211`（`PORT` 可改）
- **持久化**:
  - 业务数据 — PostgreSQL 的 `internal_quote` schema
  - `backend/data/data.db` — 只读挂载，首次升级时自动迁移历史 SQLite 数据
  - `backend/uploads/` — 上传的模具图，继续使用 bind mount
- **环境变量**:
  - `SESSION_SECRET`（必填，生产随机长串）
  - `ADMIN_INITIAL_PASSWORD`（可选；不设则首启随机生成并打印在日志）
  - `ACCOUNT_INITIAL_PASSWORD`（配置账号首次创建时的统一临时密码；通过 `INTERNAL_QUOTE_ACCOUNT_PASSWORD` 注入，不写入仓库）
  - `APPLY_CONFIGURED_ACCOUNT_SEED=1`（按 `backend/db/account-seed.csv` 同步账号、部门、角色、客户范围和菜单权限；不覆盖现有密码）
  - `DATABASE_URL`（必填，PostgreSQL 连接串）
  - `DB_SCHEMA`（默认 `internal_quote`）
  - `DB_POOL_SIZE`（默认 `20`）
  - `LEGACY_SQLITE_FILE`（可选；首次升级自动导入的旧库路径）
  - `NODE_ENV=production`（已在 Dockerfile 设置，启用 secure cookie；app 已 `trust proxy`）
- 首次启动自动建库种子：创建 `admin` 账号，并在提供账号临时密码后补充配置账号；登录后请立即改密。

## 本地运行
```bash
npm install
DATABASE_URL=postgresql://rrportal:password@localhost:5432/rrportal npm run dev
```

自动化测试仍可显式设置 `DB_DRIVER=sqlite` 和临时 `DB_FILE`，不会改变生产环境使用 PostgreSQL 的规则。

### 撤销误确认

- 报价列表中，业务或管理员可将“已确认”改回“待确认”，填写撤销原因后保存。仅尚未生成核价版本、未填写核价记录的报价可撤销。
- 使用专用 `POST /api/quote-summary/:id/revoke-confirmation`，按列表确认修订号校验；普通保存接口不能撤销，避免旧页面自动保存解锁。
- 撤销与确认、原报价写入、首次核价初始化共用报价行锁。保留原部门资料及客价/数量草稿，清除确认人/时间；未启用的自动核价快照完整写入审计后移除。重新确认时生成最新快照。
- 已有核价版本的报价禁止直接撤销，不删除核价明细或附件。`tests/quote-freeze-api.test.js` 覆盖误确认撤销、并发、旧请求与重新确认。
