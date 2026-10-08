# 塑胶物料资料(塑胶模块 P0 地基) · 2026-06-25

## 做了什么
启动**塑胶独立模块**(原兴信B 与 物料/辅料/原料 并列的一整套:塑胶采购⑦+塑胶仓库⑧+塑胶报表⑨,30+ 项)。用户展示「塑胶采购物料分析 + 塑胶物料单」两屏(属 P2),但塑胶模块在重建里**零表零数据零后端零实体**(遗留库 153 张表无一张塑胶表)。经 brainstorming 拆分为 **P0地基→P1塑胶BOM→P2采购两屏→P3仓库→P4报表**,本次完成 **P0:塑胶物料资料主数据**。

照物料侧 `物料资料` 纵切克隆,换独立表 `塑胶物料资料`(= 物料资料字段 + **仓位号**)。

- **数据模型**:新表 `塑胶物料资料`(`db/15_plastic_material_master.sql`,镜像物料资料 + `仓位号`),EF 实体 `塑胶物料资料.cs` + DbContext DbSet。
- **后端**:增删改白嫖泛型 `PlasticMaterialController : MasterCrudController<塑胶物料资料>`(`api/master/plastic-materials`,零新基础设施);左树+右表只读 `PlasticMaterialMasterService/Controller`(`api/plastic-material-master`,categories 去重计数 + list 分类/关键词/分页 + **单价权限脱敏**)。
- **前端**:`PlasticMaterialMasterPage`(`/plastic-material-master`)克隆 `MaterialMasterPage` 加 **仓位号** 列/表单;菜单 ⑧塑胶仓库「塑胶物料资料」占位项落地。
- **权限**:`MenuCatalog` 加 `("塑胶仓储","塑胶物料资料")`;`db/seed_plastic_perms.sql` 给 admin 授 9 位。

## 关键决策
- **独立表**(非复用物料资料):用户选「完整搭塑胶独立模块」,塑胶后续单据/库存均走塑胶表系。
- **字段 = 物料资料 + 仓位号**:无塑胶物料资料表单截图,用户确认镜像物料资料加塑胶特有库位字段。
- **分类来源**:左树取 `塑胶物料资料.物料类别` 去重,不另建塑胶物料类别表(YAGNI)。

## 执行方式
brainstorming → spec(`docs/superpowers/specs/2026-06-25-p0-plastic-material-master-design.md`)→ writing-plans(`docs/superpowers/plans/2026-06-25-p0-plastic-material-master.md`)→ **subagent-driven**(每任务派实现子代理,Task3/6 另派独立 spec 审查,合并前 opus 全分支终审 = READY TO MERGE)。

## 测试 / 验证
- 后端 `PlasticMaterialMasterDbTests`×4(categories 去重计数、list 分类过滤+仓位号回显、关键词过滤、无过滤含无类别)。全量 **后端 332**(328+4)/**前端 54** 全过、tsc 干净、build ✓。
- 冒烟:登录后 `GET categories/list` 200、`POST /api/master/plastic-materials` 201(仓位号=Z-99/单价回显)、create 后 list+categories 正确。
- lint:新前端文件仅触发与克隆源 `MaterialMasterPage` 相同的 `set-state-in-effect` 基线惯例,无新偏差。

## 合并
分支 `feat-plastic-material-master`(6 提交)→ `--no-ff` 合并 master `946cab8`,分支已删。

## 下一步(塑胶模块路线)
P1 塑胶BOM(塑胶物料设置)→ P2 塑胶采购分析+塑胶物料单(用户最初展示的两屏)→ P3 塑胶仓库单据 → P4 塑胶报表。
