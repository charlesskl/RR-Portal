# 设计 · 退料单/领料单录入行补列(生产单号/款号/材料/备注)· 2026-06-12

## 背景

照原系统 bmain.exe 截图复刻系列的延续。原系统「退料单」「领料单」录入单的行表列序为:

```
装配采购 / 生产单号 / 款号 / 物料编号 / 物料名称 / 规格 / 材料 / 颜色 / 单位 / 数量 / 备注
```

我们现有录入行表(`MaterialLineTable`,四单据 采购入仓/采购退仓/领料/退料 共用)只有:

```
物料(编号+名称) / 规格 / 颜色 / 单位 / 数量 / [单价/金额] / 删除
```

缺 `生产单号 / 款号 / 材料 / 备注` 四列的显示。用户要求把退料单(及领料单)补齐到与原系统一致。

## Scope 决策

- **本次只动 领料单、退料单**;刚合并的 采购入仓单/采购退仓单 不受影响。
- `装配采购` 列 + 工具栏「装配采购清单」按钮 **延后** —— 其数据源是「外发装配」模块(`装配加工采购单`),该模块尚未建。等外发装配建好后,再由「装配采购清单」选择器回填本设计补的 `生产单号/款号` 列。
- `生产单号 / 款号` 本次为**手填可编辑文本**,不接任何选择器(生产单选择器、装配采购清单均不做)。
- 不做:电脑单号、合同号/客户款号(原 grid 未展示)、查询报表。

## 现状事实(已核实)

- `领料明细单`、`退料明细单` 两表**已有** `生产单号 nvarchar(30)`、`款号 nvarchar(40)` 列 → **零 DB 迁移**。
- `MaterialDocLineDto`(后端)、`DocLine`(前端 `utils/materialLines.ts`)**已有** `生产单号`、`款号` 字段;`DocLine` **缺** `备注` 字段。
- 全系统约定:**「材料」= `物料类别`**(见 `BomSetupPage.tsx:40`、`MaterialPicker.tsx:43`),无需新建字段。
- `物料类别`、`备注` 已在明细 INSERT 中持久化;只是 `MaterialLineTable` 未把它们做成列。
- `生产单号`、`款号` 当前 service 的明细 INSERT / GetAsync 明细 SELECT **未带**。

## 改动清单

### 1. 前端 `web/src/utils/materialLines.ts`
- `DocLine` 接口补 `备注?: string`(行级备注前端目前带不了)。

### 2. 前端 `web/src/pages/materials/MaterialLineTable.tsx`
- 新增可选 prop `usageCols?: boolean`(领料/退料传 `true`)。
- 当 `usageCols` 为真时,在「物料」列**之前**插入 `生产单号`、`款号` 两列(可编辑 `Input`,分别绑 `l.生产单号`、`l.款号`);在「规格」列**之后**插入 `材料` 列(只读,显示 `l.物料类别`);在「数量/单价金额」列**之后**、删除列之前插入 `备注` 列(可编辑 `Input`,绑 `l.备注`)。
- 最终领料/退料行表列序:`生产单号 / 款号 / 物料 / 规格 / 材料 / 颜色 / 单位 / 数量 / [单价/金额] / 备注 / 删除`。
- `usageCols` 与现有 `enableOrderPicker` 互斥(采购单据用 orderPicker,领料/退料用 usageCols),不同时为真。采购入仓/采购退仓不传 `usageCols`,行为完全不变。

### 3. 前端 `web/src/pages/materials/materialDocConfigs.ts`
- `MaterialDocCfg` 接口加 `usageCols?: boolean`。
- `material-issues`、`material-returns` 两项配置加 `usageCols: true`。
- 在调用 `MaterialLineTable` 的地方(`MaterialDocCreateDrawer`)把 `cfg.usageCols` 透传为 `usageCols` prop。

### 4. 后端 `MaterialReturnService.cs` + `MaterialIssueService.cs`
- `CreateAsync` 明细 INSERT 的列与参数补 `[生产单号]`、`[款号]`(取自 `l.生产单号`、`l.款号`)。
- `GetAsync` 明细 SELECT 补 `[生产单号]`、`[款号]`(DTO 已有字段,回显闭环)。
- 单头、库存方向、审核等其余逻辑不变。

## 数据流

新建领料/退料 → 录入行手填 `生产单号/款号`、选物料带出 `物料类别(材料)`、填 `备注` → 提交 → service INSERT 持久化 `生产单号/款号/物料类别/备注` → 打开单据 GetAsync 回显全部列 → 列序与原系统一致。

## 测试

- 后端 `MaterialReturnServiceDbTests`、`MaterialIssueServiceDbTests` 各加 1 个往返用例:创建含 `生产单号/款号` 的明细 → `GetAsync` 回显两字段一致。
- 前端:本项目约定前端测试为纯逻辑 `vitest`(`src/__tests__/*.test.ts`,无 testing-library/jsdom DOM 渲染设施)。故**不引入** DOM 渲染测试(否则属脚手架越界)。列新增由 `tsc -b` 类型检查 + 手动运行界面核验;数据回环由上述后端往返测试覆盖;现有 `materialDocs.test.ts` 等全套保持绿。

## 验收

- 领料单、退料单录入抽屉行表显示 `生产单号 / 款号 / 物料 / 规格 / 材料 / 颜色 / 单位 / 数量 / 备注` 列序。
- 手填 生产单号/款号 → 保存 → 重新打开,值保留。
- 采购入仓单/采购退仓单录入界面与改动前**逐像素一致**。
- 后端测试、前端测试全过。
