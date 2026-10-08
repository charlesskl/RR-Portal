# 塑胶原料资料表 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ① 基本设置「塑胶原料资料表」可编辑主数据页(左类别树+右表格+弹窗增删改·保存/删除按权限),镜像塑胶物料资料,字段加 商品名称/起订量/安全库存。

**Architecture:** 新表 `塑胶原料资料` + 实体 + DbContext DbSet + 通用 `MasterCrudController<塑胶原料资料>`(CRUD)+ 读控制器 PlasticRawMaterialMaster(categories/list);前端克隆 PlasticMaterialMasterPage。

**Tech Stack:** .NET 8 + EF(主数据 CRUD)+ Dapper(读)+ SQL Server;React 18 + TS + Ant Design v6;xUnit + SkippableFact。

---

## Task 1: 后端(表+实体+DbContext+CRUD控制器+读服务/控制器+DI+菜单+权限)

**Files:**
- Create: `db/30_plastic_raw_material.sql`
- Create: `src/ErpApi/Data/Entities/塑胶原料资料.cs`
- Modify: `src/ErpApi/Data/ErpDbContext.cs` (加 DbSet)
- Modify: `src/ErpApi/Features/MasterData/Controllers.cs` (加 CRUD 控制器)
- Create: `src/ErpApi/Features/Plastics/PlasticRawMaterialMaster/PlasticRawMaterialMasterDtos.cs`
- Create: `src/ErpApi/Features/Plastics/PlasticRawMaterialMaster/PlasticRawMaterialMasterService.cs`
- Create: `src/ErpApi/Features/Plastics/PlasticRawMaterialMaster/PlasticRawMaterialMasterController.cs`
- Modify: `src/ErpApi/Program.cs` (注册 read service)
- Modify: `src/ErpApi/Features/Admin/MenuCatalog.cs` (基本设置组加项)
- Create: `db/seed_plastic_raw_material_perms.sql`

- [ ] **Step 1: 建表 SQL**

`db/30_plastic_raw_material.sql`:
```sql
-- 塑胶原料资料(基本设置·树脂原料主数据)。EF 不迁移·幂等。
IF OBJECT_ID(N'[塑胶原料资料]', N'U') IS NULL
CREATE TABLE [塑胶原料资料] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [物料类别] nvarchar(40) NULL,
    [物料编号] nvarchar(40) NULL,
    [物料名称] nvarchar(80) NULL,
    [规格] nvarchar(60) NULL,
    [颜色] nvarchar(30) NULL,
    [单位] nvarchar(20) NULL,
    [仓位号] nvarchar(30) NULL,
    [商品名称] nvarchar(80) NULL,
    [单价] decimal(18,4) NULL,
    [销售价] decimal(18,4) NULL,
    [起订量] decimal(18,4) NULL,
    [安全库存] decimal(18,4) NULL,
    [库存] decimal(18,4) NULL,
    [最低库存] decimal(18,4) NULL,
    [最高库存] decimal(18,4) NULL,
    [供应商编号] nvarchar(40) NULL,
    [供应商名称] nvarchar(80) NULL,
    [款号] nvarchar(40) NULL,
    [货币] nvarchar(20) NULL,
    [备注] nvarchar(200) NULL
);
```

- [ ] **Step 2: 应用 SQL 两库**

PowerShell(localdb 停止态先 `SqlLocalDB start MSSQLLocalDB`,再 `SqlLocalDB info MSSQLLocalDB` 取 `np:\\.\pipe\...`):
```
sqlcmd -S "<pipe>" -d erp -i D:\WebpageERP\db\30_plastic_raw_material.sql
sqlcmd -S "<pipe>" -d erp_test -i D:\WebpageERP\db\30_plastic_raw_material.sql
```

- [ ] **Step 3: 实体**

`src/ErpApi/Data/Entities/塑胶原料资料.cs`:
```csharp
using System.ComponentModel.DataAnnotations.Schema;
namespace ErpApi.Data.Entities;

[Table("塑胶原料资料")]
public sealed class 塑胶原料资料 : MasterEntity
{
    [Column("物料类别")] public string? 物料类别 { get; set; }
    [Column("物料编号")] public string? 物料编号 { get; set; }
    [Column("物料名称")] public string? 物料名称 { get; set; }
    [Column("规格")] public string? 规格 { get; set; }
    [Column("颜色")] public string? 颜色 { get; set; }
    [Column("单位")] public string? 单位 { get; set; }
    [Column("仓位号")] public string? 仓位号 { get; set; }
    [Column("商品名称")] public string? 商品名称 { get; set; }
    [Column("单价"), PriceField] public decimal? 单价 { get; set; }
    [Column("销售价"), PriceField] public decimal? 销售价 { get; set; }
    [Column("起订量")] public decimal? 起订量 { get; set; }
    [Column("安全库存")] public decimal? 安全库存 { get; set; }
    [Column("供应商编号")] public string? 供应商编号 { get; set; }
    [Column("款号")] public string? 款号 { get; set; }
    [Column("货币")] public string? 货币 { get; set; }
    [Column("备注")] public string? 备注 { get; set; }
}
```
(注:`PriceField` 与 塑胶物料资料.cs 同命名空间内可用——确认 塑胶物料资料.cs 的 `[Column("单价"), PriceField]` 写法直接照搬即可,无需额外 using。)

- [ ] **Step 4: DbContext DbSet**

`src/ErpApi/Data/ErpDbContext.cs` 在 `public DbSet<塑胶物料资料> 塑胶物料资料 => Set<塑胶物料资料>();` 后加:
```csharp
    public DbSet<塑胶原料资料> 塑胶原料资料 => Set<塑胶原料资料>();
```

- [ ] **Step 5: 通用 CRUD 控制器**

`src/ErpApi/Features/MasterData/Controllers.cs` 在 PlasticMaterialController 之后加:
```csharp
[Route("api/master/plastic-raw-materials")]
public sealed class PlasticRawMaterialController(
    MasterCrudService<塑胶原料资料> s, IPermissionService p, IAuditLogger a, ISqlConnectionFactory f)
    : MasterCrudController<塑胶原料资料>(s, p, a, f)
{ protected override string Menu => "塑胶原料资料表"; protected override string TableName => "塑胶原料资料"; }
```

- [ ] **Step 6: 读 DTOs + Service + Controller**

`src/ErpApi/Features/Plastics/PlasticRawMaterialMaster/PlasticRawMaterialMasterDtos.cs`:
```csharp
namespace ErpApi.Features.Plastics.PlasticRawMaterialMaster;

public sealed class PlasticRawMaterialCategoryNode
{
    public string? 类别 { get; set; }
    public int 数量 { get; set; }
}

public sealed class PlasticRawMaterialRow
{
    public long ID { get; set; }
    public string? 物料类别 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public string? 仓位号 { get; set; }
    public string? 商品名称 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 销售价 { get; set; }
    public decimal? 起订量 { get; set; }
    public decimal? 安全库存 { get; set; }
    public decimal? 库存 { get; set; }
    public decimal? 最低库存 { get; set; }
    public decimal? 最高库存 { get; set; }
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public string? 备注 { get; set; }
}
```

`src/ErpApi/Features/Plastics/PlasticRawMaterialMaster/PlasticRawMaterialMasterService.cs`:
```csharp
using Dapper;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Plastics.PlasticRawMaterialMaster;

// 塑胶原料资料左树 + 右表只读查询。增删改复用 PlasticRawMaterialController(/api/master/plastic-raw-materials)。
public sealed class PlasticRawMaterialMasterService(ISqlConnectionFactory factory)
{
    public async Task<IReadOnlyList<PlasticRawMaterialCategoryNode>> CategoriesAsync()
    {
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticRawMaterialCategoryNode>(@"
SELECT [物料类别] AS 类别, COUNT(*) AS 数量
FROM [塑胶原料资料]
WHERE [物料类别] IS NOT NULL AND LTRIM(RTRIM([物料类别])) <> ''
GROUP BY [物料类别]
ORDER BY [物料类别];");
        return rows.AsList();
    }

    public async Task<PagedResult<PlasticRawMaterialRow>> ListAsync(string? 类别, string? keyword, int page, int size, bool onlyStock = false)
    {
        if (page < 1) page = 1;
        if (size < 1 || size > 200) size = 20;
        var cat = string.IsNullOrWhiteSpace(类别) ? null : 类别.Trim();
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [塑胶原料资料]
WHERE (@cat IS NULL OR [物料类别] = @cat)
  AND (@kw IS NULL OR [物料编号] LIKE @kw OR [物料名称] LIKE @kw OR [规格] LIKE @kw OR [颜色] LIKE @kw OR [供应商名称] LIKE @kw OR [商品名称] LIKE @kw)
  AND (@onlyStock = 0 OR ISNULL([库存],0) > 0);
SELECT [ID],[物料类别],[物料编号],[物料名称],[规格],[颜色],[单位],[仓位号],[商品名称],[单价],[销售价],[起订量],[安全库存],[库存],[最低库存],[最高库存],[供应商编号],[供应商名称],[备注]
FROM [塑胶原料资料]
WHERE (@cat IS NULL OR [物料类别] = @cat)
  AND (@kw IS NULL OR [物料编号] LIKE @kw OR [物料名称] LIKE @kw OR [规格] LIKE @kw OR [颜色] LIKE @kw OR [供应商名称] LIKE @kw OR [商品名称] LIKE @kw)
  AND (@onlyStock = 0 OR ISNULL([库存],0) > 0)
ORDER BY [物料编号] OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;",
            new { cat, kw, page, size, onlyStock = onlyStock ? 1 : 0 });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<PlasticRawMaterialRow>()).AsList();
        return new PagedResult<PlasticRawMaterialRow>(items, total);
    }
}
```

`src/ErpApi/Features/Plastics/PlasticRawMaterialMaster/PlasticRawMaterialMasterController.cs`:
```csharp
using System.Security.Claims;
using ErpApi.Engines.Authorization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Plastics.PlasticRawMaterialMaster;

[ApiController]
[Authorize]
[Route("api/plastic-raw-material-master")]
public sealed class PlasticRawMaterialMasterController(
    PlasticRawMaterialMasterService svc, IPermissionService perms) : ControllerBase
{
    private const string Menu = "塑胶原料资料表";
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
    public async Task<IActionResult> List(string? 类别 = null, string? keyword = null, int page = 1, int size = 20, bool onlyStock = false)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var result = await svc.ListAsync(类别, keyword, page, size, onlyStock);
        if (!await AllowAsync(PermissionAction.单价))
            foreach (var r in result.Items) { r.单价 = null; r.销售价 = null; }
        return Ok(result);
    }
}
```

- [ ] **Step 7: DI 注册**

`Program.cs` 在 `builder.Services.AddScoped<ErpApi.Features.Plastics.PlasticMaterialMaster.PlasticMaterialMasterService>();` 后加:
```csharp
builder.Services.AddScoped<ErpApi.Features.Plastics.PlasticRawMaterialMaster.PlasticRawMaterialMasterService>();
```

- [ ] **Step 8: 菜单 + 权限种子**

`MenuCatalog.cs` 在基本设置组(找 `new("基本设置",...)` 那批)加:
```csharp
        new("基本设置","塑胶原料资料表"),
```
（若 MenuCatalog 无显式"基本设置"分组项,则加到与 供应商资料/客户资料 同组的位置;分组名以 menuTree 的 "基本设置" 为准。）

`db/seed_plastic_raw_material_perms.sql`:
```sql
-- 开发用:给 admin 授予 塑胶原料资料表 菜单 9 位权限。
DECLARE @用户 nvarchar(30) = N'admin';
DELETE FROM [userbqrpower] WHERE [用户]=@用户 AND [菜单] = N'塑胶原料资料表';
INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[打印],[单价],[金额],[审核],[反审核],[功能])
VALUES (@用户,N'塑胶原料资料表',1,1,1,1,1,1,1,1,1);
```
应用两库(同 Step 2 命名管道)。

- [ ] **Step 9: 编译**

Run: `dotnet build src/ErpApi/ErpApi.csproj -c Debug` → Build succeeded(0 错误)。若 MenuCatalog 分组写法报错,读该文件确认 record 构造签名。

- [ ] **Step 10: Commit**
```bash
git add db/30_plastic_raw_material.sql db/seed_plastic_raw_material_perms.sql src/ErpApi/Data/ src/ErpApi/Features/MasterData/Controllers.cs src/ErpApi/Features/Plastics/PlasticRawMaterialMaster/ src/ErpApi/Program.cs src/ErpApi/Features/Admin/MenuCatalog.cs
git commit -m "feat(塑胶原料资料表): 表+实体+CRUD控制器+读服务+菜单权限"
```

---

## Task 2: 后端 DB 测试

**Files:**
- Create: `tests/ErpApi.Tests/PlasticRawMaterialMasterDbTests.cs`

- [ ] **Step 1: 写测试**(镜像 PlasticMaterialMasterDbTests·验 商品名称/起订量/安全库存)

`PlasticRawMaterialMasterDbTests.cs`:
```csharp
using Dapper;
using ErpApi.Features.Plastics.PlasticRawMaterialMaster;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticRawMaterialMasterDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticRawMaterialMasterService Svc() => new(Factory());

    private static void Seed(SqlConnection c)
    {
        Cleanup(c);
        c.Execute(@"INSERT INTO [塑胶原料资料]([物料类别],[物料编号],[物料名称],[规格],[单位],[商品名称],[单价],[销售价],[起订量],[安全库存],[库存],[供应商名称])
                    VALUES(N'ABS',N'R-T1',N'ABS粒',N'规X',N'kg',N'韩国LG',10,15,25,5,100,N'供A'),
                          (N'ABS',N'R-T2',N'ABS黑',N'规Y',N'kg',N'台化',12,0,30,0,0,N'供A'),
                          (N'PP', N'R-T3',N'PP粒', N'规Z',N'kg',N'中油',8,9,20,10,500,N'供B'),
                          (NULL,  N'R-T9',N'无类别',N'规W',N'个',N'X',1,2,0,0,0,N'供C')");
    }
    private static void Cleanup(SqlConnection c)
        => c.Execute("DELETE FROM [塑胶原料资料] WHERE [物料编号] IN (N'R-T1',N'R-T2',N'R-T3',N'R-T9')");

    [SkippableFact]
    public async Task Categories_groups_nonempty_with_counts()
    {
        using var c = fx.Open(); Seed(c);
        try
        {
            var cats = await Svc().CategoriesAsync();
            Assert.Equal(2, cats.Single(x => x.类别 == "ABS").数量);
            Assert.Equal(1, cats.Single(x => x.类别 == "PP").数量);
            Assert.DoesNotContain(cats, x => x.类别 is null);
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task List_by_category_carries_new_fields()
    {
        using var c = fx.Open(); Seed(c);
        try
        {
            var page = await Svc().ListAsync("ABS", null, 1, 20);
            Assert.Equal(2, page.Total);
            var r = Assert.Single(page.Items, x => x.物料编号 == "R-T1");
            Assert.Equal("韩国LG", r.商品名称);
            Assert.Equal(25m, r.起订量);
            Assert.Equal(5m, r.安全库存);
            Assert.Equal(100m, r.库存);
            Assert.Equal("供A", r.供应商名称);
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task List_keyword_and_onlyStock()
    {
        using var c = fx.Open(); Seed(c);
        try
        {
            Assert.Equal("R-T3", Assert.Single((await Svc().ListAsync(null, "PP粒", 1, 20)).Items).物料编号);
            var stock = await Svc().ListAsync(null, null, 1, 200, true);
            var seeded = stock.Items.Where(r => new[] { "R-T1", "R-T2", "R-T3", "R-T9" }.Contains(r.物料编号)).ToList();
            Assert.DoesNotContain(seeded, r => r.物料编号 == "R-T2"); // 库存0 被 onlyStock 过滤
        }
        finally { Cleanup(c); }
    }
}
```

- [ ] **Step 2: 跑本测试**

Run: `dotnet test tests/ErpApi.Tests/ErpApi.Tests.csproj --filter "FullyQualifiedName~PlasticRawMaterialMaster"`
Expected: 3 passed。

- [ ] **Step 3: 全量测试**

Run: `dotnet test tests/ErpApi.Tests/ErpApi.Tests.csproj`
Expected: 全绿(401→404)。

- [ ] **Step 4: Commit**
```bash
git add tests/ErpApi.Tests/PlasticRawMaterialMasterDbTests.cs
git commit -m "test(塑胶原料资料表): categories/list/新字段/keyword/onlyStock"
```

---

## Task 3: 前端 api + Page + 路由 + 菜单

**Files:**
- Create: `web/src/api/plasticRawMaterialMaster.ts`
- Create: `web/src/pages/plastics/PlasticRawMaterialMasterPage.tsx`
- Modify: `web/src/App.tsx` (import + route)
- Modify: `web/src/nav/menuTree.tsx:27` (`M("塑胶原料资料表")` → 带路由)

- [ ] **Step 1: api 客户端**

`web/src/api/plasticRawMaterialMaster.ts`:
```ts
import { api } from "./client";
import type { Paged } from "./master";

export interface PlasticRawMaterialCategoryNode { 类别?: string; 数量: number }

export interface PlasticRawMaterialRow {
  ID: number;
  物料类别?: string; 物料编号?: string; 物料名称?: string; 规格?: string; 颜色?: string;
  单位?: string; 仓位号?: string; 商品名称?: string;
  单价?: number | null; 销售价?: number | null; 起订量?: number | null; 安全库存?: number | null;
  库存?: number | null; 最低库存?: number | null; 最高库存?: number | null;
  供应商编号?: string; 供应商名称?: string; 备注?: string;
}

export const plasticRawMaterialMasterApi = {
  categories: () =>
    api.get<PlasticRawMaterialCategoryNode[]>("/plastic-raw-material-master/categories").then(r => r.data),
  list: (类别?: string, keyword?: string, page = 1, size = 50, onlyStock?: boolean) =>
    api.get<Paged<PlasticRawMaterialRow>>("/plastic-raw-material-master", { params: { 类别, keyword, page, size, onlyStock } }).then(r => r.data),
};
```

- [ ] **Step 2: 报表页(克隆 PlasticMaterialMasterPage·加 商品名称/起订量/安全库存)**

`web/src/pages/plastics/PlasticRawMaterialMasterPage.tsx`:
```tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, Form, Input, InputNumber, Modal, Popconfirm, Space, Table, Tree, message } from "antd";
import { PlusOutlined, EditOutlined, DeleteOutlined } from "@ant-design/icons";
import { plasticRawMaterialMasterApi, type PlasticRawMaterialRow, type PlasticRawMaterialCategoryNode } from "../../api/plasticRawMaterialMaster";
import { masterApi } from "../../api/master";
import { can, hidePrice } from "../../auth/permissions";
import { usePerms } from "../../auth/PermissionContext";

const MENU = "塑胶原料资料表";
const ALL = "__ALL__";
const plasticRaws = masterApi("plastic-raw-materials");

export default function PlasticRawMaterialMasterPage() {
  const perms = usePerms();
  const canOpen = can(perms, MENU, "打开");
  const canSave = can(perms, MENU, "保存");
  const canDelete = can(perms, MENU, "删除");
  const priceHidden = hidePrice(perms, MENU);
  const money = (v?: number | null) => (priceHidden ? "***" : (v ?? ""));

  const [cats, setCats] = useState<PlasticRawMaterialCategoryNode[]>([]);
  const [selKey, setSelKey] = useState<string>(ALL);
  const [keyword, setKeyword] = useState("");
  const [rows, setRows] = useState<PlasticRawMaterialRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  const [editing, setEditing] = useState<PlasticRawMaterialRow | null>(null);
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  const 类别 = selKey === ALL ? undefined : selKey;

  const loadCats = useCallback(async () => {
    try { setCats(await plasticRawMaterialMasterApi.categories()); } catch { /* 忽略 */ }
  }, []);

  const loadRows = useCallback(async (p: number) => {
    if (!canOpen) return;
    setLoading(true);
    try {
      const r = await plasticRawMaterialMasterApi.list(类别, keyword.trim() || undefined, p, 50);
      setRows(r.items); setTotal(r.total);
    } catch { message.error("加载塑胶原料失败"); }
    finally { setLoading(false); }
  }, [canOpen, 类别, keyword]);

  useEffect(() => { if (canOpen) loadCats(); }, [canOpen, loadCats]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setPage(1); loadRows(1); }, [selKey]);

  const treeData = useMemo(() => [{
    title: "全部塑胶原料", key: ALL,
    children: cats.map(c => ({ title: `${c.类别}（${c.数量}）`, key: c.类别 ?? "", isLeaf: true })),
  }], [cats]);

  const openCreate = () => {
    const init: PlasticRawMaterialRow = { ID: 0, 物料类别: 类别 };
    setEditing(init);
    form.resetFields();
    form.setFieldsValue(init);
  };
  const openEdit = async (r: PlasticRawMaterialRow) => {
    try {
      const full = await plasticRaws.get(r.ID) as Record<string, unknown>;
      setEditing(r);
      form.resetFields();
      form.setFieldsValue(full);
    } catch { message.error("加载塑胶原料详情失败"); }
  };

  const submit = async () => {
    const v = await form.validateFields();
    setSaving(true);
    try {
      if (editing && editing.ID > 0) await plasticRaws.update(editing.ID, v);
      else await plasticRaws.create(v);
      message.success("已保存");
      setEditing(null);
      await loadCats();
      await loadRows(page);
    } catch { message.error("保存失败"); }
    finally { setSaving(false); }
  };

  const del = async (r: PlasticRawMaterialRow) => {
    try {
      await plasticRaws.remove(r.ID);
      message.success("已删除");
      await loadCats();
      await loadRows(page);
    } catch { message.error("删除失败"); }
  };

  const columns = [
    { title: "物料编号", dataIndex: "物料编号", width: 120 },
    { title: "物料名称", dataIndex: "物料名称", width: 150 },
    { title: "类别", dataIndex: "物料类别", width: 90 },
    { title: "规格", dataIndex: "规格", width: 100 },
    { title: "颜色", dataIndex: "颜色", width: 70 },
    { title: "商品名称", dataIndex: "商品名称", width: 130 },
    { title: "单位", dataIndex: "单位", width: 60 },
    { title: "单价", dataIndex: "单价", width: 90, align: "right" as const, render: money },
    { title: "销售价", dataIndex: "销售价", width: 90, align: "right" as const, render: money },
    { title: "起订量", dataIndex: "起订量", width: 90, align: "right" as const, render: (v?: number | null) => v ?? "" },
    { title: "安全库存", dataIndex: "安全库存", width: 90, align: "right" as const, render: (v?: number | null) => v ?? "" },
    { title: "库存", dataIndex: "库存", width: 90, align: "right" as const, render: (v?: number | null) => v ?? "" },
    { title: "供应商", dataIndex: "供应商名称", width: 130 },
    { title: "备注", dataIndex: "备注", width: 150 },
    {
      title: "操作", width: 100, fixed: "right" as const,
      render: (_: unknown, r: PlasticRawMaterialRow) => (
        <Space size="small">
          {canSave && <a onClick={() => openEdit(r)}><EditOutlined /></a>}
          {canDelete && (
            <Popconfirm title="确认删除该塑胶原料?" onConfirm={() => del(r)}>
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
        <div style={{ padding: 24, color: "#999" }}>无权访问该页面（缺少"塑胶原料资料表·打开"权限）。</div>
      </Card>
    );
  }

  return (
    <Card title="塑胶原料资料表" variant="borderless" styles={{ body: { display: "flex", gap: 12 } }}>
      <div style={{ width: 220, flex: "0 0 220px", borderRight: "1px solid #f0f0f0", paddingRight: 8 }}>
        <Tree treeData={treeData} selectedKeys={[selKey]} defaultExpandAll
          onSelect={keys => { if (keys.length) setSelKey(String(keys[0])); }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Space style={{ marginBottom: 12 }} wrap>
          <Input.Search placeholder="物料编号/名称/规格/颜色/商品名称/供应商" allowClear style={{ width: 300 }}
            value={keyword} onChange={e => setKeyword(e.target.value)}
            onSearch={() => { setPage(1); loadRows(1); }} />
          {canSave && <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增</Button>}
        </Space>
        <Table size="small" rowKey="ID" loading={loading} dataSource={rows} columns={columns}
          scroll={{ x: true }}
          pagination={{ current: page, pageSize: 50, total, showSizeChanger: false,
            onChange: p => { setPage(p); loadRows(p); }, showTotal: t => `共 ${t} 条` }} />
      </div>

      <Modal title={editing && editing.ID > 0 ? "编辑塑胶原料" : "新增塑胶原料"}
        open={!!editing} onCancel={() => setEditing(null)} onOk={submit}
        confirmLoading={saving} destroyOnClose>
        <Form form={form} layout="vertical">
          <Form.Item name="物料编号" label="物料编号" rules={[{ required: true, message: "请输入物料编号" }]}><Input /></Form.Item>
          <Form.Item name="物料名称" label="物料名称"><Input /></Form.Item>
          <Form.Item name="物料类别" label="类别"><Input /></Form.Item>
          <Form.Item name="规格" label="规格"><Input /></Form.Item>
          <Form.Item name="颜色" label="颜色"><Input /></Form.Item>
          <Form.Item name="商品名称" label="商品名称"><Input /></Form.Item>
          <Form.Item name="单位" label="单位"><Input /></Form.Item>
          <Form.Item name="仓位号" label="仓位号"><Input /></Form.Item>
          {!priceHidden && (
            <>
              <Form.Item name="单价" label="单价"><InputNumber min={0} style={{ width: "100%" }} /></Form.Item>
              <Form.Item name="销售价" label="销售价"><InputNumber min={0} style={{ width: "100%" }} /></Form.Item>
            </>
          )}
          <Form.Item name="起订量" label="起订量"><InputNumber min={0} style={{ width: "100%" }} /></Form.Item>
          <Form.Item name="安全库存" label="安全库存"><InputNumber min={0} style={{ width: "100%" }} /></Form.Item>
          <Form.Item name="供应商编号" label="供应商编号"><Input /></Form.Item>
          <Form.Item name="备注" label="备注"><Input.TextArea rows={2} /></Form.Item>
          <Form.Item name="款号" hidden><Input /></Form.Item>
          <Form.Item name="货币" hidden><Input /></Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
```

- [ ] **Step 3: 路由 + 菜单**

`App.tsx`:import `PlasticRawMaterialMasterPage`;在 `plastic-material-master` 路由附近加 `<Route path="plastic-raw-material-master" element={<PlasticRawMaterialMasterPage />} />`。

`menuTree.tsx` line 27 `M("塑胶原料资料表"),` → `M("塑胶原料资料表", "/plastic-raw-material-master", "塑胶原料资料表"),`。

- [ ] **Step 4: 类型检查 + 测试**

Run: `cd web && npx tsc --noEmit`(0 错误)；`cd web && npx vitest run`(54 passed)。

- [ ] **Step 5: Commit**
```bash
git add web/src/api/plasticRawMaterialMaster.ts web/src/pages/plastics/PlasticRawMaterialMasterPage.tsx web/src/App.tsx web/src/nav/menuTree.tsx
git commit -m "feat(塑胶原料资料表): 前端 左树+右表+弹窗增删改+路由+菜单"
```

---

## Task 4: HTTP 冒烟 + 终审 + 合并

- [ ] **Step 1: Release 编译**(锁先按 PID Stop-Process)+ 起后端 `--contentRoot 输出目录`。
- [ ] **Step 2: 冒烟**:登录 admin → `POST /api/master/plastic-raw-materials`(建·物料类别ABS/物料编号/商品名称/起订量/安全库存)→ `GET /api/plastic-raw-material-master/categories`(含 ABS)+`/api/plastic-raw-material-master?类别=ABS`(验 商品名称/起订量/安全库存)→ `PUT /api/master/plastic-raw-materials/{id}`(改物料名称)→ `DELETE /api/master/plastic-raw-materials/{id}`。**注:CRUD 端点/请求体格式参照 MasterCrudController(冒烟前 grep 其方法签名确认 path/动词/body)。** 清理残留。
- [ ] **Step 3: opus 终审**:全分支 diff·验 ① 实体[Column]/[PriceField] 与表列一致·DbSet 注册;② CRUD 控制器 Menu/Table 正确·保存删除单价权限由基类含;③ 读服务 categories/list SQL 正确含新字段·单价脱敏;④ 菜单/权限/DI/路由/menuTree 齐;⑤ 前端 canSave/canDelete 门控·单价脱敏·新字段表单+列;⑥ DTO↔SQL↔前端一致;⑦ 全参数化·未动既有 master 实体/控制器。READY 才合并。
- [ ] **Step 4: 合并 + 收尾**:`--no-ff` 合并 master,删分支;worklog `docs/worklogs/2026-06-30-plastic-raw-material-master.md`;更新 MEMORY。
