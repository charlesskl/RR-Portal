# 物料资料（左类别树 + 右物料表）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把仓库管理「物料资料」做成左侧物料分类树 + 右侧物料网格：点分类筛右侧物料，支持新增/编辑/删除；替换现有通用 CRUD 页。

**Architecture:** 新增聚焦只读端点 `MaterialMasterController`（分类树 `GET /api/material-master/categories` + 按类别过滤分页 `GET /api/material-master`，Dapper，价格脱敏在控制器落实）；增删改复用现有 `MaterialController`（`/api/master/materials`）。前端新页 `MaterialMasterPage`（antd Tree + Table + 弹窗表单），菜单「物料资料」改指新页。依据 `docs/superpowers/specs/2026-06-11-material-master-tree-design.md`。

**Tech Stack:** .NET 8 ASP.NET Core, Dapper, SQL Server LocalDB (erp/erp_test, Chinese_PRC_CI_AS), xUnit + Xunit.SkippableFact + WebApplicationFactory, React 18 + TS + Vite + Ant Design v6。

---

## 前置约定

- 工作目录 `D:\WebpageERP`，已在分支 `feat-material-master`。Windows PowerShell；`dotnet` 不在 PATH 时刷新：`$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")`。
- DB 测试环境变量（shell 为空时）：`$env:ERP_TEST_DB = [Environment]::GetEnvironmentVariable("ERP_TEST_DB","User")`、`$env:ERP_JWT_KEY = [Environment]::GetEnvironmentVariable("ERP_JWT_KEY","User")`。
- 跑后端测试：`dotnet test`；单类 `dotnet test --filter "FullyQualifiedName~MaterialMasterDbTests"`。前端：`npm --prefix web run build`、`npm --prefix web run test`。
- 提交规范：commit 末尾 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。git 报 LF→CRLF 警告正常。
- 权限：本页用菜单「物料资料」（admin 已授权，无需新增 seed）。
- 现有可复用件：`ISqlConnectionFactory.Create()`；`IPermissionService.HasAsync(user, "物料资料", PermissionAction)`；`PagedResult<T>(IReadOnlyList<T> Items, int Total)`（namespace `ErpApi.Features.MasterData`）；通用写端点 `MaterialController` at `/api/master/materials`（Create/Update/Delete/Get，已含权限+审计+价格脱敏）；前端 `masterApi("materials")`（create/update/remove/get）、`can(perms, menu, action)`、`hidePrice(perms, menu)`、`usePerms()`。参考控制器范本 `PurchaseOrderController`（权限门禁 + 价格脱敏写法）。
- **关键事实**：实体 `物料资料`（`src/ErpApi/Data/Entities/物料资料.cs`）只映射 物料类别/物料编号/物料名称/规格/颜色/单位/单价[PriceField]/销售价[PriceField]/供应商编号/款号/货币/备注。表里还有 库存/最低库存/最高库存/供应商名称/客户/批号/条码号 等**未映射**列——新读端点用原生 SQL 可展示，但编辑表单（走实体 CRUD）只编辑实体映射字段，库存/最低/最高 在本页**只读展示**。

### `物料资料` 表列（`db/01_rebuild_schema.sql`）
物料类别, 条码号, 物料编号, 物料名称, 批号, 规格, 颜色, 单位, 客户, 单价, 销售价, 库存, 最低库存, 最高库存, 备注, 供应商编号, 供应商名称, 生产单号, 款号 …（ID 为 bigint identity 主键）

---

## 文件结构

```
src/ErpApi/Features/Materials/MaterialMaster/
├─ MaterialMasterDtos.cs        新:MaterialCategoryNode + MaterialRow
├─ MaterialMasterService.cs     新:CategoriesAsync + ListAsync (Dapper)
└─ MaterialMasterController.cs  新:GET categories + GET 列表(价格脱敏)
src/ErpApi/Program.cs           改:注册 MaterialMasterService

tests/ErpApi.Tests/
├─ MaterialMasterDbTests.cs     新:分类聚合 + 按类别/关键字过滤 + 分页
└─ MaterialMasterApiTests.cs    新:权限 403 + 价格脱敏 + 返回形状

web/src/
├─ api/materialMaster.ts        新:categories + list
├─ pages/materials/MaterialMasterPage.tsx  新:左Tree + 右Table + 增删改弹窗
├─ nav/menuTree.tsx             改:物料资料→/material-master
└─ App.tsx                      改:+/material-master 路由
```

---

## Task 1: 后端 MaterialMaster DTO + Service + DbTest

分类树聚合 + 按类别/关键字过滤分页。Dapper 只读。

**Files:**
- Create: `src/ErpApi/Features/Materials/MaterialMaster/MaterialMasterDtos.cs`, `src/ErpApi/Features/Materials/MaterialMaster/MaterialMasterService.cs`
- Modify: `src/ErpApi/Program.cs`
- Test: `tests/ErpApi.Tests/MaterialMasterDbTests.cs`

- [ ] **Step 1: 写 DTO**

Create `src/ErpApi/Features/Materials/MaterialMaster/MaterialMasterDtos.cs`:

```csharp
namespace ErpApi.Features.Materials.MaterialMaster;

// 左树节点：一个物料类别 + 该类物料数
public sealed class MaterialCategoryNode
{
    public string? 类别 { get; set; }
    public int 数量 { get; set; }
}

// 右网格行（展示用；库存/最低/最高/供应商名称 为只读展示列，实体未映射不可编辑）
public sealed class MaterialRow
{
    public long ID { get; set; }
    public string? 物料类别 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 销售价 { get; set; }
    public decimal? 库存 { get; set; }
    public decimal? 最低库存 { get; set; }
    public decimal? 最高库存 { get; set; }
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public string? 备注 { get; set; }
}
```

- [ ] **Step 2: 写失败的 DbTest**

Create `tests/ErpApi.Tests/MaterialMasterDbTests.cs`:

```csharp
using Dapper;
using ErpApi.Features.Materials.MaterialMaster;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class MaterialMasterDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private MaterialMasterService Svc() => new(Factory());

    // 分类「面料MM」2 个物料、「辅料MM」1 个、1 个无类别物料
    private static void Seed(SqlConnection c)
    {
        Cleanup(c);
        c.Execute(@"INSERT INTO [物料资料]([物料类别],[物料编号],[物料名称],[规格],[单位],[单价],[销售价],[库存],[最低库存],[供应商名称])
                    VALUES(N'面料MM',N'MM001',N'面料甲',N'规X',N'米',10,15,100,5,N'供A'),
                          (N'面料MM',N'MM002',N'面料乙',N'规Y',N'米',12,0,0,0,N'供A'),
                          (N'辅料MM',N'MM003',N'纽扣',N'规Z',N'粒',0.5,1,500,50,N'供B'),
                          (NULL,      N'MM999',N'无类别料',N'规W',N'个',1,2,0,0,N'供C')");
    }

    private static void Cleanup(SqlConnection c)
        => c.Execute("DELETE FROM [物料资料] WHERE [物料编号] IN (N'MM001',N'MM002',N'MM003',N'MM999')");

    [SkippableFact]
    public async Task Categories_groups_nonempty_with_counts()
    {
        using var c = fx.Open();
        Seed(c);
        try
        {
            var cats = await Svc().CategoriesAsync();
            // 只含本测试种入的两个分类(库里可能有其它分类，按名称取本测试的)
            var 面料 = cats.Single(x => x.类别 == "面料MM");
            var 辅料 = cats.Single(x => x.类别 == "辅料MM");
            Assert.Equal(2, 面料.数量);
            Assert.Equal(1, 辅料.数量);
            Assert.DoesNotContain(cats, x => x.类别 is null);   // 无类别不出现
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task List_filters_by_category()
    {
        using var c = fx.Open();
        Seed(c);
        try
        {
            var page = await Svc().ListAsync("面料MM", null, 1, 20);
            Assert.Equal(2, page.Total);
            Assert.All(page.Items, r => Assert.Equal("面料MM", r.物料类别));
            // 展示列含库存/供应商名称
            Assert.Contains(page.Items, r => r.物料编号 == "MM001" && r.库存 == 100m && r.供应商名称 == "供A");
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task List_filters_by_keyword_within_all()
    {
        using var c = fx.Open();
        Seed(c);
        try
        {
            var page = await Svc().ListAsync(null, "纽扣", 1, 20);
            var row = Assert.Single(page.Items);
            Assert.Equal("MM003", row.物料编号);
        }
        finally { Cleanup(c); }
    }
}
```

- [ ] **Step 3: 跑测试确认失败**

Run: `dotnet test --filter "FullyQualifiedName~MaterialMasterDbTests"`
Expected: FAIL（`MaterialMasterService` 不存在，编译错误）

- [ ] **Step 4: 实现 MaterialMasterService**

Create `src/ErpApi/Features/Materials/MaterialMaster/MaterialMasterService.cs`:

```csharp
using Dapper;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Materials.MaterialMaster;

// 物料资料左树 + 右表的只读查询。增删改复用 MaterialController(/api/master/materials)。
public sealed class MaterialMasterService(ISqlConnectionFactory factory)
{
    // 左树：物料上实际出现的非空分类 + 该类物料数
    public async Task<IReadOnlyList<MaterialCategoryNode>> CategoriesAsync()
    {
        using var c = factory.Create();
        var rows = await c.QueryAsync<MaterialCategoryNode>(@"
SELECT [物料类别] AS 类别, COUNT(*) AS 数量
FROM [物料资料]
WHERE [物料类别] IS NOT NULL AND LTRIM(RTRIM([物料类别])) <> ''
GROUP BY [物料类别]
ORDER BY [物料类别];");
        return rows.AsList();
    }

    // 右表：按精确分类(@类别 空=不过滤) + 关键字 过滤的分页
    public async Task<PagedResult<MaterialRow>> ListAsync(string? 类别, string? keyword, int page, int size)
    {
        if (page < 1) page = 1;
        if (size < 1 || size > 200) size = 20;
        var cat = string.IsNullOrWhiteSpace(类别) ? null : 类别.Trim();
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [物料资料]
WHERE (@cat IS NULL OR [物料类别] = @cat)
  AND (@kw IS NULL OR [物料编号] LIKE @kw OR [物料名称] LIKE @kw OR [规格] LIKE @kw OR [颜色] LIKE @kw OR [供应商名称] LIKE @kw);
SELECT [ID],[物料类别],[物料编号],[物料名称],[规格],[颜色],[单位],[单价],[销售价],[库存],[最低库存],[最高库存],[供应商编号],[供应商名称],[备注]
FROM [物料资料]
WHERE (@cat IS NULL OR [物料类别] = @cat)
  AND (@kw IS NULL OR [物料编号] LIKE @kw OR [物料名称] LIKE @kw OR [规格] LIKE @kw OR [颜色] LIKE @kw OR [供应商名称] LIKE @kw)
ORDER BY [物料编号] OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;",
            new { cat, kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<MaterialRow>()).AsList();
        return new PagedResult<MaterialRow>(items, total);
    }
}
```

- [ ] **Step 5: Program.cs 注册**

在 `src/ErpApi/Program.cs` 的 `// 业务` 区块追加：

```csharp
builder.Services.AddScoped<ErpApi.Features.Materials.MaterialMaster.MaterialMasterService>();
```

- [ ] **Step 6: 跑测试确认通过**

Run: `dotnet test --filter "FullyQualifiedName~MaterialMasterDbTests"`
Expected: PASS 3 个

- [ ] **Step 7: 全量回归 + 提交**

Run: `dotnet test`
Expected: 全部 PASS

```powershell
git add src/ErpApi/Features/Materials/MaterialMaster/MaterialMasterDtos.cs src/ErpApi/Features/Materials/MaterialMaster/MaterialMasterService.cs src/ErpApi/Program.cs tests/ErpApi.Tests/MaterialMasterDbTests.cs
git commit -m @'
feat(仓库管理): 物料资料左树+右表查询服务(distinct分类聚合+按类别/关键字过滤分页)+DbTest

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 2: 后端 MaterialMasterController（categories + 列表 + 价格脱敏）+ API 测试

**Files:**
- Create: `src/ErpApi/Features/Materials/MaterialMaster/MaterialMasterController.cs`
- Test: `tests/ErpApi.Tests/MaterialMasterApiTests.cs`

- [ ] **Step 1: 写失败的 API 测试**

Create `tests/ErpApi.Tests/MaterialMasterApiTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Dapper;
using ErpApi.Infrastructure.Security;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class MaterialMasterApiTests(DbFixture fx)
{
    private static IConfiguration JwtCfg() => new ConfigurationBuilder().AddInMemoryCollection(
        new Dictionary<string, string?>
        { ["Erp:Jwt:Issuer"] = "ErpApi", ["Erp:Jwt:Audience"] = "ErpClient", ["Erp:Jwt:ExpireMinutes"] = "60" }).Build();

    private WebApplicationFactory<Program> Factory()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        Environment.SetEnvironmentVariable("ERP_DB", fx.ConnectionString);
        Environment.SetEnvironmentVariable("ERP_JWT_KEY", "test-key-please-change-0123456789abcdef");
        return new WebApplicationFactory<Program>();
    }

    private static string Token(string user) => new JwtTokenService(JwtCfg()).Issue(user);

    private void SeedPerms(string user, bool open, bool price)
    {
        using var c = new SqlConnection(fx.ConnectionString);
        c.Open();
        c.Execute("DELETE FROM [userbqrpower] WHERE [用户]=@user AND [菜单]=N'物料资料'", new { user });
        c.Execute(@"INSERT INTO [userbqrpower]([用户],[菜单],[打开],[单价]) VALUES(@user,N'物料资料',@open,@price)",
            new { user, open, price });
    }

    private HttpClient Client(WebApplicationFactory<Program> app, string user)
    {
        var client = app.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token(user));
        return client;
    }

    private static void Seed(SqlConnection c)
    {
        Clean(c);
        c.Execute(@"INSERT INTO [物料资料]([物料类别],[物料编号],[物料名称],[单位],[单价],[销售价])
                    VALUES(N'面料API',N'MMA01',N'API面料',N'米',10,15)");
    }
    private static void Clean(SqlConnection c)
        => c.Execute("DELETE FROM [物料资料] WHERE [物料编号]=N'MMA01'");

    [SkippableFact]
    public async Task Forbidden_without_open_permission()
    {
        using var app = Factory();
        SeedPerms("mmnoopen", open: false, price: false);
        var resp = await Client(app, "mmnoopen").GetAsync("/api/material-master/categories");
        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
    }

    [SkippableFact]
    public async Task List_masks_price_without_单价_permission()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); Seed(c); }
        try
        {
            SeedPerms("mmnoprice", open: true, price: false);
            var noprice = await Client(app, "mmnoprice")
                .GetFromJsonAsync<JsonElement>("/api/material-master?keyword=MMA01");
            var row = noprice.GetProperty("items")[0];
            Assert.Equal(JsonValueKind.Null, row.GetProperty("单价").ValueKind);
            Assert.Equal(JsonValueKind.Null, row.GetProperty("销售价").ValueKind);

            SeedPerms("mmprice", open: true, price: true);
            var withprice = await Client(app, "mmprice")
                .GetFromJsonAsync<JsonElement>("/api/material-master?keyword=MMA01");
            Assert.Equal(10m, withprice.GetProperty("items")[0].GetProperty("单价").GetDecimal());
        }
        finally { using var c = new SqlConnection(fx.ConnectionString); c.Open(); Clean(c); }
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `dotnet test --filter "FullyQualifiedName~MaterialMasterApiTests"`
Expected: FAIL（/api/material-master 404）

- [ ] **Step 3: 实现 MaterialMasterController**

Create `src/ErpApi/Features/Materials/MaterialMaster/MaterialMasterController.cs`:

```csharp
using System.Security.Claims;
using ErpApi.Engines.Authorization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Materials.MaterialMaster;

[ApiController]
[Authorize]
[Route("api/material-master")]
public sealed class MaterialMasterController(
    MaterialMasterService svc, IPermissionService perms) : ControllerBase
{
    private const string Menu = "物料资料";
    private string CurrentUser =>
        User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction a) => perms.HasAsync(CurrentUser, Menu, a);

    [HttpGet("categories")]
    public async Task<IActionResult> Categories()
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        return Ok(await svc.CategoriesAsync());
    }

    [HttpGet]
    public async Task<IActionResult> List(string? 类别 = null, string? keyword = null, int page = 1, int size = 20)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var result = await svc.ListAsync(类别, keyword, page, size);
        if (!await AllowAsync(PermissionAction.单价))
            foreach (var r in result.Items) { r.单价 = null; r.销售价 = null; }
        return Ok(result);
    }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `dotnet test --filter "FullyQualifiedName~MaterialMasterApiTests"`
Expected: PASS 2 个

- [ ] **Step 5: 全量回归 + 提交**

Run: `dotnet test`
Expected: 全部 PASS

```powershell
git add src/ErpApi/Features/Materials/MaterialMaster/MaterialMasterController.cs tests/ErpApi.Tests/MaterialMasterApiTests.cs
git commit -m @'
feat(仓库管理): 物料资料左树/右表REST端点(GET categories + 按类别过滤列表,价格脱敏)+API测试

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 3: 前端 api + MaterialMasterPage（左树 + 右表 + 增删改）

**Files:**
- Create: `web/src/api/materialMaster.ts`, `web/src/pages/materials/MaterialMasterPage.tsx`

- [ ] **Step 1: 写 api**

Create `web/src/api/materialMaster.ts`:

```typescript
import { api } from "./client";
import type { Paged } from "./master";

export interface MaterialCategoryNode { 类别?: string; 数量: number }

export interface MaterialRow {
  ID: number;
  物料类别?: string;
  物料编号?: string;
  物料名称?: string;
  规格?: string;
  颜色?: string;
  单位?: string;
  单价?: number | null;
  销售价?: number | null;
  库存?: number | null;
  最低库存?: number | null;
  最高库存?: number | null;
  供应商编号?: string;
  供应商名称?: string;
  备注?: string;
}

export const materialMasterApi = {
  categories: () =>
    api.get<MaterialCategoryNode[]>("/material-master/categories").then(r => r.data),
  list: (类别?: string, keyword?: string, page = 1, size = 50) =>
    api.get<Paged<MaterialRow>>("/material-master", { params: { 类别, keyword, page, size } }).then(r => r.data),
};
```

- [ ] **Step 2: 写 MaterialMasterPage**

Create `web/src/pages/materials/MaterialMasterPage.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button, Card, Form, Input, InputNumber, Modal, Popconfirm, Space, Table, Tree, message,
} from "antd";
import { PlusOutlined, EditOutlined, DeleteOutlined } from "@ant-design/icons";
import { materialMasterApi, type MaterialRow } from "../../api/materialMaster";
import { masterApi } from "../../api/master";
import { can, hidePrice } from "../../auth/permissions";
import { usePerms } from "../../auth/PermissionContext";

const MENU = "物料资料";
const ALL = "__ALL__";
const materials = masterApi("materials");

export default function MaterialMasterPage() {
  const perms = usePerms();
  const canOpen = can(perms, MENU, "打开");
  const canSave = can(perms, MENU, "保存");
  const canDelete = can(perms, MENU, "删除");
  const priceHidden = hidePrice(perms, MENU);
  const money = (v?: number | null) => (priceHidden ? "***" : (v ?? ""));

  const [cats, setCats] = useState<{ 类别?: string; 数量: number }[]>([]);
  const [selKey, setSelKey] = useState<string>(ALL);
  const [keyword, setKeyword] = useState("");
  const [rows, setRows] = useState<MaterialRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  const [editing, setEditing] = useState<MaterialRow | null>(null); // null=不显示；ID=0 表示新增
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  const 类别 = selKey === ALL ? undefined : selKey;

  const loadCats = useCallback(async () => {
    try { setCats(await materialMasterApi.categories()); } catch { /* 忽略 */ }
  }, []);

  const loadRows = useCallback(async (p: number) => {
    if (!canOpen) return;
    setLoading(true);
    try {
      const r = await materialMasterApi.list(类别, keyword.trim() || undefined, p, 50);
      setRows(r.items); setTotal(r.total);
    } catch { message.error("加载物料失败"); }
    finally { setLoading(false); }
  }, [canOpen, 类别, keyword]);

  useEffect(() => { if (canOpen) loadCats(); }, [canOpen, loadCats]);
  useEffect(() => { setPage(1); loadRows(1); }, [selKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const treeData = useMemo(() => [{
    title: "全部物料", key: ALL,
    children: cats.map(c => ({ title: `${c.类别}（${c.数量}）`, key: c.类别 ?? "", isLeaf: true })),
  }], [cats]);

  const openCreate = () => {
    const init: MaterialRow = { ID: 0, 物料类别: 类别 };
    setEditing(init);
    form.resetFields();
    form.setFieldsValue(init);
  };
  const openEdit = async (r: MaterialRow) => {
    try {
      const full = await materials.get(r.ID) as Record<string, unknown>;
      setEditing(r);
      form.resetFields();
      form.setFieldsValue(full);
    } catch { message.error("加载物料详情失败"); }
  };

  const submit = async () => {
    const v = await form.validateFields();
    setSaving(true);
    try {
      if (editing && editing.ID > 0) await materials.update(editing.ID, v);
      else await materials.create(v);
      message.success("已保存");
      setEditing(null);
      await loadCats();
      await loadRows(page);
    } catch { message.error("保存失败"); }
    finally { setSaving(false); }
  };

  const del = async (r: MaterialRow) => {
    try {
      await materials.remove(r.ID);
      message.success("已删除");
      await loadCats();
      await loadRows(page);
    } catch { message.error("删除失败"); }
  };

  const columns = [
    { title: "物料编号", dataIndex: "物料编号", width: 120 },
    { title: "物料名称", dataIndex: "物料名称", width: 150 },
    { title: "类别", dataIndex: "物料类别", width: 100 },
    { title: "规格", dataIndex: "规格", width: 100 },
    { title: "颜色", dataIndex: "颜色", width: 80 },
    { title: "单位", dataIndex: "单位", width: 64 },
    { title: "单价", dataIndex: "单价", width: 90, align: "right" as const, render: money },
    { title: "销售价", dataIndex: "销售价", width: 90, align: "right" as const, render: money },
    { title: "库存", dataIndex: "库存", width: 90, align: "right" as const, render: (v?: number | null) => v ?? "" },
    { title: "最低库存", dataIndex: "最低库存", width: 90, align: "right" as const, render: (v?: number | null) => v ?? "" },
    { title: "供应商", dataIndex: "供应商名称", width: 140 },
    { title: "备注", dataIndex: "备注", width: 160 },
    {
      title: "操作", width: 120, fixed: "right" as const,
      render: (_: unknown, r: MaterialRow) => (
        <Space size="small">
          {canSave && <a onClick={() => openEdit(r)}><EditOutlined /></a>}
          {canDelete && (
            <Popconfirm title="确认删除该物料?" onConfirm={() => del(r)}>
              <a style={{ color: "#cf1322" }}><DeleteOutlined /></a>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  if (!canOpen) {
    return (
      <Card variant="borderless">
        <div style={{ padding: 24, color: "#999" }}>无权访问该页面（缺少“物料资料·打开”权限）。</div>
      </Card>
    );
  }

  return (
    <Card title="物料资料" variant="borderless" styles={{ body: { display: "flex", gap: 12 } }}>
      <div style={{ width: 220, flex: "0 0 220px", borderRight: "1px solid #f0f0f0", paddingRight: 8 }}>
        <Tree
          treeData={treeData}
          selectedKeys={[selKey]}
          defaultExpandAll
          onSelect={keys => { if (keys.length) setSelKey(String(keys[0])); }}
        />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Space style={{ marginBottom: 12 }} wrap>
          <Input.Search
            placeholder="物料编号/名称/规格/颜色/供应商" allowClear style={{ width: 260 }}
            value={keyword} onChange={e => setKeyword(e.target.value)}
            onSearch={() => { setPage(1); loadRows(1); }}
          />
          {canSave && <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增</Button>}
        </Space>
        <Table
          size="small" rowKey="ID" loading={loading} dataSource={rows} columns={columns}
          scroll={{ x: true }}
          pagination={{
            current: page, pageSize: 50, total, showSizeChanger: false,
            onChange: p => { setPage(p); loadRows(p); }, showTotal: t => `共 ${t} 条`,
          }}
        />
      </div>

      <Modal
        title={editing && editing.ID > 0 ? "编辑物料" : "新增物料"}
        open={!!editing} onCancel={() => setEditing(null)} onOk={submit}
        confirmLoading={saving} destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="物料编号" label="物料编号" rules={[{ required: true, message: "请输入物料编号" }]}>
            <Input />
          </Form.Item>
          <Form.Item name="物料名称" label="物料名称"><Input /></Form.Item>
          <Form.Item name="物料类别" label="类别"><Input /></Form.Item>
          <Form.Item name="规格" label="规格"><Input /></Form.Item>
          <Form.Item name="颜色" label="颜色"><Input /></Form.Item>
          <Form.Item name="单位" label="单位"><Input /></Form.Item>
          {!priceHidden && (
            <>
              <Form.Item name="单价" label="单价"><InputNumber min={0} style={{ width: "100%" }} /></Form.Item>
              <Form.Item name="销售价" label="销售价"><InputNumber min={0} style={{ width: "100%" }} /></Form.Item>
            </>
          )}
          <Form.Item name="供应商编号" label="供应商编号"><Input /></Form.Item>
          <Form.Item name="备注" label="备注"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
```

- [ ] **Step 3: 构建确认**

Run: `npm --prefix web run build`
Expected: 成功（tsc 无类型错误）

- [ ] **Step 4: 提交**

```powershell
git add web/src/api/materialMaster.ts web/src/pages/materials/MaterialMasterPage.tsx
git commit -m @'
feat(仓库管理): 物料资料前端页(左类别树+右物料表+关键字搜索+新增/编辑/删除弹窗,价格按权限脱敏)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 4: 菜单改指 + 路由 + 验证

**Files:**
- Modify: `web/src/nav/menuTree.tsx`, `web/src/App.tsx`

- [ ] **Step 1: menuTree 改指新页**

在 `web/src/nav/menuTree.tsx` 把 `M("物料资料", "/master/物料资料", "物料资料")` 改为：

```tsx
    M("物料资料", "/material-master", "物料资料"),
```

- [ ] **Step 2: App.tsx 加路由**

在 `web/src/App.tsx` 顶部 import 区追加（与其它 materials 页同组）：

```tsx
import MaterialMasterPage from "./pages/materials/MaterialMasterPage";
```

在路由区（与其它 materials 路由同块，例如 `materials:doc` 那行附近）追加：

```tsx
          <Route path="material-master" element={<MaterialMasterPage />} />
```

- [ ] **Step 3: 构建确认**

Run: `npm --prefix web run build`
Expected: 成功

- [ ] **Step 4: 前端单测回归**

Run: `npm --prefix web run test`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```powershell
git add web/src/nav/menuTree.tsx web/src/App.tsx
git commit -m @'
feat(仓库管理): 物料资料菜单改指新页 /material-master(左类别树+右物料表)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

- [ ] **Step 6: 冒烟（可选，服务在跑时）**

后端 5000 / 前端 5173 运行中：浏览器登录 admin/admin123 → 仓库管理 → 物料资料，确认左树分类、点分类右侧过滤、关键字搜索、新增/编辑/删除、价格列按权限显示。

---

## Self-Review

- **Spec 覆盖**：分类树聚合 + 按类别/关键字过滤分页 → Task1；端点+权限+价格脱敏 → Task2；左树+右表+增删改弹窗 → Task3；菜单改指+路由 → Task4。复用 materials CRUD（增删改）→ Task3 用 `masterApi("materials")`。✓
- **占位符**：无 TBD/TODO；每步含完整代码/命令/预期。✓
- **类型一致**：后端 `MaterialCategoryNode`/`MaterialRow`(C#) ↔ 前端同名(TS) 字段对齐；`CategoriesAsync()`/`ListAsync(类别,keyword,page,size)` Task1 定义、Task2 调用、Task3 经 `materialMasterApi` 传参一致。✓
- **关键坑**：①实体 `物料资料` 未映射 库存/最低/最高/供应商名称 → 右表只读展示这些列(Dapper)，编辑表单只编辑实体字段；②价格脱敏：通用 CRUD 自动脱敏，新读端点控制器内显式置 null；③左树用 distinct 物料类别(点了都有数)；④菜单改指但 configs.ts 旧配置保留(无害)；⑤Program.cs 注册 MaterialMasterService。✓
- **范围**：左树+右表单页 + 2 读端点 + 复用写端点，聚焦。✓
