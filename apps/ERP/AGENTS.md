# WebpageERP 生产管理系统

给 AI 协作者（Codex 等）的项目交接文档。读完这份再动手。

## 这是什么

东莞兴信塑胶制品有限公司的生产管理 ERP，把旧桌面/旧网页系统重写为现代网页版。业务覆盖：客户排期、生产通知单、BOM、采购订单、入仓/领料/退仓/报废/盘点、塑胶啤机、喷油二次加工、委托加工（装配）、半成品/成品仓、船务打发票、权限与在线状态。

## 目录结构

```
src/ErpApi/          # 后端 ASP.NET Core 8（唯一后端）
web2/                # 前端 React 19 + TS + Vite（唯一在用的前端）
web/                 # 老系统前端源码，仅作对照参考，不要改、不要跑
tests/ErpApi.Tests/  # 后端 xUnit 测试（DbFixture 连真实测试库）
tools/DbDeploy/      # 迁移执行器（编号迁移/seed/lenient: 前缀）
tools/DbExport/      # 全量数据快照导出器（生成 db/snapshot）
db/                  # 编号迁移(126+) + seed_*.sql + db/snapshot/ 全量数据快照
docs/                # 操作手册、gap 分析、工作日志 worklogs/
scripts/             # dev-start-mac.sh 一键起本地环境；Windows 发布脚本
排期数据/ 基础资料/   # 业务 Excel 存档（客户排期表、BOM/采购/塑胶物料资料）
WebpageERP.sln       # 解决方案
```

## 技术栈

- 后端：net8.0，Dapper（主）+ EF Core（部分），Microsoft.Data.SqlClient，JWT Bearer，BCrypt。中文控制器/表名/列名贯穿全栈。
- 前端 web2：React + TypeScript，TanStack Query/Table/Virtual，radix-ui + cmdk，Tailwind v4（`@tailwindcss/vite`，自定义 `f-*` 工具类），@phosphor-icons。包管理 npm。
- 数据库：SQL Server（本地 Docker `erpsql` / Azure SQL Edge；云端 mssql:2022 容器限 1536MB）。库名 `erp`，测试库 `erp_test`。

## 本地开发（macOS）

```bash
scripts/dev-start-mac.sh        # 一键拉起 colima+SQL容器+后端5050+前端5174
# 或手动：
export PATH="$HOME/erp-tools/node/bin:$HOME/.dotnet:$PATH"
export ERP_DB="Server=localhost,1433;User Id=sa;Password=ErpDev2026;Database=erp;TrustServerCertificate=true"
export ERP_TEST_DB="Server=localhost,1433;User Id=sa;Password=ErpDev2026;Database=erp_test;TrustServerCertificate=true"
export ERP_JWT_KEY="erp-dev-jwt-key-0123456789abcdef"
dotnet run --project src/ErpApi --urls http://localhost:5050   # 5000 被 AirPlay 占，固定 5050
cd web2 && npm run dev                                         # http://localhost:5174
```

登录：admin / admin123。前端 5174 代理到后端 5050（vite.config）。

## 数据库迁移规范（重要）

- `db/NN[_字母]_描述.sql` 编号迁移，数字升序执行；01/02（重建模式）以 `lenient:` 逐语句容错，其余严格出错即止。
- `db/seed_*_perms.sql`（权限种子，字母序）→ `seed_admin_user.sql`（空库首个 admin）→ `seed_92125_zuru_engineering.sql`（无 ZURU 客户时跳过）。
- **所有脚本必须幂等**（IF NOT EXISTS / MERGE / DELETE+INSERT），云端 db-init 每次部署全量重跑。
- `migrate_*.sql` 无编号文件**不会被** db-init 枚举（历史遗留，新脚本别用这命名）。
- 本地应用迁移（两个库都要）：
  ```bash
  dotnet run --project tools/DbDeploy -- "$ERP_DB" "db/133_xxx.sql"
  dotnet run --project tools/DbDeploy -- "$ERP_TEST_DB" "db/133_xxx.sql"
  ```
- 改库结构后回头检查 `db/snapshot/`（全量数据快照，DbExport 重新生成；快照是**机密业务数据，只进本地仓库，绝不能推到公开仓库 RR-Portal**）。

## 测试与质量（提交前必跑）

```bash
dotnet test tests/ErpApi.Tests          # 后端全量（当前 981 条，须全绿；[Collection("db")] 用 erp_test）
cd web2 && npx vitest run               # 前端全量（当前 954 条，须全绿）
cd web2 && npx tsc -b && npx oxlint     # 类型 + lint，须零告警
```

- 前端测试：vitest + Testing Library，模式见 `web2/src/__tests__/warehouseLocation.test.tsx`（stub fetch + renderWithProviders + permRowsToMap）。
- 后端测试：DbFixture 直插测试库做行级断言，模式见 `tests/ErpApi.Tests/MaterialInventoryDbTests.cs` / `PersonalInventoryDbTests.cs`，种子数据用独特前缀（P3/PI/SM-）并 finally 清理。

## 核心约定

- **权限**：`userbqrpower` 表按「菜单名 × 9 位（打开/保存/删除/打印/单价/金额/审核/反审核/功能）」。后端控制器 `perms.HasAsync(user, Menu, PermissionAction.X)`；前端 `usePerms().can(菜单名, 位)`。新菜单要配 `db/seed_xxx_perms.sql`（至少给 admin），否则谁都进不去。单价/金额是独立权限位——涉及价格的端点无位必须遮罩返回 null。
- **审核流**：单头 `审核`（'0'/'1' 字符串）+ 审核人/审核日期；多数单据还有 主管审核→经理审核→审核下发 多级。反审核要走申请/审批（见 100-102 号迁移）。
- **库存**：不存余额，全部是「已审核明细的符号台账实时聚合」（入 +/出 −）。各仓口径分别在 `Engines/Inventory/`：来料 `MaterialInventoryService`（领料按已出数量）、塑胶 `PlasticInventoryService`、半成品 `InventorySummaryService.SemiSql`（按 物料×颜色）、成品 `InventorySummaryService`。新统计口径必须与这些服务同公式。个人库存金额表（`Features/Materials/PersonalInventoryController.cs`）在台账之上做批次倒推 FIFO 归属下单人。
- **审计**：`IAuditLogger.WriteAsync` 写 c操作记录，增删改/审核都要写。
- **打印**：`web2/src/lib/print*.ts` 系列（合同/啤货表/採購單等），`@page margin:0` + body padding 铺满 A4，浏览器页眉页脚靠零边距消除；啤货表合行规则见 `docs/啤货表打印合行规则.md`。
- **单号**：`Engines/DocumentNumber/DocumentNumberGenerator`。
- **前端单据页骨架**：`components/doc/`（DocToolbar/QueryTable/SearchSelect/PickerDialog/ConfirmDialog/DocToast…），新页面照抄现有同类页（查询页看 InventoryPage，单据页看 PlasticReceiptPage）。
- **路由**：`MainLayout.tsx` 里 PAGES（路径→标题）+ PAGE_LOADERS（路径→懒加载）两处都要注册；菜单在 `nav/menu.ts`。

## 云端部署（RR-Portal）

- 线上：http://8.148.146.194/erp/ （阿里云，与本地库**互相独立**）。
- 代码走公开仓库 `github.com/charlesskl/RR-Portal` 的 `apps/ERP/`（注意：不是最初的 apps/生产部/生产管理系统，#857 迁移过）。**该仓库公开**：业务数据（快照、备份）绝不提交；客户排期/基础资料 Excel 是用户明确要求归档的例外。
- 同步流程：本地 main 提交 → 复制**变更文件**到 /tmp/rr-portal 克隆的 apps/ERP/ 同名路径 → 分支 → PR（charlesskl/RR-Portal）→ 合并触发 GitHub Actions `deploy.yml` 自动部署。
  - **警告**：`apps/ERP/web2/src/api/endpoints.ts` 等文件含云端 `/erp` 子路径适配（`import.meta.env.BASE_URL`），整文件覆盖会还原掉适配搞挂线上。逐 hunk 对比，只带自己的改动。
- 云端库灌数据：用 Actions 手动工作流「ERP Data Restore」（加密快照 Release 资产 + secret 密钥，脚本 `deploy/erp-restore-data.sh`）。恢复快照会清库重插——云端开始正式录入后**不要再跑**。
- 部署排障：Actions 里 `Service Logs` 工作流可看任意 compose 服务日志；部署失败会开维护模式（nginx 503 维护页），修复后重跑部署自动清除；`erp-db-init` exit 139 是历史坑（内存紧），日志确认「完成」即可。

## 当前状态（2026-10-09）

- 本地 main 与 RR-Portal apps/ERP 同步到「个人库存金额表按仓拆分 + 人事所属仓库」。
- 云端库 = 本地 2026-10-09 08:18 的快照（之后本地新增的数据云端没有，属正常漂移）。
- 最新本地提交可能是云端快照之后的功能，注意区分。

## 待办/ backlog（用户提起过但未做）

1. **工程排模表模块**：工模编号+色粉+工模名称+每啤套数+包含件；啤货表打印按排模表出行（现在用 mergeMoldPairLines 过渡规则）；MoldGroupPanel/堵模校验同源。
2. 塑胶喷油合同打印与 DS261005 委托加工合同版式统一（等用户提供原单）。
3. 原料仓（塑胶原料）个人库存口径（目前个人库存只覆盖 来料/塑胶/半成品）。
4. 成品仓不按下单人分（用户暂未要求）。
5. 阿里云服务器升配后遗留事项见 docs/worklogs/。

## 常见坑

- macOS 5000 端口被 AirPlay 占用 → 后端固定 5050。
- 快照 SQL 是混合换行（LF+CRLF），文本处理脚本要兼容；头部必须 `SET QUOTED_IDENTIFIER ON`（带筛选索引的表 DELETE 报 Msg 1934），DbExport 已内置。
- `curl` 直接发中文 query 参数会被 Kestrel 400，测试用 python urllib 或 --data-urlencode 编码后验证。
- Playwright 选择器坑：getByLabel 会被「冻结到X列」按钮干扰，用 `getByRole("textbox"/"button", { name, exact: true })`；重复确认弹窗按钮名是「仍要下单」。浏览器二进制在 `~/erp-tools/pw-browsers/`。
- 前端 React 19 + 谷歌翻译冲突：index.html 已禁自动翻译（notranslate），不要移除。
