# 来料物料资料：类别树层级 + 物料编号自动生成

日期：2026-07-28
对应缺口：`docs/gap-analysis-old-erp-flows.md` 第一节「来料物料资料（物料档案）」——类别单层扁平无同级/子级、物料编号必填手输。

## 类别树数据结构设计（决策）

- 不加列、不写 db 脚本：**复用 `物料类别` 主数据表现有的 `类别` 列作为父级引用**（该列此前无人使用）。父级值指向父类别的 `编号`（兼容按 `名称` 匹配）。因此 `db/41_*` 脚本未创建（39/40 为并行任务占用，41 留空）。
- `GET /api/material-master/categories` 仍返回**扁平列表**（不改为嵌套树），节点增加两个字段：
  - `编号`：主数据行编号（空时回填为名称）；仅存在于物料行、主数据表没有的类别为 `null`。
  - `父级`：父类别编号（构建时已规范化——按名称匹配的也转成父节点编号；悬空/自引用 → null 即顶级）。
  - `类别`/`数量` 含义不变：类别=过滤值（名称），数量=该类直接物料数。
- 兼容性：主数据表为空时行为与旧版完全一致（全部是物料行自带的顶级类别）。其余约 10 个消费 `categories()` 的页面（采购/盘点/标签查询等）只读 `类别`/`数量`，不受影响。
- 前端 `MaterialMasterPage` 按 `父级` 组 antd Tree，数据结构支持多层，UI 两层够用。
- 选父级过滤含子级：`GET /api/material-master?类别=X&含子级=true`，后端 `MaterialCategoryTree.SubtreeKeys` 从根类别 BFS（逐层扫描、环安全）展开该类及后代的 名称+编号，`物料类别 IN @cats` 过滤；`含子级=false` 时仍是精确匹配。

## 编号生成规则（决策）

- 旧说明书只要求「选中物料类别后添加行，编号自动生成」，未给规则；现有种子数据形如 `MM001`。
- 采用 **类别前缀 + 递增序号**：前缀取 类别主数据 `编号` → 类别名 → 默认 `M`（超长截断至 14 字符，列宽 nvarchar(20)）；序号 = 现有同前缀编号中「前缀+纯数字」的最大序号 +1，宽度跟随现有最大编号（至少 3 位）。无前缀匹配编号时从 `前缀+001` 开始。
- 并发安全：**不走 DocumentNumber 单号引擎**（其格式为 前缀+日期+流水，物料编号无日期段，不适合）；参照其行锁思路，保存兜底路径用 `sp_getapplock` 会话级排他锁串行化「取号+插入」，保证并发下生成号唯一。GET next-code 仅为预填，不作并发保证。

## API

```
GET  /api/material-master/categories            物料资料·打开  → 扁平节点[{编号,类别,数量,父级}]
GET  /api/material-master?类别=&含子级=&keyword=&page=&size=&onlyStock=   物料资料·打开
GET  /api/material-master/next-code?类别=       物料资料·保存  → {编号}
POST /api/material-master                       物料资料·保存  新增；物料编号为空自动生成，审计 物料资料·新增
```

- 通用 MasterCrud（`/api/master/materials`）未动；编辑/删除仍走它；保存兜底做在 MaterialMaster 专用层（`CreateWithGeneratedCodeAsync`）。
- 前端类别「新增同级/子类别」走既有 `api/master/material-categories` 通用 CRUD（权限 `物料类别·保存`），新建行 `编号=名称=输入名`、`类别=父类别编号`。

## 变更清单

**后端**
- `src/ErpApi/Features/Materials/MaterialMaster/MaterialMasterDtos.cs`：`MaterialCategoryNode` 增加 `编号`/`父级`。
- `src/ErpApi/Features/Materials/MaterialMaster/MaterialCategoryTree.cs`（新）：纯函数树构建 `Build` + 子树展开 `SubtreeKeys`（不依赖 DB）。
- `src/ErpApi/Features/Materials/MaterialMaster/MaterialCodeGenerator.cs`（新）：纯函数 `NormalizePrefix`/`Next`。
- `src/ErpApi/Features/Materials/MaterialMaster/MaterialMasterService.cs`：`CategoriesAsync` 改为主数据树+物料自带类别；`ListAsync` 加 `含子级`；新增 `NextCodeAsync`、`CreateWithGeneratedCodeAsync`（applock 兜底）。
- `src/ErpApi/Features/Materials/MaterialMaster/MaterialMasterController.cs`：List 加 `含子级`；新增 GET next-code、POST create（含审计）。

**前端**
- `web/src/api/materialMaster.ts`：节点类型加 `编号`/`父级`；`list` 加 `含子级`；新增 `nextCode`/`create`。
- `web/src/pages/materials/MaterialMasterPage.tsx`：左树按 `父级` 组层级 Tree；「新增同级类别」「新增子类别」按钮（`物料类别·保存` 权限）；选中父级节点右表含子级物料；新增物料自动调 next-code 预填编号（可改、可留空），创建走 `POST /api/material-master` 由后端兜底生成。

**测试**
- `tests/ErpApi.Tests/MaterialMasterTreeAndCodeTests.cs`（新，纯单元 11 例）：树构建（父级按编号/名称、悬空/自引、物料自带类别、去重）、SubtreeKeys（多层、环安全）、Next（递增/非数字后缀/宽度/空前缀/大小写）、NormalizePrefix。
- `tests/ErpApi.Tests/MaterialMasterDbTests.cs`：新增 4 例（树结构+物料自带类别、含子级过滤、next-code 两种前缀、创建生成唯一号），依赖 ERP_TEST_DB。
- `tests/ErpApi.Tests/MaterialMasterApiTests.cs`：新增 2 例（next-code 无保存权限 403、POST 空编号自动生成），依赖 ERP_TEST_DB。

## 验证

- `dotnet build src/ErpApi`：通过，0 警告 0 错误。
- `dotnet test tests/ErpApi.Tests --filter FullyQualifiedName~MaterialMaster`：通过 13 / 跳过 20 / 失败 0（跳过为未设 ERP_TEST_DB 的 DB 集成测试，属正常）。
- `cd web && npx tsc -b`：通过。
- `cd web && npx vitest run`：236 通过 / 16 失败，失败全部在 `src/__tests__/semiFinishedLabelOrderPage.test.ts`（半成品标签单，不 import 本次改动文件，为并行任务在制品导致的既有失败，与本改动无关）。

## 备注 / 后续

- 以物料行自带类别（无 `编号`）为父级「新增子类别」时，父级引用按名称写入 `类别` 列，树构建按名称匹配同样生效；但主数据行的父级若指向未入主数据的类别名，会被当作悬空父级挂到顶级，建议先把类别建进主数据再挂子级。
- DB 集成测试（含 applock 并发路径）需在有 ERP_TEST_DB 的环境跑一次。
