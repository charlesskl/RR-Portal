# 加工厂资料增强(左分类树 + 传真)· 2026-06-29

## 做了什么
把 加工厂资料 从通用配置驱动平铺页升级为**左「加工厂类别」分类树 + 右加工厂资料表**(镜像物料资料 MaterialMasterPage),并补 **传真** 列。
- **后端**:① `加工厂资料.cs` 实体加 `[Column("传真")] 传真`(**DB 列已存在 db/01·无迁移**)。② 新 `Features/Materials/FactoryMaster/`(镜像 MaterialMaster):`api/factory-master`·`GET /categories`(`SELECT 加工厂类别 AS 类别, COUNT(*) 数量 GROUP BY 加工厂类别`)+ `GET ?类别=&keyword=&page=&size=`(SELECT 11 列含传真·WHERE 加工厂类别/keyword[编号/名称/联系人]·分页 OFFSET/FETCH)·菜单"加工厂资料"。DI `AddScoped` 注册。CRUD 仍走现成 `MasterCrudController<加工厂资料>`(实体加传真后增改自动含)。
- **前端**:新 `FactoryMasterPage`(克隆 MaterialMasterPage·**去价格/库存**):左 加工厂类别 Tree(+全部节点)+ 右表(编号/名称/类别/联系人/手机/电话/**传真**/联系地址/付款方式/备注)+ 新增/修改弹窗(含传真)/删除走 `masterApi("factories")`(create/update(ID)/remove(ID))+ 关键词+分页+类别过滤。`api/factoryMaster.ts`。`MasterRouter` 把 加工厂资料 特例路由到 FactoryMasterPage(cfg 查找前·`/master/加工厂资料` 不变·其余 master cfg 驱动不动)。

## 决策(AskUserQuestion)
增强:加左侧加工厂类别分类树 + 补传真列(镜像物料资料)。

## 执行(subagent-driven)
brainstorming(探明 传真 DB 列已存在仅实体未映射·MaterialMaster 为模板·MasterRouter 特例路由)→ spec → plan → 子代理 Task1 后端(385·传真无迁移·FactoryMaster 镜像·DI AddScoped·PagedResult=MasterData 命名空间)/Task2 前端(54·去价格·CRUD 走 masterApi("factories")·MasterRouter 特例)/Task3 冒烟+终审+合并。**opus 全分支终审 = READY TO MERGE**(8项·传真无迁移映射·categories/list SQL·MasterRouter 特例不破坏其余 master·CRUD 复用 MasterCrudController 自动含传真·零价格泄漏)。

## 测试 / 验证
- 后端 `FactoryMasterServiceDbTests`×4(种 2 加工厂[类A 带传真 F1·类B] → categories 含类A/类B·ListAsync 类别过滤[传真/联系人回读]·keyword·不存在类别 Total 0)。全量 **后端 385**(+4)/前端 54、tsc 干净。
- **HTTP 冒烟全绿**:categories 类A=1/类B=1·`?类别=FSMK-A` 传真 FX-1/联系人带出·keyword 命中。

## 合并
分支 `feat-factory-master-tree`(2 提交)→ `--no-ff` 合并 master `429e6bf`,分支已删。9 文件 +387。

## 教训/记录
- 主数据加左分类树=镜像 MaterialMaster(后端 categories[GROUP BY 类别 COUNT]+过滤列表·前端 MaterialMasterPage 左树右表)+ MasterRouter 特例路由(cfg 查找前 `if(decoded===菜单) return <专用页/>`),不动其余 cfg 驱动 master。
- 列已在 DB 仅实体未映射时:实体加 `[Column]` 即可·无迁移·MasterCrudController CRUD 自动含新列。
- 遗留 nit(非阻断):configs.ts 仍有 加工厂资料 条目(路由已被特例拦截·resource"factories"仍供 CRUD·无害);搜索 placeholder 提 电话 但后端 LIKE 未含(仅文案)。

## 下一步
⑦塑胶采购余下占位(塑胶物料设置/塑胶进度明细表/塑胶物料进出汇总);⑩发外加工其余;塑胶库存月报表;⑧工模表/塑胶标签单。
