# 兴信B ERP 重建（P0 地基）

## 环境变量（禁止硬编码，必须设置）
- `ERP_DB`：SQL Server 连接串（应用运行库）
- `ERP_JWT_KEY`：JWT 签名密钥（≥32 字符）
- `ERP_TEST_DB`：（可选）集成测试数据库连接串；不设则 DB 测试跳过

> 本机开发用 SQL Server LocalDB：连接串形如 `Server=(localdb)\MSSQLLocalDB;Database=erp;Integrated Security=true;TrustServerCertificate=true`。

## 启动
1. 建库（应用库 + 测试库各一次）：
   ```powershell
   ./db/run-db.ps1 -ConnectionString $env:ERP_DB
   ./db/run-db.ps1 -ConnectionString $env:ERP_TEST_DB
   ```
2. 后端：`dotnet run --project src/ErpApi`（macOS 开发固定 http://localhost:5050）
3. 前端：`cd web2; npm install; npm run dev`（开发服务器 http://localhost:5174，/api 代理到 5050）
4. 登录：admin / admin123

> 老前端 web/ 已于 2026-09-29 退役删除，新系统唯一前端为 web2（git 历史可追溯旧代码）。

## 测试
- 后端：`dotnet test`（设置 ERP_TEST_DB 后 DB 集成测试才会真正运行）
- 前端：`npm --prefix web2 run test`

## P0 已交付
- 建库三步（146 表 + 233 关系中应用 190 条 + 3 张新增优化表），DbDeploy 工具，Chinese_PRC_CI_AS 排序规则
- 4 横切引擎：① 单号生成（行锁并发安全）② 审核过账（白名单+事务+审计）③ 库存汇总（UNION 符号法，仅审核单）④ 权限矩阵（9 位）+ 操作审计
- 登录：bcrypt + JWT + 连错 5 次锁定，**无后门**，错误只存计数
- 前端：登录页 + 主框架 + 9 位权限控菜单/价格列

## P1 已交付（基础资料）
- EF Core `ErpDbContext`（映射已存在中文表，不做迁移）
- 泛型 `MasterCrudService<T>` + `MasterCrudController<T>`（分页/模糊/CRUD + 9位权限 + 审计）
- 实体：客户/供应商/加工厂/物料（各含类别）、部门、人事、报价（类别+资料）、调价（表+明细）
- 取价（算法8）：`报价资料` 加 `生效日期`，按 物料编号+报价类别 取生效价；调价单可"应用"写回新生效价
- 前端：可复用主数据页（搜索/分页/增删改），基础资料子菜单，价格列按"单价"权限隐藏
- 开发用权限种子：`db/seed_p1_perms.sql`（授权某用户访问全部主数据菜单）

## 排期模块（客户排期表）
- 新表 `生产排期批次` + `生产排期`（`db/69_production_schedule.sql`，幂等），权限种子 `db/seed_scheduling_perms.sql`（菜单名 `生产排期`）
- 后端 `Features/Scheduling`：`/api/scheduling` 列表（关键字/排期客户/状态/走货期区间分页过滤）、`batches`/`summary`/`customers`、`import`、`DELETE batches/{id}`（级联删明细），全程 9 位权限 + 审计
- Excel 导入：前端逐工作表解析（xlsx/xls/csv），按表头别名+最长前缀映射列（兼容 ZURU/TOMY/MOOSE/SPIN 等各客户中英文、带注释表头），按工作表名推定状态（取消→已取消、走货/出货→已走货、其余→在排），`SheetN`/含"筛选"的临时工作表自动跳过；数字/日期列解析失败不拦截，原值打包进备注
- 万全兜底：每行另存整行原始数据 JSON（原表头→原值逐字保留，`db/71_production_schedule_raw.sql`），列表行展开可见，关键字搜索同时覆盖原始数据——任何客户任何表头写法都不丢数据
- 重复导入按自然键（排期客户+PO号+客PO+SKU+货号+数量）更新状态/日期而非重复新增，天然支持"在排→已走货"流转与文件重导
- 前端页面 `/scheduling`（菜单：业务部 → 客户排期表），含「按排期行 / 按排期表」双视图、导入弹窗与批次管理；按排期表视图以文件为单位归类（行数/货号数/状态分布，展开看货号明细），支持按货号/品名/PO号反查"哪些货号在哪些排期表"
- 排期行/排期表明细的货号可点击：弹出该货号 BOM 物料清单（复用 BOM物料设置数据与默认报价带出供应商/单价），需求数量 = 排期数量 × 用量，勾选后按供应商分组生成物料采购订单（复用采购订单接口），未建 BOM 时引导去工程部建档
- 排期行「生产下单」：按排期行预填生成生产通知单（复用生产通知单创建接口，工序/物料自动展开），数量/客户/交货日期(=走货期)/下单日期(=接单日期)/总箱数可改，备注自动带 排期客户+PO+货号；货号未建 BOM 时引导去「工程部 → BOM物料设置」建档

## 外部系统入口（RR-Portal 门户）
- 菜单集成 `http://8.148.146.194` 门户上的 18 个既有子系统：`web2/src/nav/menu.ts` 里 `X()` 帮助函数生成 http 完整 URL 叶子（↗ 标记），点击新标签打开、不走内部路由；不挂权限位全员可见
- 分布：业务部(ZURU接单表入单/报价系统/内部报价系统/TOMY排期核对)、工程部(工程啤办单/模具手办采购订单/A-doc生成)、装配部(生产计划排拉)、啤机部(注塑啤机排产/啤机外发)、喷油部(喷油排产/喷油生产管理)、船务部(船务管理系统)、品质部(QA周结/QC成品报告/QMS)、PMC仓务(加工厂月度评审)、印尼小组(印尼走货明细)
- 明确不放：ZURU总排期入单、河源排期入单（ERP 排期模块已覆盖）
- 注意：部分外部系统有独立账号体系，跳转后需再登录

## 安全基线
- 连接串/JWT 密钥仅取自环境变量，无任何硬编码凭据
- 已彻底移除原软件万能密码后门 `zsbqr.com!#(`；密码 bcrypt 加盐；不存明文错误密码
