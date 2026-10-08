# web2 全量重写（第二阶段：剩余全部页面 + 首批遗留补齐）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan batch-by-batch. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把老系统剩余全部内部页面（约 62 个路由）重写到 web2，并补齐首批遗留的 5 项用户已确认要做的功能；完成后新系统功能全集等于老系统（外部系统入口除外）。

**Architecture:** 延续首批架构与骨架（components/doc + hooks + 白绿未来版）。Batch 0 先做遗留补齐与共享收敛（PickerDialog/ConfirmDialog 抽组件、密度全站、令牌收敛），Batch 1-10 按部门分批重写页面，Batch 11 总验收+终审。每批一个实施者 + 一个审查者，节奏与第一批相同。

**Tech Stack:** 同首批（React 19 / Vite 8 / TS strict / Tailwind v4 / shadcn / TanStack / Vitest）

**Spec:** docs/superpowers/specs/2026-09-15-frontend-rewrite-design.md + 首批计划 docs/superpowers/plans/2026-09-16-web2-first-batch-rewrite.md

## Global Constraints

继承首批计划 Global Constraints 全部内容（令牌、弹窗四律、硬纪律、menuKey 实证、MENU_PATHS 防断链、完成定义、playwright 自验方式、git 检查点需用户已批准的既定授权）。新增/变更：

- **页面任务标准动作（每个页面都要做，不再逐页重复写）**：① 读老页面+老测试（web/src/pages/...、web/src/__tests__/...）列场景核对清单；② 桩模式照 web2/src/__tests__/ 现有页面测试（fetch 路由桩 + permRowsToMap + renderWithProviders）；③ 先红后绿逐场景移植；④ menuKey 显式传（grep src/ErpApi MenuCatalog 实证）；⑤ 打印/导出对照 printContracts/tableExport；⑥ 弹窗四律+令牌色+无 dash/emoji；⑦ playwright 新旧同单对照截图存 /tmp/pwshot 并写进报告；⑧ `cd web2 && npx vitest run && npx tsc -b && npx oxlint` 全过 + `cd web && npx vitest run` 424 不破；⑨ nav/menu.ts 卡片改可点 + nav/legacy.ts 补回旧版映射；⑩ git 一个提交（中文 message）
- **范围变更（用户已授权"全部做完"）**：首批"后端零改动"约束在 Batch 0 Task C 破例一次（账号权限整组替换隐患的后端修复），须配后端测试且 ERP_TEST_DB 跑测试库
- 外部系统入口（X() 函数，↗ 标记）原样保留链接不重做；品质部/PMC仓务/印尼小组纯外部组在新版宫格显示为链接卡片
- /logout、/system/upgrade、/change-password 作为工具项实现（退出=清 token 回登录页；网上升级/修改密码照老系统行为）
- 报表/查询类页面（无单据操作的）标准结构：筛选栏 + TanStack Table + 导出 CSV + 打印 + 密度三档（Batch 0 后共享表组件落地，全部用它）

## Batch 划分与页面清单

### Batch 0: 首批遗留补齐 + 共享收敛（5 项 + 工程债）

- [x] **Task 0A 分次出库抽屉**（来料领料单）：照 web/src/pages/materials/MaterialIssueOutboundDrawer.tsx 移植，POST /outbound 部分出库/跳行/出完自动已审核；测试对照老场景
- [x] **Task 0B 批量审核**：OpenDocDialog 加多选模式（checkbox 列+批量审核按钮），接入仓/退仓/领料类单据页（对照老系统各页批量审核行为）
- [x] **Task 0C 账号权限整组替换隐患（后端破例）**：后端 `GET /admin/accounts/{user}/perms` 返回原始行（含非 MenuCatalog 菜单）或 PUT 改合并语义——选对旧系统行为影响最小的方案（旧 AccountPage 也调同一 PUT，语义变更要两边兼容）；web2 AccountsPage 适配；后端测试 `ERP_TEST_DB='Server=localhost,1433;Database=erp_test;User Id=sa;Password=ErpDev#2026x;TrustServerCertificate=True' ~/.dotnet/dotnet test tests/ErpApi.Tests`（基线 890 过/9 失败是别的会话 WIP 自伤，不新增失败即可）；改后端后重启必须带凭据：`source /tmp/erp_env_kv.sh`
- [x] **Task 0D 生产通知单六项补齐**：一键启动/下推领料/MO单录入/图片备注/工序物料页签/BOM 实时预览（照 web/src/pages/production/ProductionNoticePage.tsx 逐项）；BOM 设置页（/bom-setup）若为本批依赖则提前到 Batch 1 第一件
- [x] **Task 0E 共享收敛**：PickerDialog 抽 components/doc/（6 处拷贝收一）、ConfirmDialog 抽组件（7 处内联收一）、共享查询表组件（密度三档内置+virtualizer.measure 修复内置）、useFirstDoc hook（5 页复制收敛）、portal :root 主色对齐 future 绿、info 蓝令牌入 future.css（#2563eb 档 7 处收敛）、打印资产单源（esc/抬头/7 条注意事项）+ 打印契约测试补 7/7 断言、采购订单物料选择器补齐（"只查有库存"复选+服务端分页）、塑胶领料多单合并口径页面注释标注
- [x] **Task 0F 库存含零库存口径**（后端小修）：`/api/material-inventory?含零库存=true` 只回 17 条与注释口径不符，按接口注释修正为主档全量+零库存显 0；配后端测试

### Batch 1: 工程部（6 页）

款号总表(/master/款号资料)、BOM货号查询(/bom-style-query)、物料资料(/material-master)、塑胶物料资料(/plastic-material-master)、**BOM物料设置(/bom-setup，含 &po= 参数与待绑定PO号逻辑——Task 3/10 的跳转目标，优先做)**、BOM物料查询(/bom-material-query)；外加基础设置的物料快速建档(/material-create)
- 老源：web/src/pages/styles/、web/src/pages/master/、web/src/__tests__/bomSetup*.test.ts、master.test.ts、bomImport.test.ts、materialImport.test.ts

### Batch 2: 装配部报表群（11 页）

生产单跟踪表、货号接单汇总表、装配物料设置、装配物料汇总表、装配采购查询、装配采购进度表、装配物料跟踪表、加工厂库存汇总表、装配需领明细表、加工厂分类月报表、加工厂分类明细表
- 老源：web/src/pages/assembly/、web/src/pages/production/{OrderProgressPage,PurchaseMaterialAnalysisPage}.tsx、web/src/__tests__/assembly*.test.ts（8 个）、orderProgressSummary.test.ts
- 全部是查询/报表页，用 Batch 0 的共享查询表组件

### Batch 3: 补料单 + 来料仓剩余（7 页）

补料单(/replenishments，含 ReplenishmentPickerModal)、退料单、报废单、库存月报表(/month-end)、订购单查询、来料标签单、采购订单进度表(/order-progress)
- 老源：web/src/pages/replenishment/、materials/{PurchaseReturnQueryPage,MaterialScrapQueryPage,PurchaseReceiptQueryPage}、web/src/__tests__/replenishment.test.ts、monthEnd.test.ts、materialLabelQuery.test.ts、purchaseOrderQuery.test.ts

### Batch 4: 塑胶仓群（10 页）

塑胶采购分析、塑胶物料设置、塑胶采购订单、塑胶订单进度表、塑胶共用物料表、塑胶退仓单、塑胶报废单、塑胶库存统计表、塑胶库存月报表、塑胶类型客户统计
- 老源：web/src/pages/plastics/（20+ 文件）、web/src/__tests__/plasticPurchaseOrderDrawerStock.test.ts 等

### Batch 5: 半成品仓群（9 页）

半成品共用物料表、半成品标签单、半成品入仓单、半成品出库单、半成品出仓单（别名仓侧审核）、半成品报废单、半成品盘点单、半成品库存统计表、半成品库存月报表
- 老源：web/src/pages/warehouse/Semi*、web/src/__tests__/semi*.test.ts（13 个）

### Batch 6: 喷油/加工群（5 页）

喷油加工订单(/plastic-process-order-make)、白件领料单(/plastic-white-part-issue)、塑胶加工采购订单(/plastic-process-purchase-orders，**Task 9 断链修复的跳转目标，优先做**)、采购物料分析(/purchase-material-analysis)、采购物料设置(/purchase-material-settings)、BOM订单制作(/material-order-make)
- 老源：web/src/pages/plastics/{PlasticProcessOrderMakePage,PlasticWhitePartIssuePage,PlasticProcessPurchaseOrderPage}.tsx 等、web/src/__tests__/factoryProcessMatch.test.ts、outsourcing.test.ts

### Batch 7: 原料仓群（11 页）

原料资料(/plastic-raw-material-master)、原料生产需求表、原料采购分析表、原料采购订单、原料采购进度表、原料入仓单、原料出库表、原料盘点单、原料库存统计表、原料库存月报表、原料生产需求汇总、原料订货入库统计
- 老源：web/src/pages/plastics/PlasticRawMaterial*.tsx（11 个）

### Batch 8: 船务部 + 业务部 + 外发加工资料（5 页）

成品入仓单(/finished-receipts)、成品库存(/finished-inventory)、客户资料(/master/客户资料)、加工厂资料(/master/加工厂资料)、供应商资料(/master/供应商资料)
- 老源：web/src/pages/warehouse/Finished*、web/src/pages/master/、web/src/__tests__/finished.test.ts、master.test.ts、factoryProcessMatch.test.ts

### Batch 9: 基础设置 + 工具项（9 项）

基本资料、功能设置、仓库位置设置、备份数据、还原数据、塑胶原料资料表（若 Batch 7 已做则勾掉）、啤机机型啤工表、部门人事、用户修改密码、退出软件、网上升级
- 老源：web/src/pages/system/、web/src/pages/admin/、web/src/__tests__/sysConfig.test.ts、settingsConsumption.test.ts、admin.test.ts
- 审计：grep web/src/App.tsx 全部路由，菜单外的隐藏路由（sales/payables/payroll/attendance/piecework/priceAdjust 等）逐个判定：有入口的补做，纯孤儿页列清单给用户

### Batch 10: 总验收 + 终审

- [x] 全量测试 + 62 页新旧对照总表（抽每页至少一条真实数据对照）+ 性能抽查 + 硬纪律扫描
- [x] 全分支终审（最 capable 模型）+ 一轮修复
- [x] spec 状态更新为"全量完成"；README/使用说明更新；宫格"未开放"卡片应全部清零

## Self-Review 记录

- 覆盖：菜单 101 项 = 首批 12 + 外部链接 X() 14 + 工具项 3 + 别名/重复入口（来料领料单×3、塑胶入仓单×3、塑胶领料单×2、成品仓领料出库、半成品出仓单、原料领料单、塑胶物料资料×2、物料资料×2、生产通知单×2、系统用户/用户权限同页）+ Batch 1-9 约 62 页；无缺口
- 依赖顺序：Batch 0E（共享收敛）先于页面批；/bom-setup 先于依赖它的提示文案清理；/plastic-process-purchase-orders 先于 Task 9 断链收尾
- 类型一致性：共享组件签名以 Batch 0E 产出为准，后续批次只消费
