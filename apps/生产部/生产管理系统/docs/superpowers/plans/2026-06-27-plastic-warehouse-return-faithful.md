# 塑胶退仓单录入保真(复用加工入仓单表单)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 塑胶退仓单 复用刚建的保真「加工入仓单」录入页(同样式同表头),补齐缺列 工模编号/订单单号;库存方向(退仓−)/前缀(STC)/审核全不变。

**Architecture:** DB 纯 ALTER 给退仓两表加列;后端扩 PlasticWarehouseReturn DTOs+Create/Get(镜像入仓);前端把 PlasticReceiptFormPage 泛化为 cfg 驱动({resource,menu,title,allowReceiptPick}),入仓/退仓两路由共用,退仓从共享 PlasticSupplierDocFormPage 移出。

**Tech Stack:** .NET 8 + Dapper;React 18 + TS + Vite + Ant Design v6 + Vitest。

---

## 前置约定

- 工作目录 `D:\WebpageERP`,分支 `feat-plastic-wh-return-faithful`,完成 `--no-ff` 合并 master 删分支。`dotnet` = `C:\Program Files\dotnet\dotnet.exe`,锁 DLL 用 `-c Release`。
- DB env 从 User 取:`ERP_TEST_DB`/`ERP_JWT_KEY`/`ERP_DB`。前端 `npm --prefix D:\WebpageERP\web run test`/`build`。
- 提交末尾 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。
- **坑:冒烟前确保 Release DLL 新**(子代理 `dotnet test` 可能只产 Debug)→ 起后端前 `dotnet build -c Release`;被运行中后端进程锁则先 `Stop-Process`(按 PID 或 ErpApi 名)。起后端 `--contentRoot "D:\WebpageERP\src\ErpApi\bin\Release\net8.0"`(否则 JWT 401 IDX10208)。
- 现状:`塑胶退仓明细单` 已有 生产单号/款号/塑胶货号/物料编号/物料名称/规格/颜色/仓位号/单位/数量/单价/金额/备注;`塑胶退仓单` 头已有 出库单号/入仓单号/电脑单号。**本增量仅加** 明细 工模编号/订单单号 + 头 订单单号(与入仓 `db/25` 同款)。
- `塑胶退仓明细单` 是塑胶表,**无 FK 到 款号总表**,测试免父行。
- 镜像源:入仓增量已建的 `PlasticReceiptService`(Create/Get 已补 工模编号/订单单号)、`PlasticReceiptFormPage.tsx`、`PlasticReceiptLineTable.tsx`;旧共享表单 `PlasticSupplierDocFormPage.tsx` 的 `bringFromReceipt`(选入仓单带出明细·用 `plasticDocApi("plastic-receipts").get`)。
- `PSDLine` 已有 `工模编号?`/`订单单号?`、`PSDHeader` 已有 `订单单号?`(入仓增量已加),**前端类型无需再改**。

## 文件结构

| 文件 | 责任 | 新建/改 |
|---|---|---|
| `db/26_plastic_warehouse_return_processing_cols.sql` | ALTER 加 3 列 | 新建 |
| `src/ErpApi/Features/Plastics/PlasticWarehouseReturn/PlasticWarehouseReturnDtos.cs` | DTO 加 工模编号/订单单号 | 改 |
| `src/ErpApi/Features/Plastics/PlasticWarehouseReturn/PlasticWarehouseReturnService.cs` | Create/Get 补列 | 改 |
| `tests/ErpApi.Tests/PlasticWarehouseReturnProcessingColsDbTests.cs` | Create→Get 回读测试 | 新建 |
| `web/src/pages/plastics/PlasticReceiptFormConfigs.ts` | 入仓/退仓 cfg | 新建 |
| `web/src/pages/plastics/PlasticReceiptFormPage.tsx` | 泛化为 cfg 驱动 + 退仓带出入仓单 | 改 |
| `web/src/App.tsx` | 入仓+退仓 两路由指向泛化页;退仓移出共享 | 改 |

---

## Task 1: 后端 DB + DTO + Service + 测试

**Files:** Create `db/26_plastic_warehouse_return_processing_cols.sql`, `tests/ErpApi.Tests/PlasticWarehouseReturnProcessingColsDbTests.cs`; Modify `PlasticWarehouseReturnDtos.cs`, `PlasticWarehouseReturnService.cs`

- [ ] **Step 1: DB 脚本** Create `db/26_plastic_warehouse_return_processing_cols.sql`:

```sql
-- 塑胶退仓单保真:塑胶退仓明细单补 工模编号/订单单号;塑胶退仓单头补 订单单号。幂等。
IF COL_LENGTH(N'[塑胶退仓明细单]', N'工模编号') IS NULL
    ALTER TABLE [塑胶退仓明细单] ADD [工模编号] nvarchar(30) NULL;
IF COL_LENGTH(N'[塑胶退仓明细单]', N'订单单号') IS NULL
    ALTER TABLE [塑胶退仓明细单] ADD [订单单号] nvarchar(40) NULL;
IF COL_LENGTH(N'[塑胶退仓单]', N'订单单号') IS NULL
    ALTER TABLE [塑胶退仓单] ADD [订单单号] nvarchar(40) NULL;
```
应用两库(PowerShell):
```powershell
foreach ($V in "ERP_DB","ERP_TEST_DB") {
  $cs = [Environment]::GetEnvironmentVariable($V,"User"); $c = New-Object System.Data.SqlClient.SqlConnection $cs; $c.Open()
  $cmd = $c.CreateCommand(); $cmd.CommandText = [IO.File]::ReadAllText((Resolve-Path "db/26_plastic_warehouse_return_processing_cols.sql")); $null = $cmd.ExecuteNonQuery(); $c.Close(); Write-Output "$V ok"
}
```
Expected: `ERP_DB ok` 和 `ERP_TEST_DB ok`。

- [ ] **Step 2: DTO** 改 `PlasticWarehouseReturnDtos.cs`——先 READ 该文件确认各 class 名与字段位置,再加属性(镜像入仓 `PlasticReceiptDtos`):
  - 头 Detail DTO(含 出库单号/入仓单号/电脑单号 的那个)末尾加 `public string? 订单单号 { get; set; }`
  - 明细 Detail DTO(含 生产单号/款号/塑胶货号)在 `款号` 后加 `public string? 工模编号 { get; set; }`,末尾加 `public string? 订单单号 { get; set; }`
  - 明细 Create DTO 在 `款号` 后加 `public string? 工模编号 { get; set; }`,末尾加 `public string? 订单单号 { get; set; }`
  - 头 Create DTO(含 出库单号/入仓单号/电脑单号)末尾加 `public string? 订单单号 { get; set; }`

- [ ] **Step 3: Service Create** 改 `PlasticWarehouseReturnService.CreateAsync` 的两条 INSERT——先 READ 现有方法确认 anonymous 对象写法,再:

头 INSERT 列尾加 `,[订单单号]`、VALUES 尾加 `,@订单单号`,匿名对象加 `dto.订单单号`。例:
```csharp
INSERT INTO [塑胶退仓单]([单号],[日期],[供应商编号],[供应商名称],[仓库],[数量],[金额],[操作员],[审核],[备注],[出库单号],[入仓单号],[电脑单号],[订单单号])
VALUES(@单号,@日期,@供应商编号,@供应商名称,@仓库,@数量,@金额,@操作员,'0',@备注,@出库单号,@入仓单号,@电脑单号,@订单单号)
```
匿名对象尾部加 `dto.出库单号, dto.入仓单号, dto.电脑单号, dto.订单单号`(保持原有项,只补 `订单单号`)。

明细 INSERT 列加 `[工模编号]`(放在 `[款号]` 后)与 `[订单单号]`(放在 `[塑胶货号]` 后),VALUES 同位加 `@工模编号`/`@订单单号`,匿名对象加 `l.工模编号` 和 `订单单号 = l.订单单号 ?? dto.订单单号`。例:
```csharp
INSERT INTO [塑胶退仓明细单]([单号],[日期],[仓库],[生产单号],[款号],[工模编号],[物料编号],[物料名称],[规格],[颜色],[塑胶货号],[订单单号],[仓位号],[单位],[数量],[单价],[金额],[备注])
VALUES(@单号,@日期,@仓库,@生产单号,@款号,@工模编号,@物料编号,@物料名称,@规格,@颜色,@塑胶货号,@订单单号,@仓位号,@单位,@数量,@单价,@金额,@备注)
```
匿名对象:在 `l.款号,` 后加 `l.工模编号,`;在 `l.塑胶货号,` 后加 `订单单号 = l.订单单号 ?? dto.订单单号,`(其余 仓位号/单位/数量/单价/金额/备注 不变)。

- [ ] **Step 4: Service Get** 改 `PlasticWarehouseReturnService.GetAsync` 两条 SELECT 加列:
  - 头 SELECT 列尾加 `,[订单单号]`。
  - 明细 SELECT 在 `[款号]` 后加 `[工模编号]`、在 `[塑胶货号]` 后加 `[订单单号]`。

- [ ] **Step 5: 测试** Create `tests/ErpApi.Tests/PlasticWarehouseReturnProcessingColsDbTests.cs`(先 READ 一份现有 PlasticWarehouseReturn 服务用法或 `PlasticReceiptProcessingColsDbTests` 对照 Create/DTO 命名):

```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Plastics.PlasticWarehouseReturn;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticWarehouseReturnProcessingColsDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    // 注:构造签名以现有 PlasticWarehouseReturnService 为准(读源文件确认 docNo/posting 等依赖);
    // 若与入仓服务一致即 new(Factory(), new DocumentNumberGenerator())。
    private PlasticWarehouseReturnService Svc() => new(Factory(), new DocumentNumberGenerator());

    [SkippableFact]
    public async Task Create_then_Get_roundtrips_工模编号_and_订单单号()
    {
        Skip.IfNot(fx.Available, "test DB not configured");
        // dto 字段名以 PlasticWarehouseReturnDtos 的 Create DTO 为准(读源文件确认 供应商编号/仓库/订单单号/明细);
        // 下例假定与入仓 Create DTO 同构。
        var dto = new PlasticWarehouseReturnCreateDto
        {
            供应商编号 = "S01", 供应商名称 = "测试车间", 仓库 = "塑胶仓", 订单单号 = "ZCS-WR", 备注 = "smoke",
            明细 =
            [
                new PlasticWarehouseReturnCreateLineDto { 生产单号 = "WR-MO", 款号 = "K-WR", 工模编号 = "GM-WR",
                    物料编号 = "WRPM", 物料名称 = "ABS粒", 颜色 = "黑", 塑胶货号 = "H-WR", 单位 = "kg", 数量 = 7, 单价 = 2 },
                new PlasticWarehouseReturnCreateLineDto { 生产单号 = "WR-MO", 款号 = "K-WR", 工模编号 = "GM-WR",
                    物料编号 = "WRPM", 物料名称 = "ABS粒", 颜色 = "黑", 塑胶货号 = "H-WR", 订单单号 = "ZCS-LINE", 单位 = "kg", 数量 = 3, 单价 = 2 },
            ],
        };
        string 单号 = await Svc().CreateAsync(dto, "tester");
        try
        {
            var d = await Svc().GetAsync(单号);
            Assert.NotNull(d);
            Assert.Equal("ZCS-WR", d!.单头!.订单单号);
            Assert.Equal(2, d.明细.Count);
            Assert.All(d.明细, l => { Assert.Equal("GM-WR", l.工模编号); Assert.Equal("K-WR", l.款号); });
            Assert.Equal("ZCS-WR", d.明细[0].订单单号);     // 缺省取头
            Assert.Equal("ZCS-LINE", d.明细[1].订单单号);   // 显式
        }
        finally
        {
            using var c = fx.Open();
            c.Execute("DELETE FROM [塑胶退仓明细单] WHERE [单号]=@单号", new { 单号 });
            c.Execute("DELETE FROM [塑胶退仓单] WHERE [单号]=@单号", new { 单号 });
        }
    }
}
```
**注**:若 `CreateAsync`/DTO/Detail 类型名与上例不符,以读源文件得到的真实名字为准修正(`PlasticReceiptProcessingColsDbTests` 是同款参照)。测试目标=Create→Get 回读 头订单单号 + 明细工模编号/订单单号(缺省取头与显式两态)。

- [ ] **Step 6: 跑测试 + 全量**

Run: `dotnet test --filter "FullyQualifiedName~PlasticWarehouseReturnProcessingColsDbTests"` → PASS。
Run: `dotnet test` → 全绿(369 → 370)。报告总数。

- [ ] **Step 7: Commit**

```powershell
git add src/ErpApi tests/ErpApi.Tests/PlasticWarehouseReturnProcessingColsDbTests.cs db/26_plastic_warehouse_return_processing_cols.sql
git commit -m @'
feat(塑胶退仓单): 扩 塑胶退仓单+明细单(工模编号/订单单号)+Create/Get回读+测试

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 2: 前端 泛化录入页 + config + 路由

**Files:** Create `web/src/pages/plastics/PlasticReceiptFormConfigs.ts`; Modify `web/src/pages/plastics/PlasticReceiptFormPage.tsx`, `web/src/App.tsx`

- [ ] **Step 1: config** Create `web/src/pages/plastics/PlasticReceiptFormConfigs.ts`:

```ts
export interface PlasticReceiptFormCfg { resource: string; menu: string; title: string; allowReceiptPick?: boolean }
export const PLASTIC_RECEIPT_FORM_CONFIGS: Record<string, PlasticReceiptFormCfg> = {
  "plastic-receipts":          { resource: "plastic-receipts",          menu: "塑胶入仓单", title: "塑胶入仓（加工入仓）" },
  "plastic-warehouse-returns": { resource: "plastic-warehouse-returns", menu: "塑胶退仓单", title: "塑胶退仓（加工退仓）", allowReceiptPick: true },
};
```

- [ ] **Step 2: 泛化录入页** 用以下完整内容覆盖 `web/src/pages/plastics/PlasticReceiptFormPage.tsx`(改为接 cfg + 退仓带出入仓单):

```tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, Col, Form, Input, Popconfirm, Row, Space, Statistic, Table, Tag, message } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { plasticSupplierDocApi, type PSDHeader, type PSDLine } from "../../api/plasticSupplierDoc";
import { plasticDocApi } from "../../api/plasticDocs";
import SupplierPicker from "./SupplierPicker";
import PlasticReceiptPicker from "./PlasticReceiptPicker";
import PlasticReceiptLineTable from "./PlasticReceiptLineTable";
import type { PlasticReceiptFormCfg } from "./PlasticReceiptFormConfigs";
import { can, hidePrice } from "../../auth/permissions";
import { usePerms } from "../../auth/PermissionContext";

const today = () => new Date().toLocaleDateString("zh-CN");
const currentUser = () => localStorage.getItem("erp_user") ?? "";

export default function PlasticReceiptFormPage({ cfg }: { cfg: PlasticReceiptFormCfg }) {
  const MENU = cfg.menu;
  const docApi = useMemo(() => plasticSupplierDocApi(cfg.resource), [cfg.resource]);
  const perms = usePerms();
  const priceHidden = hidePrice(perms, MENU);
  const [form] = Form.useForm<Record<string, unknown>>();
  const [lines, setLines] = useState<PSDLine[]>([]);
  const [rows, setRows] = useState<PSDHeader[]>([]);
  const [opened, setOpened] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const readOnly = opened !== null;

  const loadRows = useCallback(async () => {
    try { setRows((await docApi.list(1, 50, "")).items); }
    catch { message.error("加载单据失败"); }
  }, [docApi]);
  useEffect(() => { loadRows(); }, [loadRows]);

  const reset = useCallback(() => {
    form.resetFields();
    form.setFieldsValue({ 日期: today(), 操作员: currentUser() });
    setLines([]); setOpened(null);
  }, [form]);
  useEffect(() => { reset(); }, [reset, cfg.resource]);

  const bringFromReceipt = async (单号: string) => {
    try {
      const d = await plasticDocApi("plastic-receipts").get(单号);
      const h = d.单头 as { 供应商编号?: string; 供应商名称?: string; 订单单号?: string } | undefined;
      form.setFieldsValue({ 入仓单号: 单号, 供应商编号: h?.供应商编号, 供应商名称: h?.供应商名称, 订单单号: h?.订单单号 });
      setLines((d.明细 ?? []).map(l => ({
        订单单号: (l as { 订单单号?: string }).订单单号, 生产单号: l.生产单号, 款号: l.款号,
        工模编号: (l as { 工模编号?: string }).工模编号, 物料编号: l.物料编号, 物料名称: l.物料名称,
        规格: l.规格, 颜色: l.颜色, 塑胶货号: l.塑胶货号, 仓位号: l.仓位号, 单位: l.单位,
        数量: Number(l.数量 ?? 0), 单价: l.单价 ?? undefined,
      })));
      message.success(`已带出入仓单 ${单号} 的明细`);
    } catch { message.error("带出入仓单明细失败"); }
  };

  const openDoc = async (单号: string) => {
    try {
      const d = await docApi.get(单号);
      const h = d.单头 ?? {} as PSDHeader;
      form.setFieldsValue({
        供应商编号: h.供应商编号, 供应商名称: h.供应商名称, 仓库: h.仓库, 备注: h.备注,
        日期: h.日期?.slice(0, 10), 操作员: h.操作员, 入仓单号: h.入仓单号, 电脑单号: h.电脑单号, 订单单号: h.订单单号,
      });
      setLines(d.明细 ?? []); setOpened(单号);
    } catch { message.error("打开单据失败"); }
  };

  const save = async () => {
    if (readOnly) { message.info("查看模式:请先「新建」再录入"); return; }
    let v: Record<string, unknown>;
    try { v = await form.validateFields(); } catch { return; }
    const ok = lines.filter(l => l.物料编号 && Number(l.数量) > 0);
    if (ok.length === 0) { message.error("请至少录入一行有效物料明细(物料编号+数量)"); return; }
    setSaving(true);
    try {
      await docApi.create({ ...v, 明细: ok });
      message.success(`${cfg.title}单已创建`); reset(); loadRows();
    } catch (e) {
      message.error((e as { response?: { data?: { 消息?: string } } }).response?.data?.消息 ?? "创建失败");
    } finally { setSaving(false); }
  };

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); message.success(ok); loadRows(); }
    catch (e) { message.error((e as { response?: { data?: { 消息?: string } } }).response?.data?.消息 ?? "操作失败"); }
  };

  const 数量合计 = lines.reduce((s, l) => s + Number(l.数量 ?? 0), 0);
  const 金额合计 = lines.reduce((s, l) => s + Number(l.数量 ?? 0) * Number(l.单价 ?? 0), 0);

  const listColumns = [
    { title: "单号", dataIndex: "单号", key: "单号", render: (v: string) => <a onClick={() => openDoc(v)} className="erp-num">{v}</a> },
    { title: "供应商", dataIndex: "供应商名称", key: "供应商名称" },
    { title: "仓库", dataIndex: "仓库", key: "仓库" },
    { title: "数量", dataIndex: "数量", key: "数量" },
    { title: "日期", dataIndex: "日期", key: "日期", render: (v?: string) => v?.slice(0, 10) },
    { title: "状态", dataIndex: "审核", key: "审核", render: (v?: string) => v === "1" ? <Tag color="green" style={{ borderRadius: 6 }}>已审核</Tag> : <Tag style={{ borderRadius: 6 }}>未审核</Tag> },
    {
      title: "操作", key: "_op",
      render: (_: unknown, row: PSDHeader) => (
        <Space>
          {row.审核 !== "1" && can(perms, MENU, "审核") && <a onClick={() => act(() => docApi.approve(row.单号!), "已审核")}>审核</a>}
          {row.审核 === "1" && can(perms, MENU, "反审核") && <a onClick={() => act(() => docApi.unapprove(row.单号!), "已反审核")}>反审核</a>}
          {row.审核 !== "1" && can(perms, MENU, "删除") && (
            <Popconfirm title="确认删除该单据?" onConfirm={() => act(() => docApi.remove(row.单号!), "已删除")}><a>删除</a></Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <Card title={`${cfg.title}单${readOnly ? `（查看 ${opened}）` : "（新建）"}`} variant="borderless"
      extra={
        <Space wrap>
          <Button onClick={reset}>新建</Button>
          {can(perms, MENU, "保存") && <Button type="primary" loading={saving} disabled={readOnly} onClick={save}>保存</Button>}
          <Button onClick={() => window.print()}>打印</Button>
        </Space>
      }>
      <Form form={form} layout="vertical" size="small">
        <Row gutter={12}>
          <Col span={6}>
            <Form.Item name="供应商名称" label="供应商" rules={[{ required: true, message: "请选供应商" }]}>
              <Input readOnly placeholder="点🔍选供应商"
                suffix={readOnly ? null : <SearchOutlined style={{ cursor: "pointer", color: "#1677ff" }} onClick={() => setSupplierOpen(true)} />} />
            </Form.Item>
            <Form.Item name="供应商编号" hidden><Input /></Form.Item>
          </Col>
          <Col span={4}><Form.Item name="日期" label="日期"><Input disabled /></Form.Item></Col>
          <Col span={5}>
            <Form.Item name="入仓单号" label="入库单号">
              {cfg.allowReceiptPick
                ? <Input readOnly placeholder="点🔍选入仓单带出"
                    suffix={readOnly ? null : <SearchOutlined style={{ cursor: "pointer", color: "#1677ff" }} onClick={() => setReceiptOpen(true)} />} />
                : <Input disabled={readOnly} />}
            </Form.Item>
          </Col>
          <Col span={5}><Form.Item name="订单单号" label="订单单号"><Input disabled={readOnly} /></Form.Item></Col>
          <Col span={4}><Form.Item name="电脑单号" label="电脑单号"><Input disabled /></Form.Item></Col>
        </Row>
        <Row gutter={12}>
          <Col span={3}><Form.Item name="仓库" label="仓库" rules={[{ required: true, message: "请填仓库" }]}><Input disabled={readOnly} /></Form.Item></Col>
          <Col span={4}><Form.Item name="操作员" label="操作员"><Input disabled /></Form.Item></Col>
          <Col span={17}><Form.Item name="备注" label="备注"><Input disabled={readOnly} /></Form.Item></Col>
        </Row>
      </Form>

      <PlasticReceiptLineTable value={lines} onChange={setLines} readOnly={readOnly} hidePrice={priceHidden} />

      <Space style={{ marginTop: 16 }} size={32}>
        <Statistic title="数量合计" value={数量合计} />
        {!priceHidden && <Statistic title="金额合计" value={金额合计.toFixed(2)} />}
        <Statistic title="制单人" value={currentUser()} />
      </Space>

      <div style={{ marginTop: 24 }}>
        <Table rowKey="id" size="middle" dataSource={rows} columns={listColumns} pagination={{ pageSize: 10 }} />
      </div>

      <SupplierPicker open={supplierOpen}
        onPick={row => form.setFieldsValue({ 供应商编号: row.供应商编号, 供应商名称: row.供应商名称 })}
        onClose={() => setSupplierOpen(false)} />
      {cfg.allowReceiptPick && <PlasticReceiptPicker open={receiptOpen} onPick={bringFromReceipt} onClose={() => setReceiptOpen(false)} />}
    </Card>
  );
}
```

注:`plasticDocApi`、`PlasticReceiptPicker` 的 import 路径若与实际不符,以 READ 旧 `PlasticSupplierDocFormPage.tsx` 的对应 import 为准(那里有现成 `bringFromReceipt` 用法)。`PlasticReceiptPicker` 的 `onPick` 回调签名以其源文件为准(传 单号 字符串)。

- [ ] **Step 3: 路由** 改 `web/src/App.tsx`:
  - 顶部 import 改/加:`import PlasticReceiptFormPage from "./pages/plastics/PlasticReceiptFormPage";`(已存在则保留)、`import { PLASTIC_RECEIPT_FORM_CONFIGS } from "./pages/plastics/PlasticReceiptFormConfigs";`。
  - `plastic-receipts` 路由(当前 `<PlasticReceiptFormPage />`)改为 `<PlasticReceiptFormPage cfg={PLASTIC_RECEIPT_FORM_CONFIGS["plastic-receipts"]} />`。
  - `plastic-warehouse-returns` 路由由 `<PlasticSupplierDocFormPage cfg={PLASTIC_SUPPLIER_DOC_CONFIGS["plastic-warehouse-returns"]} />` 改为 `<PlasticReceiptFormPage cfg={PLASTIC_RECEIPT_FORM_CONFIGS["plastic-warehouse-returns"]} />`。
  - 退料/报废 两路由不动(仍用 `PlasticSupplierDocFormPage` + `PLASTIC_SUPPLIER_DOC_CONFIGS`)。`PlasticSupplierDocFormPage`/`PLASTIC_SUPPLIER_DOC_CONFIGS` import 保留(退料/报废仍用)。

- [ ] **Step 4: 测试 + 构建**

Run: `npm --prefix D:\WebpageERP\web run test` → 54 不减。
Run: `npm --prefix D:\WebpageERP\web run build` → tsc 干净 + 构建成功。

- [ ] **Step 5: Commit**

```powershell
git add web/src/pages/plastics/PlasticReceiptFormConfigs.ts web/src/pages/plastics/PlasticReceiptFormPage.tsx web/src/App.tsx
git commit -m @'
feat(塑胶退仓单): 泛化加工入仓单录入页为config共用(入仓/退仓)+退仓带出入仓单+路由切换

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 3: 冒烟 + 终审 + 合并 + worklog

- [ ] **Step 1: 冒烟**

确保 Release 新:`dotnet build -c Release`(被锁先 `Stop-Process`)。起后端(`--contentRoot "D:\WebpageERP\src\ErpApi\bin\Release\net8.0"`·env ERP_DB/ERP_JWT_KEY·`ASPNETCORE_URLS=http://127.0.0.1:5000`),待就绪。Node axios(`proxy:false`):admin 登录 →
①POST `/api/plastic-receipts`(垫库存:供应商/仓库 塑胶仓/明细 物料 WRSMK 数量20 单价2)→ approve;
②POST `/api/plastic-warehouse-returns` body `{供应商编号:"S01",供应商名称:"测试车间",仓库:"塑胶仓",订单单号:"ZCS-WRS",明细:[{生产单号:"WRS-MO",款号:"K-WRS",工模编号:"GM-WRS",物料编号:"WRSMK",物料名称:"ABS粒",颜色:"黑",塑胶货号:"H-WRS",单位:"kg",数量:8,单价:2}]}` → 取 单号 → GET `/api/plastic-warehouse-returns/{单号}` 验证 单头.订单单号=ZCS-WRS、明细[0].工模编号=GM-WRS、明细[0].订单单号=ZCS-WRS(缺省取头)→ approve →
③GET `/api/plastic-inventory?keyword=WRSMK` 数量=20−8=12(**退仓 − 方向**)。清理:两单 unapprove+delete(SQL 或 API)。

Expected: 退仓 Get 回读 订单单号/工模编号 正确;审核后库存 20→12(退仓减)。

- [ ] **Step 2: opus 全分支终审**

派 opus 对 `feat-plastic-wh-return-faithful` 全分支终审:DB ALTER 幂等;DTO/Create/Get 三处列对齐(列名/@参/SELECT·明细订单单号缺省取头);**库存 LedgerUnion 退仓支(−)未改**;脱敏不变;前端泛化页 cfg 驱动(resource/menu/title/allowReceiptPick)·入仓 allowReceiptPick=false 无 picker·退仓 true 有 PlasticReceiptPicker+bringFromReceipt(带出含 工模编号/订单单号)·路由切换且 退料/报废 共享件未受影响·PlasticReceiptLineTable 复用未改;测试自洽(免款号总表父行·Create→Get 回读两态)。目标 READY TO MERGE。

- [ ] **Step 3: 合并 master**

```powershell
git checkout master
git merge --no-ff feat-plastic-wh-return-faithful -m @'
Merge branch 'feat-plastic-wh-return-faithful' into master

塑胶退仓单录入保真(复用加工入仓单表单·泛化config共用·扩工模编号/订单单号·库存−方向不变)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
git branch -d feat-plastic-wh-return-faithful
```

- [ ] **Step 4: worklog + MEMORY** Create `docs/worklogs/2026-06-27-plastic-warehouse-return-faithful.md`;更新塑胶模块记忆 + 把 [[erp-plastic-receipt-return-same-form]] 标为已落地。Commit。

```powershell
git add docs/worklogs/2026-06-27-plastic-warehouse-return-faithful.md
git commit -m @'
docs(worklog): 塑胶退仓单录入保真 2026-06-27

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## 自审清单(已核对)

- **Spec 覆盖**:DB ALTER=Task1 Step1;DTO=Step2;Create=Step3;Get=Step4;测试=Step5;前端 config/泛化页/路由=Task2;冒烟(退仓−方向)/终审/合并=Task3。无遗漏。
- **类型一致**:后端退仓 DTO 加 工模编号(明细 Detail+Create)/订单单号(头 Detail+Create、明细 Detail+Create);前端 PSDLine/PSDHeader 已含可选列(入仓增量已加),无需再改。
- **库存不变**:LedgerUnion 退仓支(−)未触碰,新增列与聚合(物料编号×仓库)无关。
- **缺省取头**:明细订单单号 `l.订单单号 ?? dto.订单单号`;测试 + 冒烟覆盖。
- **泛化不破坏**:PlasticReceiptFormPage 由无 props 改为接 cfg;入仓路由同步改为传 cfg(否则 cfg undefined 崩)。退料/报废 仍用共享件,config/路由未动。
- **allowReceiptPick**:入仓 false(普通输入·无 picker)、退仓 true(🔍+PlasticReceiptPicker+bringFromReceipt 带出工模编号/订单单号)。
- **content root + Release 新**:冒烟 Step1 明确 `dotnet build -c Release`(被锁先 Stop-Process)+ `--contentRoot 输出目录`。
- **测试 using**:含 `using Dapper;`。
