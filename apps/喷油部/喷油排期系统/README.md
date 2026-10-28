# 印喷部生产排期系统 V1（SprayPlan）

> Phase 0 项目骨架已完成。Phase 1-4 业务模块开发中。

## 技术栈

- Next.js 14 (App Router) + TypeScript
- Prisma 6 + SQLite (dev.db 单文件，零运维)
- TailwindCSS + shadcn/ui（薄荷柔和主题）
- iron-session 会话鉴权
- Vitest 单元测试 + Playwright E2E
- PM2 + Windows 服务开机自启动

## 本地开发

```bash
npm install

# 首次：跑迁移 + seed
npx prisma migrate dev
npm run db:seed

# 启动开发服务器（端口 8400，绑定 0.0.0.0 局域网可访问）
npm run dev
```

访问 `http://localhost:8400`，自动跳转到登录页。

## 默认账号（首次部署后请立刻改密码）

| 用户名 | 密码 | 角色 | 说明 |
|---|---|---|---|
| admin | admin123 | 主管 | 全功能，含用户管理 |
| clerk | clerk123 | 文员/拉长 | 日常录入主角色 |
| viewer | viewer123 | 统计组 | 只读 |

## 测试

```bash
npm test            # 单元测试（vitest）
npm run test:e2e    # E2E 测试（playwright，自动启 dev server）
```

## 生产部署（局域网共享）

### 1. 构建

```bash
npm run build
```

### 2. 首次安装 PM2 + 开机自启动（一次性）

```bash
npm install -g pm2 pm2-windows-startup
pm2-startup install
```

### 3. 启动并保存 PM2 进程列表

```bash
pm2 start ecosystem.config.js
pm2 save
```

### 4. 验证

```bash
pm2 list                       # 看 sprayplan 状态 online
pm2 logs sprayplan --lines 20  # 看启动日志，应有 "Ready"
```

本机访问 `http://localhost:8400`，喷油部其他电脑访问 `http://<本机局域网 IP>:8400`。

获取本机 IP：

```bash
ipconfig | findstr IPv4
```

如果其他电脑访问不通，检查 Windows 防火墙：放行 8400 端口入站。

### 5. 部署后改密码 + Session 密钥

- 用 admin 登录系统 → 用户管理 → 改各账号密码
- 编辑 `.env`：把 `SESSION_SECRET` 改为 32 字符以上随机串

## 重要说明

- **端口 8400**：业务方机器 3000 被占用，本项目改用 8400。如需切换，改 `package.json` scripts + `ecosystem.config.js` + `playwright.config.ts`。
- **多项目混合 git 仓库**：仓库根在 `d:/03-AI related/`，本项目在 `05-SprayPlan/` 子目录。提交时只 add 本项目内文件。
- **Tailwind 类名 rename**：因 shadcn-ui 占用了 `border` / `bg` 命名空间，项目级颜色重命名为 `border-app-border` / `bg-app-bg-*`。详 `tailwind.config.ts` 头部注释。

## 文档

- 业务规则：`docs/BUSINESS_LOGIC.md`（v0.6 现状，待 v0.9 重整）
- UI 样式：`docs/UI_STYLE_GUIDE.md` v0.2（薄荷柔和）
- 章节 spec：`docs/superpowers/specs/`
- 实施计划：`docs/superpowers/plans/`
- 开发踩坑：`docs/DEV_ERROR_LOG.md`

## 接下来（Phase 1-4）

- Phase 1：第 1 章订单接收 + 第 3 章工艺模板（部位级 4 价）
- Phase 2：第 4 章图案库 + inventory 状态机
- Phase 3：第 2 章排期（甘特图 + 订单汇总表）
- Phase 4：第 6 章实绩录入 + 日报系统对接

## 来料登记与自动重排

- 在“排期 → 来料管理”选择订单部位，或点计划详情中的“登记来料 / 自动重排”。填写**累计到料数量**、实际到料日及剩余物料预计到料日；分批到料时更新累计值，不要重复叠加。
- 未登记的旧订单保持原排期。登记后，已到数量优先安排；尚未到料且没有未来预计日期的部分保留为待料，不占用拉别产能。定时任务每五分钟检查一次预计日期已过且未到齐的部位，每个业务日处理一次。
- 自动重排只移动已登记部位的未报工计划，沿用原拉别、机台、日产量，检查工作日、产能及上道工序供给。有实绩、报数、入库或入库申请的记录及库存不改动。没有首次工序配置时，需要先生成排期。
- 人工撤销计划会暂停对应部位的自动重排，避免后台重新生成；在来料管理再次保存可恢复。登记采用版本校验，冲突时重新打开窗口后再保存。
- 来料独立存入 `order_materials`，`source=manual`；当前不连接 ERP。后续对接可复用来料业务校验和重排服务，不必改变成品库存数据。
- 本次包含 Prisma 增量迁移；现有 Docker 数据盘由 API 启动时幂等创建新增表，不修改已有表。首次初始化仍使用 Prisma 模型。部署前按现有流程备份生产 SQLite 文件。
