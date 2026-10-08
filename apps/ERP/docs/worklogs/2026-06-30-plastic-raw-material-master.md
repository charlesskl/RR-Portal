# 塑胶原料资料表(①基础资料·可编辑主数据) · 2026-06-30

## 做了什么
① 基础资料「塑胶原料资料表」——**可编辑主数据**页(左 物料类别 树 + 右表格 + **弹窗增删改**),**保存/删除按权限**(无权限只读)。镜像 塑胶物料资料(PlasticMaterialMaster)·塑胶原料=ABS/PP/PVC 树脂·字段加 **商品名称/起订量(MOQ)/安全库存**。**新表 `塑胶原料资料`**。
- **后端**:新表 `db/30_plastic_raw_material.sql`(21列)。实体 `塑胶原料资料.cs`(: MasterEntity·[Column] 映射可改字段·[PriceField] on 单价/销售价)。DbContext 加 `DbSet<塑胶原料资料>`。通用 CRUD 控制器 `PlasticRawMaterialController`(`api/master/plastic-raw-materials`·`MasterCrudController<塑胶原料资料>`·Menu="塑胶原料资料表"·**保存/删除/单价脱敏/单价编辑回填 由基类自动含**)。读 `PlasticRawMaterialMaster/`(DTOs+Service categories/list+Controller `api/plastic-raw-material-master`·单价脱敏)。Program.cs 注册读 service。MenuCatalog `("基础资料","塑胶原料资料表")`。admin 9 位权限种子。
- **前端**(克隆 `PlasticMaterialMasterPage`):`api/plasticRawMaterialMaster.ts` + `PlasticRawMaterialMasterPage`(左树「全部塑胶原料+类别」+ 右表[列加 商品名称/起订量/安全库存]+ 新增/编辑 Modal[字段加 商品名称/起订量/安全库存]+ 删除·`canSave/canDelete` 门控·单价/销售价脱敏)·CRUD 走 `masterApi("plastic-raw-materials")`。App 路由 `plastic-raw-material-master` + menuTree line27 三参。

## 决策(AskUserQuestion)
编辑方式=弹窗增删改(同塑胶物料资料·非行内);字段=镜像塑胶物料+加 商品名称/起订量/安全库存。

## 执行(subagent-driven)
spec→plan→子代理 Task1 后端(`2da308c`)/Task2 测试(`35dd621`·404绿)/Task3 前端(`7d50fcd`·tsc0+vitest54)/Task4 CRUD冒烟+opus终审。**opus 全分支终审=READY TO MERGE**(7点:实体↔表↔读列一致·DbSet注册/CRUD控制器基类自动含保存删除单价/读服务categories+list含新字段·单价脱敏/菜单权限DI路由齐·**种子误覆盖已修正**/前端canSave-canDelete门控·脱敏·新字段/DTO↔SQL↔前端一致/全参数化·未动既有master)。

## 测试 / 验证
- 后端 `PlasticRawMaterialMasterDbTests`(种 ABS×2/PP×1/NULL类别 → categories 计数·NULL过滤;ListAsync 类别=ABS 带出 商品名称韩国LG/起订量25/安全库存5/库存100/供应商名称;keyword PP粒;onlyStock 过滤库存0)。全量 **后端 404**(401+3)/前端 54、tsc 干净。
- **HTTP 冒烟全闭环 PASS**:登录→POST 建(id=1)→GET categories(含ABS冒烟)→GET list(商品名称/起订量25/安全库存5/单价10)→PUT 改物料名称(204)→DELETE(204·查无)。

## 合并
分支 `feat-plastic-raw-material-master`(5 提交含 1 修正)→ `--no-ff` 合并 master `0ec6aa1`,分支已删。17 文件 +1200/−1。

## 教训/记录
- **种子文件名撞车坑**:Task1 子代理新建 `seed_plastic_raw_material_perms.sql` 时**该名已存在**(原属"原料本月库存汇总"·`7befa2e`),被误覆盖。修复:`git checkout master -- <file>` 恢复原文件,新种子改名 `seed_plastic_raw_material_master_perms.sql`。**教训:新建 db 种子文件前先确认文件名未被占用**(plastic_raw_material 这种宽名易撞)。DB 权限两个菜单都已正确应用,仅文件名冲突。
- **可编辑主数据模式成型**:新表+实体(:MasterEntity·[Column]/[PriceField])+DbContext DbSet+通用 `MasterCrudController<T>`(`api/master/<name>`·CRUD+权限+脱敏全自动)+读服务(categories/list 左树右表)+前端克隆 PlasticMaterialMasterPage(masterApi CRUD)。后续主数据照此克隆。

## 下一步
⑩发外加工只剩 生产加工缺料表(最后一项);⑦塑胶物料设置/进度明细表/物料进出汇总;⑧工模表/塑胶标签单;塑胶库存月报表;⑪原料仓库其余;⑫原料报表。
