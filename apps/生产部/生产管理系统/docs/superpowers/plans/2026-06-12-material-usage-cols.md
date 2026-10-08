# 退料单/领料单录入行补列(生产单号/款号/材料/备注)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把领料单、退料单录入行表补齐到与原系统一致的列(`生产单号 / 款号 / 材料 / 备注`),并让 `生产单号 / 款号` 持久化回环;采购入仓/采购退仓不受影响。

**Architecture:** 零 DB 迁移(`领料明细单`/`退料明细单` 已含 `生产单号`/`款号` 列)。后端两个 service 的明细 INSERT/SELECT 各补两列;前端共用组件 `MaterialLineTable` 加 `usageCols` 开关,开启时追加 4 列;`materialDocConfigs` 给领料/退料打开关。`材料 = 物料类别`(全系统既有约定),无新字段。

**Tech Stack:** 后端 .NET / Dapper / xUnit(`[SkippableFact]`,需 `ERP_TEST_DB`);前端 React 19 + antd 6 + Vite + vitest(纯逻辑测试)。

依据 spec:`docs/superpowers/specs/2026-06-12-material-usage-cols-design.md`

---

## Task 1: 后端退料单持久化 生产单号/款号(TDD)

**Files:**
- Test: `tests/ErpApi.Tests/MaterialReturnServiceDbTests.cs`
- Modify: `src/ErpApi/Features/Materials/MaterialReturn/MaterialReturnService.cs:34-38`(明细 INSERT)与 `:69-70`(GetAsync 明细 SELECT)

- [ ] **Step 1: 加失败测试**

在 `MaterialReturnServiceDbTests.cs` 的 `Create_rejects_empty_lines` 之前插入:

```csharp
    [SkippableFact]
    public async Task Create_persists_生产单号_款号()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        P3TestData.Seed(c);
        var dto = Dto();
        dto.明细[0].生产单号 = "MO-2026-001";
        dto.明细[0].款号 = "K123";
        var 单号 = await Svc().CreateAsync(dto, "tester");
        try
        {
            var detail = await Svc().GetAsync(单号);
            var line = Assert.Single(detail!.明细);
            Assert.Equal("MO-2026-001", line.生产单号);
            Assert.Equal("K123", line.款号);
        }
        finally
        {
            c.Execute("DELETE FROM [退料明细单] WHERE [单号]=@单号", new { 单号 });
            c.Execute("DELETE FROM [退料单] WHERE [单号]=@单号", new { 单号 });
            P3TestData.Cleanup(c);
        }
    }
```

- [ ] **Step 2: 跑测试确认失败**

Run: `dotnet test tests/ErpApi.Tests --filter "FullyQualifiedName~MaterialReturnServiceDbTests.Create_persists"`
Expected: FAIL —— `生产单号`/`款号` 回显为 null(service 未持久化)。
（若本机未设 `ERP_TEST_DB`,该用例 Skip;此时改为人工核对代码,或在有 DB 环境复跑。)

- [ ] **Step 3: 改 INSERT**

把 `MaterialReturnService.cs` 明细 INSERT(约 34–38 行)整段替换为:

```csharp
        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"
INSERT INTO [退料明细单]([单号],[日期],[仓库],[物料类别],[物料编号],[物料名称],[规格],[颜色],[单位],[数量],[单价],[金额],[备注],[生产单号],[款号])
VALUES(@单号,@日期,@仓库,@物料类别,@物料编号,@物料名称,@规格,@颜色,@单位,@数量,@单价,@金额,@备注,@生产单号,@款号)",
                new { 单号, 日期 = now, dto.仓库, l.物料类别, l.物料编号, l.物料名称, l.规格, l.颜色, l.单位,
                      l.数量, 单价 = l.单价 ?? 0, 金额 = l.数量 * (l.单价 ?? 0), l.备注, l.生产单号, l.款号 }, tx);
```

- [ ] **Step 4: 改 GetAsync 明细 SELECT**

把 GetAsync 中第二段 SELECT(约 69–70 行)替换为:

```csharp
SELECT [ID],[物料编号],[物料名称],[物料类别],[规格],[颜色],[单位],[数量],[单价],[金额],[备注],[生产单号],[款号]
FROM [退料明细单] WHERE [单号]=@单号 ORDER BY [ID];",
```

- [ ] **Step 5: 跑测试确认通过**

Run: `dotnet test tests/ErpApi.Tests --filter "FullyQualifiedName~MaterialReturnServiceDbTests"`
Expected: PASS（有 DB 时全绿；无 DB 时 Skip）。

- [ ] **Step 6: 提交**

```bash
git add tests/ErpApi.Tests/MaterialReturnServiceDbTests.cs src/ErpApi/Features/Materials/MaterialReturn/MaterialReturnService.cs
git commit -m "feat(退料): 明细持久化生产单号/款号(INSERT+SELECT)+往返测试"
```

---

## Task 2: 后端领料单持久化 生产单号/款号(TDD)

**Files:**
- Test: `tests/ErpApi.Tests/MaterialIssueServiceDbTests.cs`
- Modify: `src/ErpApi/Features/Materials/MaterialIssue/MaterialIssueService.cs:34-38`(明细 INSERT)与 `:69-70`(GetAsync 明细 SELECT)

- [ ] **Step 1: 加失败测试**

在 `MaterialIssueServiceDbTests.cs` 的 `Create_rejects_empty_lines` 之前插入:

```csharp
    [SkippableFact]
    public async Task Create_persists_生产单号_款号()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        P3TestData.Seed(c);
        var dto = Dto();
        dto.明细[0].生产单号 = "MO-2026-001";
        dto.明细[0].款号 = "K123";
        var 单号 = await Svc().CreateAsync(dto, "tester");
        try
        {
            var detail = await Svc().GetAsync(单号);
            var line = Assert.Single(detail!.明细);
            Assert.Equal("MO-2026-001", line.生产单号);
            Assert.Equal("K123", line.款号);
        }
        finally
        {
            c.Execute("DELETE FROM [领料明细单] WHERE [单号]=@单号", new { 单号 });
            c.Execute("DELETE FROM [领料单] WHERE [单号]=@单号", new { 单号 });
            P3TestData.Cleanup(c);
        }
    }
```

- [ ] **Step 2: 跑测试确认失败**

Run: `dotnet test tests/ErpApi.Tests --filter "FullyQualifiedName~MaterialIssueServiceDbTests.Create_persists"`
Expected: FAIL —— 回显为 null。

- [ ] **Step 3: 改 INSERT**

把 `MaterialIssueService.cs` 明细 INSERT(约 34–38 行)整段替换为:

```csharp
        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"
INSERT INTO [领料明细单]([单号],[日期],[仓库],[物料类别],[物料编号],[物料名称],[规格],[颜色],[单位],[数量],[单价],[金额],[备注],[生产单号],[款号])
VALUES(@单号,@日期,@仓库,@物料类别,@物料编号,@物料名称,@规格,@颜色,@单位,@数量,@单价,@金额,@备注,@生产单号,@款号)",
                new { 单号, 日期 = now, dto.仓库, l.物料类别, l.物料编号, l.物料名称, l.规格, l.颜色, l.单位,
                      l.数量, 单价 = l.单价 ?? 0, 金额 = l.数量 * (l.单价 ?? 0), l.备注, l.生产单号, l.款号 }, tx);
```

- [ ] **Step 4: 改 GetAsync 明细 SELECT**

把 GetAsync 中第二段 SELECT(约 69–70 行)替换为:

```csharp
SELECT [ID],[物料编号],[物料名称],[物料类别],[规格],[颜色],[单位],[数量],[单价],[金额],[备注],[生产单号],[款号]
FROM [领料明细单] WHERE [单号]=@单号 ORDER BY [ID];",
```

- [ ] **Step 5: 跑测试确认通过**

Run: `dotnet test tests/ErpApi.Tests --filter "FullyQualifiedName~MaterialIssueServiceDbTests"`
Expected: PASS（有 DB 时全绿；无 DB 时 Skip）。

- [ ] **Step 6: 提交**

```bash
git add tests/ErpApi.Tests/MaterialIssueServiceDbTests.cs src/ErpApi/Features/Materials/MaterialIssue/MaterialIssueService.cs
git commit -m "feat(领料): 明细持久化生产单号/款号(INSERT+SELECT)+往返测试"
```

---

## Task 3: 前端类型与配置(DocLine.备注 / usageCols 开关 / 透传)

**Files:**
- Modify: `web/src/utils/materialLines.ts:2-7`(DocLine 加 `备注`)
- Modify: `web/src/pages/materials/materialDocConfigs.ts`(接口加 `usageCols?`,两配置打开)
- Modify: `web/src/pages/materials/MaterialDocCreateDrawer.tsx:56-57`(透传 prop)

- [ ] **Step 1: DocLine 加 备注 字段**

`web/src/utils/materialLines.ts` 把 `DocLine` 接口(2–7 行)替换为:

```ts
export interface DocLine {
  物料编号?: string; 物料名称?: string; 物料类别?: string;
  规格?: string; 颜色?: string; 单位?: string;
  数量?: number; 单价?: number | null; 金额?: number | null;
  订单单号?: string; 生产单号?: string; 款号?: string; 备注?: string;
}
```

- [ ] **Step 2: 配置接口加 usageCols + 两单据打开**

`web/src/pages/materials/materialDocConfigs.ts`:在接口里 `orderPicker?` 行下方加一行:

```ts
  usageCols?: boolean;     // true=领料/退料,行表显示 生产单号/款号/材料/备注 列
```

并把 `material-issues`、`material-returns` 两项的首行分别改为(加 `usageCols: true`):

```ts
  "material-issues": {
    resource: "material-issues", menu: "领料单", title: "领料", usageCols: true,
```

```ts
  "material-returns": {
    resource: "material-returns", menu: "退料单", title: "退料", usageCols: true,
```

- [ ] **Step 3: Drawer 透传 usageCols**

`web/src/pages/materials/MaterialDocCreateDrawer.tsx` 把 `<MaterialLineTable .../>`(56–57 行)替换为:

```tsx
      <MaterialLineTable value={lines} onChange={setLines} hidePriceCols={priceHidden}
        enableOrderPicker={cfg.orderPicker} usageCols={cfg.usageCols} 供应商={供应商编号 as string | undefined} />
```

- [ ] **Step 4: 类型检查 + 现有测试**

Run: `cd web && npx tsc -b && npm test`
Expected: tsc 无错;vitest 全绿(此时 MaterialLineTable 还没用到 usageCols prop —— 见 Task 4,故本步 tsc 可能报 "usageCols 不是 MaterialLineTable 的属性"。若报该错,先做 Task 4 的 Step 1 加上 prop 声明再回跑;两任务可视为一并提交。)

> 注:为避免 tsc 中间态报错,**Task 3 与 Task 4 一起提交**(见 Task 4 Step 4)。本步仅用于确认 DocLine/config/drawer 三处改动语法正确。

---

## Task 4: 前端 MaterialLineTable 追加 usageCols 列

**Files:**
- Modify: `web/src/pages/materials/MaterialLineTable.tsx`

- [ ] **Step 1: 函数签名加 usageCols prop**

把组件签名的解构(11 行起)与 props 类型替换为:

```tsx
export default function MaterialLineTable({ value, onChange, hidePriceCols, enableOrderPicker, usageCols, 供应商 }: {
  value: DocLine[];
  onChange: Dispatch<SetStateAction<DocLine[]>>;
  hidePriceCols: boolean;
  enableOrderPicker?: boolean;
  usageCols?: boolean;
  供应商?: string;
}) {
```

- [ ] **Step 2: 在 columns 数组里插入 4 列**

在 `const columns = [` 之后、现有 `...(enableOrderPicker ? [...] : [])` 之前,插入 生产单号/款号 两列(领料/退料专用,排在最前):

```tsx
    ...(usageCols ? [
      {
        title: "生产单号", dataIndex: "生产单号", width: 140,
        render: (_: unknown, r: DocLine, i: number) => (
          <Input style={{ width: 128 }} value={r.生产单号 ?? ""} onChange={e => setLine(i, { 生产单号: e.target.value })} />
        ),
      },
      {
        title: "款号", dataIndex: "款号", width: 120,
        render: (_: unknown, r: DocLine, i: number) => (
          <Input style={{ width: 108 }} value={r.款号 ?? ""} onChange={e => setLine(i, { 款号: e.target.value })} />
        ),
      },
    ] : []),
```

在「规格」列对象之后插入 材料(只读 物料类别)列:

```tsx
    ...(usageCols ? [
      { title: "材料", dataIndex: "物料类别", width: 90, render: (v: string) => v ?? "" },
    ] : []),
```

在价格列块 `...(hidePriceCols ? [] : [...])` 之后、操作列 `{ title: "", key: "_op" ... }` 之前插入 备注列:

```tsx
    ...(usageCols ? [
      {
        title: "备注", dataIndex: "备注", width: 140,
        render: (_: unknown, r: DocLine, i: number) => (
          <Input style={{ width: 128 }} value={r.备注 ?? ""} onChange={e => setLine(i, { 备注: e.target.value })} />
        ),
      },
    ] : []),
```

最终领料/退料列序:`生产单号 / 款号 / 物料 / 规格 / 材料 / 颜色 / 单位 / 数量 / [单价/金额] / 备注 / 删除`。采购入仓/采购退仓(`usageCols` 未传)列序不变。

- [ ] **Step 3: 类型检查 + 现有测试 + lint**

Run: `cd web && npx tsc -b && npm run lint && npm test`
Expected: tsc 无错;eslint 无错;vitest 全绿(`materialDocs.test.ts` 等不受影响)。

- [ ] **Step 4: 提交(Task 3 + Task 4 合并提交)**

```bash
git add web/src/utils/materialLines.ts web/src/pages/materials/materialDocConfigs.ts web/src/pages/materials/MaterialDocCreateDrawer.tsx web/src/pages/materials/MaterialLineTable.tsx
git commit -m "feat(领料/退料): 录入行补列 生产单号/款号/材料/备注(usageCols开关,采购单据不变)"
```

---

## Task 5: 全量验证 + 采购单据回归

**Files:** 无改动,仅验证。

- [ ] **Step 1: 后端全套**

Run: `dotnet test tests/ErpApi.Tests`
Expected: 全绿(有 DB);新加两往返用例通过。

- [ ] **Step 2: 前端全套 + 构建**

Run: `cd web && npm test && npm run build`
Expected: vitest 全绿;`tsc -b && vite build` 成功。

- [ ] **Step 3: 人工核验(run skill 或手动)**

启动后端 5000 + 前端 5173,以 admin/admin123 登录:
1. 仓库管理 → 退料单 → 新建退料单:行表出现 `生产单号 / 款号 / 物料 / 规格 / 材料 / 颜色 / 单位 / 数量 / 备注` 列序;手填 生产单号/款号、选物料(材料列自动带出 物料类别)、填备注 → 保存 → 重新打开该单,生产单号/款号 值保留。
2. 领料单:同上。
3. 采购入仓单、采购退仓单:行表与改动前一致(款号仍是「选订单」链接,无 生产单号/材料/备注 列)。

- [ ] **Step 4: 收尾**

确认工作树干净、提交完整。是否 merge 到 master / 删分支 / 重启服务 由 `finishing-a-development-branch` 决定。

---

## Self-Review

**Spec 覆盖:** 生产单号/款号(Task1/2 后端 + Task4 前端列)✓;材料=物料类别只读列(Task4)✓;备注列(Task3 DocLine + Task4 列)✓;usageCols 仅领料/退料、采购不变(Task3 配置 + Task4 条件列 + Task5.3 回归)✓;零 DB 迁移(用既有 生产单号/款号 列)✓;装配采购/电脑单号/合同号/查询报表 不做 ✓。

**占位符扫描:** 无 TBD/TODO;每个改码步骤均含完整代码。

**类型一致:** `usageCols?: boolean` 在 config 接口、MaterialLineTable props、drawer 透传三处一致;`DocLine.备注?: string` 与列 render 绑定一致;后端参数 `l.生产单号/l.款号/l.备注` 与 DTO 字段一致。

**已知约束:** 后端测试为 `[SkippableFact]`,无 `ERP_TEST_DB` 时 Skip;前端无 DOM 渲染测试(项目约定),列渲染靠 tsc + 人工核验。
