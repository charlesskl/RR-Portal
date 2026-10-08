# 基本设置组 6 个菜单占位功能 + 系统工具（备份/还原指引/版本）

日期：2026-07-28

## 背景
"基本设置"菜单组中 8 个占位项（基本资料/功能设置/仓库位置设置/啤机机型啤工表/备份数据/还原数据/网上升级/退出软件）点击进 PlaceholderPage。本次实现全部功能页面与后端；**未动共享文件**（App.tsx / menuTree.tsx / Program.cs / MenuCatalog.cs / MasterData/Controllers.cs），路由与菜单接线由主会话统一做。

## 变更清单

**DB 脚本（幂等，仿 db/44 写法）**
- `db/46_warehouse_locations.sql` — 新建 `[仓库位置]`：ID bigint IDENTITY 主键、编号 nvarchar(20) NOT NULL（唯一索引 UX_仓库位置_编号）、名称 nvarchar(60)、备注 nvarchar(200)。物料资料/塑胶物料资料/塑胶原料资料的 [仓位号] 引用本表编号。
- `db/47_injection_machine_rates.sql` — 新建 `[啤机机型啤工表]`：ID 主键、啤机机型 nvarchar(30) NOT NULL（唯一索引）、啤工价 decimal(18,4)、备注 nvarchar(200)。工模表/塑胶共用物料表的 [啤机机型] 引用本表机型。

**后端（全部新文件，零 DI 改动——依赖的 SysConfigService/ISqlConnectionFactory/IPermissionService/IAuditLogger 均已注册）**
- `src/ErpApi/Features/Warehouse/WarehouseLocationController.cs` — 轻量 Dapper CRUD（`api/master/warehouse-locations`，菜单"仓库位置设置"），自包含不动 MasterData/Controllers.cs；编号唯一冲突 2601/2627 → 409；`WarehouseLocationRules.校验` 纯静态规则（编号必填/≤20 字）。
- `src/ErpApi/Features/MasterData/InjectionMachineRateController.cs` — 轻量 Dapper CRUD（`api/master/injection-machine-rates`，菜单"啤机机型啤工表"）；啤工价按"单价"权限脱敏（读取置 null、无单价权限编辑时从库回填原值防抹价，对齐 MasterCrudController 的 PriceField 语义）；`InjectionMachineRateRules.校验`（机型必填/≤30 字、价不为负）。
- `src/ErpApi/Features/SystemConfig/BasicSettingsControllers.cs` — 抽象基座 `SysConfigSectionController`（固定键白名单 GET/PUT，复用 SysConfigService，键存系统配置表不加密，GET 缺省补默认值不落库）+ 两个派生：
  - `CompanyProfileController`（`api/company-profile`，菜单"基本资料"）：公司.名称/地址/电话/传真/备注 五键；
  - `FeatureSettingsController`（`api/feature-settings`，菜单"功能设置"）：系统.默认货币/单价小数位/数量小数位 三键。已 grep 确认代码中无"已消费但未提供 UI"的配置键（GetValueAsync 暂无服务端消费者），故做通用项；`FeatureSettingsRules.校验` 静态规则（货币白名单 HKD/RMB/USD/EUR、小数位 0-6）。
- `src/ErpApi/Features/Admin/SystemToolsController.cs` — `api/admin` 前缀（与 AdminController 路由不冲突）：
  - `GET version`（任意登录用户）：程序集版本 + InformationalVersion + 运行时 + 环境；
  - `POST backup`（菜单"备份数据"·功能权限）：备份目录取 系统配置表键 `备份.目录`，缺省回落环境变量 `ERP_BACKUP_DIR`（禁硬编码）；文件名服务端生成 `库名_yyyyMMdd_HHmmss.bak`，库名按 `]` 转义防注入；写审计日志。

**前端（全部新文件）**
- `web/src/api/systemSettings.ts`（companyProfileApi/featureSettingsApi）、`web/src/api/systemMasters.ts`（warehouseLocationApi/injectionMachineRateApi）、`web/src/api/adminTools.ts`（version/backup）。
- `web/src/pages/system/CompanyProfilePage.tsx` — 公司资料表单（保存权限门控）。
- `web/src/pages/system/FeatureSettingsPage.tsx` — 货币 Select + 小数位 InputNumber。
- `web/src/pages/system/WarehouseLocationPage.tsx`、`web/src/pages/system/InjectionMachineRatePage.tsx` — 搜索/分页/增删改弹窗（仿 MasterDataPage，带权限门控与价格列隐藏）。
- `web/src/pages/system/BackupPage.tsx` — 触发备份 + 显示服务端备份文件路径；无"功能"权限时提示。
- `web/src/pages/system/RestorePage.tsx` — **决策：不提供在线还原**（覆盖全库不可逆，防误操作），页面仅展示 DBA 服务端 RESTORE 五步指引。
- `web/src/pages/system/UpgradePage.tsx` — 显示 /api/admin/version 返回的版本信息，说明升级由运维部署发布包完成。
- `web/src/auth/logout.ts` + `web/src/pages/system/LogoutPage.tsx` — 清 erp_token/erp_user 后整页跳 /login（顺带清空内存权限缓存）。

**测试**
- `tests/ErpApi.Tests/SystemSettingsAndToolsTests.cs` — 28 例纯单元测试：功能设置校验（货币/小数位/未知键）、仓库位置校验、啤机校验、备份文件名/目录校验/库名转义。

## 待主会话接线
- App.tsx 路由：`system/company-profile` `system/feature-settings` `system/warehouse-locations` `system/injection-machine-rates` `system/backup` `system/restore` `system/upgrade` `logout`。
- menuTree.tsx：基本资料→/system/company-profile(perm 基本资料)、功能设置→/system/feature-settings(功能设置)、仓库位置设置→/system/warehouse-locations(仓库位置设置)、啤机机型啤工表→/system/injection-machine-rates(啤机机型啤工表)、备份数据→/system/backup(备份数据)、还原数据→/system/restore、网上升级→/system/upgrade、退出软件→/logout。
- MenuCatalog.cs 追加：("系统管理","基本资料")、("系统管理","功能设置")、("系统管理","仓库位置设置")、("系统管理","啤机机型啤工表")、("系统管理","备份数据")。
- DI：无需新增。

## 验证
- `dotnet build src/ErpApi` 通过（0 警告 0 错误）。
- 新测试 28/28 通过；全量 `dotnet test`：169 通过 / 477 跳过（未设 ERP_TEST_DB 属正常）/ 2 失败——两例均为其它并行任务既有问题，与本次改动无关（本次只新增文件）：`SemiFinishedShortageControllerTests.Export_returns_bom_csv...`（CSV 转义断言，半成品欠料模块）、`PricingServiceDbTests.Picks_latest...`（ConnectionString 未初始化，该 DB 测试未走 DbFixture 跳过）。
- `cd web && npx tsc -b`：本次新增文件零错误；仅有 2 个其它任务未提交改动引入的既有报错（auxiliary 两页未使用导入 TS6192），未代为修改。

## 遗留
- db/46、47 需部署到正式/测试库后两个主数据功能才可用。
- 备份目录需运维配置 系统配置表键 `备份.目录`（SQL Server 服务端绝对路径）或环境变量 `ERP_BACKUP_DIR`。
