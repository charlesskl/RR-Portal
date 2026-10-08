# 塑胶共用物料表(塑胶模块 P1) · 2026-06-25

## 做了什么
塑胶模块 P1。**重要范围澄清**:原系统没有独立的"塑胶物料设置/BOM"表单;塑胶物料单(按工序/工模列塑胶用料)打开时**从「塑胶共用物料表」自动带出再改**。故塑胶模块路线修正:跳过原设想的"塑胶BOM设置",P1 改为建 **塑胶共用物料表**(塑胶物料单的带出源·准BOM)。

塑胶共用物料表 = **按塑胶货号的塑胶注塑BOM**,每行一种塑胶料(引用 P0 塑胶物料资料),带注塑专属参数(整啤净重/原胶件单净重/整啤模腔数/套数/用量)+ 加工信息。真实19列来自用户截图。

- **数据模型**:新表 `塑胶共用物料表`(`db/16_plastic_common_materials.sql`,19列+ID),EF 实体 + DbSet。
- **后端**:增删改泛型 `MasterCrudController<塑胶共用物料表>`(`api/master/plastic-common-materials`);过滤列表只读 `PlasticCommonMaterialService/Controller`(`api/plastic-common-materials`,按 客户/塑胶货号/工模编号/关键词/审核情况 过滤分页,**加工单价**按单价权限脱敏,审核情况 ApprovalFilter 作用于 调整审核 列)。
- **前端**:`PlasticCommonMaterialPage`(`/plastic-common-materials`)顶部筛选 + 19列表 + 新增/编辑 Modal;**塑胶物料选择器** `PlasticMaterialPicker`(克隆 MaterialPicker 换 P0 数据源)→ 选料回填 物料编号/物料名称/颜色(P0→P1 关联)。菜单 ⑧塑胶仓库占位落地。
- **权限**:`MenuCatalog` 加 `("塑胶仓储","塑胶共用物料表")` + `db/seed_plastic_common_perms.sql`。

## 范围决策(YAGNI)
- 键 = 塑胶货号;CRUD 扁平列表+逐行增删改(非 load+replace);注塑参数/用量 = 可录字段(不做计算公式);调整审核 = 存储字段+仅作过滤(无审核工作流)。

## 执行
brainstorming(澄清"无BOM设置·带出源=共用物料表")→ spec(`2026-06-25-p1-plastic-common-materials-design.md`)→ writing-plans → **subagent-driven**(每任务子代理,Task3/6 独立 spec 审查,opus 全分支终审=READY TO MERGE)。

## 测试 / 验证
- 后端 `PlasticCommonMaterialDbTests`×3(塑胶货号过滤、客户+关键词过滤、审核情况已/未审核)。全量 **后端 335**(332+3)/前端 54 全过、tsc 干净、build ✓。
- 冒烟:登录后 list 200、`POST /api/master/plastic-common-materials` 201(塑胶货号/加工单价/用量/物料编号 回显)、keyword 过滤 200。
- 终审确认五层列映射精确(DDL19/实体19/DTO20/SELECT20/TS20)、防注入、脱敏与审核过滤双查询一致。

## 合并
分支 `feat-plastic-common-materials`(6 提交)→ `--no-ff` 合并 master `31698dc`,分支已删。

## 下一步
**P2 = 塑胶物料单 + 塑胶采购分析**(用户最初两屏):塑胶采购分析列生产单 → 点行开塑胶物料单(按生产单货号从塑胶共用物料表带出,可改),引用 P0/P1。
