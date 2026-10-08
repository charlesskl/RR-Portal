# 塑胶模块 · P3a 塑胶库存引擎 + 塑胶入仓单 · 设计

> 日期:2026-06-25
> 范围:塑胶模块 P3 仓库阶段的第一子阶段 —— 塑胶库存引擎(实时 UNION)+ 塑胶入仓单(第一个入流单·库存+)+ 一套塑胶专用通用单据前端 + 塑胶库存统计表。
> 上游:P0 塑胶物料资料 `946cab8`、P1 塑胶共用物料表 `31698dc`、P2 塑胶物料单 `80bdb97` 已完成。

## 1. 背景与数据流

镜像物料侧「库存引擎 + 仓库单据」:**库存 = 已审核单据明细的实时 UNION 聚合**(单据不维护余额;审核即过账——翻 `审核='1'` 后该单明细立即计入库存,反审核即移出)。物料侧 UNION 六支:采购入仓(+)/退料(+)/领料(−)/采购退仓(−)/报废(−)/盘点(±盈亏)。

P3a 建塑胶库存引擎的**框架**(UNION 本期只含 塑胶入仓(+) 一支)+ **塑胶入仓单**(第一个入流)。P3b/c/d 各往 UNION 加一支(领料−/退料+/退仓−/报废−/盘点±)。

P3 整体拆分:**P3a 库存引擎+入仓**(本期)→ P3b 领料/退料 → P3c 退仓/报废 → P3d 盘点。

## 2. 目标 / 非目标

**目标(P3a):**
- 塑胶库存引擎 `PlasticInventoryService`(UNION + StockOfAsync + ListAsync),框架可逐支扩展。
- 塑胶入仓单(头 `塑胶入仓单` + 明细 `塑胶入仓明细单`)CRUD + 审核/反审核 + 接入库存 UNION。
- **一套塑胶专用通用单据前端**(config 驱动,行表用 P1 `PlasticMaterialPicker`),P3a-d 六单复用。
- 塑胶库存统计表页(列库存,验证引擎落点)。
- 菜单「塑胶入仓单」+「塑胶库存统计表」落地 + 权限。

**非目标(后续):**
- 领料/退料/退仓/报废/盘点(P3b/c/d);各自建表后再加入 UNION。
- 月结锁(塑胶暂无月结;口径"塑胶"以后接,本期 create/approve 不查 PeriodLock)。
- 塑胶采购订单来源(塑胶入仓本期手工选料,无订单带出)。

## 3. 数据模型(2 新表)

`db/18_plastic_receipt.sql`:

```sql
CREATE TABLE [塑胶入仓单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NOT NULL,
    [日期] datetime NULL,
    [供应商编号] nvarchar(20) NULL,
    [供应商名称] nvarchar(50) NULL,
    [仓库] nvarchar(30) NULL,
    [数量] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [操作员] nvarchar(20) NULL,
    [审核] nvarchar(5) NULL,
    [审核人] nvarchar(20) NULL,
    [审核日期] datetime NULL,        -- PostingEngine 写(P2 教训:必须有)
    [备注] nvarchar(200) NULL
);
CREATE TABLE [塑胶入仓明细单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NOT NULL,
    [日期] datetime NULL,
    [仓库] nvarchar(30) NULL,
    [物料编号] nvarchar(20) NULL,
    [物料名称] nvarchar(40) NULL,
    [规格] nvarchar(40) NULL,
    [颜色] nvarchar(20) NULL,
    [仓位号] nvarchar(30) NULL,
    [单位] nvarchar(20) NULL,
    [数量] decimal(18,4) NULL,
    [单价] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [备注] nvarchar(200) NULL
);
```

## 4. 后端

新 `src/ErpApi/Engines/Inventory/PlasticInventoryService.cs`:
- `LedgerUnion`(本期单支):`SELECT d.物料编号,d.物料名称,d.规格,d.单位,d.仓库,d.数量 FROM [塑胶入仓明细单] d JOIN [塑胶入仓单] h ON h.单号=d.单号 WHERE ISNULL(h.审核,'0')='1'`。后续阶段在此 UNION ALL 追加 领料(−)/退料(+)/退仓(−)/报废(−)/盘点(±盈亏) 各支。
- `StockOfAsync(物料编号)` —— `SELECT ISNULL(SUM(数量),0) FROM (LedgerUnion) WHERE 物料编号=@物料编号`。
- `ListAsync(仓库, keyword)` —— GROUP BY 物料编号×仓库,SUM(数量) HAVING<>0,LEFT JOIN 塑胶物料资料 带 物料类别/仓位号。返回 `PlasticStockRow`。
- `PlasticInventoryController`(`api/plastic-inventory`,`Menu="塑胶库存"`):`GET ?仓库&keyword`。

新 `src/ErpApi/Features/Plastics/PlasticReceipt/`:
- `PlasticReceiptService`(镜像 PurchaseReceiptService):`DocType="塑胶入仓单"` `Prefix="SR"`;`CreateAsync`(单号·头数量/金额合计·逐行明细 金额=数量×单价)/`GetAsync`(头+明细)/`ListAsync`(分页)/`DeleteAsync`(已审核拒删)。
- `PlasticReceiptController`(`api/plastic-receipts`):list/get/create/delete + approve/unapprove(`IPostingEngine.ApproveAsync("塑胶入仓单",单号,user)`);无 单价 权限脱敏 单价/金额。
- DTOs:Header/Line/Detail/CreateDto/CreateLineDto。

**过账接入(P2 教训)**:`PostableDocuments.Map` 加 `["塑胶入仓单"]="单号"`;表已含 审核日期 列。`Program.cs` 注册 `PlasticInventoryService`+`PlasticReceiptService`。

**权限**:`MenuCatalog` 加 `("塑胶仓储","塑胶入仓单")`、`("塑胶报表","塑胶库存")`;`db/seed_plastic_receipt_perms.sql`。

## 5. 前端(塑胶专用通用单据前端)

物料侧 `MaterialDocPage/MaterialDocCreateDrawer/MaterialLineTable` 写死 `MaterialPicker`(物料资料),不可直接复用。新建一套**塑胶专属、config 驱动**的(与物料侧隔离):
- `web/src/api/plasticDocs.ts`:`plasticDocApi(resource)` → list/get/create/remove/approve/unapprove(泛型,同 materialDocs.ts)。
- `web/src/pages/plastics/docs/PlasticDocConfigs.ts`:`PlasticDocCfg { resource, menu, title, headerFields[] }`;本期 config `"plastic-receipts"`(头字段 供应商编号/供应商名称/仓库/备注)。
- `web/src/pages/plastics/docs/PlasticLineTable.tsx`:受控明细行表,**物料编号点🔍弹 `PlasticMaterialPicker`**(P1)回填 物料编号/名称/规格/颜色/仓位号/单位;列 物料/规格/颜色/仓位号/单位/数量/单价/金额(单价/金额按权限隐),加一行/删行。
- `web/src/pages/plastics/docs/PlasticDocCreateDrawer.tsx`:头表单(config.headerFields)+ PlasticLineTable + 合计 + 保存。
- `web/src/pages/plastics/docs/PlasticDocPage.tsx`:列表(单号/日期/headerExtra/数量/金额/状态/操作 审核·反审核·删除)+ 新建抽屉 + 查看抽屉(`PlasticDocDetailDrawer`:头+明细只读,审核/反审核/删除按权限)。
- 塑胶入仓页 = `<PlasticDocPage cfg={PLASTIC_DOC_CONFIGS["plastic-receipts"]} />`,路由 `/plastic-receipts`。
- **塑胶库存统计表** `PlasticInventoryPage`(`/plastic-inventory`):仓库/关键词筛选 + 表(物料编号/名称/规格/物料类别/仓位号/仓库/库存数量)。
- 菜单 ⑧塑胶仓库 `M("塑胶入仓单","/plastic-receipts","塑胶入仓单")`;⑨塑胶报表 `M("塑胶库存统计表","/plastic-inventory","塑胶库存")`。

## 6. 测试

- 后端 `PlasticReceiptServiceDbTests`:create 生成 SR 单号+头明细+金额=数量×单价合计;get 读回;delete 未审核可删/已审核拒删。
- 后端 `PlasticInventoryServiceDbTests`:入仓未审核→库存不计;审核后→`StockOfAsync`/`ListAsync` 计入(+数量);反审核→归零。**审核经 PostingEngine(回归:白名单+审核日期)**。
- 全量:后端全过、前端 tsc/vitest 全过、build ✓。冒烟:create→SR单号→approve→库存出现→unapprove→库存消失。

## 7. 验收标准

1. `db/18` 后两表存在。
2. `/plastic-receipts` 列表/新建(选 P0 塑胶物料·录数量单价)/保存(SR 单号)/审核/反审核/删除。
3. 审核后 `/plastic-inventory` 出现该物料库存(+数量);反审核后消失。
4. 无「塑胶入仓单·单价」权限者 单价/金额 显 `***`。
5. 菜单 塑胶入仓单 / 塑胶库存统计表 可进入。

## 8. 风险 / 决策

- **库存=实时 UNION**(无单独过账写账),审核即过账;UNION 框架本期单支,后续逐支扩展。
- **前端建塑胶专用通用单据组件**(用户确认):不动物料侧已上线共享组件,塑胶选料用 PlasticMaterialPicker;六单复用。
- **单号前缀 SR**(用户确认);DocType="塑胶入仓单"。
- **过账三件套**(白名单+审核日期列+PostableDocuments)P2 已踩坑,本期建表即含 审核日期、白名单同步加,并加审核回归测试。
- **省略月结锁**(塑胶无月结);**省略塑胶采购订单来源**(手工选料)。
- 库存 UNION 列口径用 物料编号×仓库;塑胶物料资料 无 货号,故库存列带 物料类别/仓位号(不带货号)。
