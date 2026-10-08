# 半成品报废单（自由选产品版）— 全套接入

日期：2026-07-21
分支：codex/semi-finished-label-order

## 背景
桌面版「半成品报废单」截图对照，Web 端菜单原为占位 `M("半成品报废单")`（无路由）。
本次按 `半成品退库单`(SemiStockReturn) 净新单据模板 1:1 落地报废单：库存方向 **−**（报废=扣库）。

## 结构与退库单差异
- 表头 `退料人` → `报废人`；标题 `半成品退库单` → `半成品报废单`。
- 明细列与截图一致：装配采购/配件编号/客户/产品货号/产品名称/产品装配名称/生产单号/数量/备注。
- 库存 union 分支用 `数量*-1`（退库用 `+数量`）。
- 单号前缀 `BBF`（BL/BTK/BF/SBF 已占用），DocType `半成品报废单`，权限菜单 `半成品报废`。
- 资料查询复用 `SemiFinishedLabelProductPicker`（截图2 原料资料查询）。

## 变更清单（全套：表/种子/DI/白名单/MenuCatalog/菜单/路由/union）
**新增**
- `db/migrate_semi_scraps.sql` — 半成品报废单 + 半成品报废明细单
- `db/seed_semi_scrap_perms.sql` — 菜单=半成品报废，含 单价/金额 位
- `src/ErpApi/Features/Warehouse/Semi/SemiScrapDtos.cs`
- `src/ErpApi/Features/Warehouse/Semi/SemiScrapService.cs`（Prefix=BBF, DocType=半成品报废单）
- `src/ErpApi/Features/Warehouse/Semi/SemiScrapController.cs`（Route `api/semi-scraps`, Menu=半成品报废）
- `web/src/pages/warehouse/SemiScrapPage.tsx`
- `web/src/utils/semiScrap.ts` + `web/src/__tests__/semiScrap.test.ts`

**修改**
- `web/src/api/semi.ts` — `semiScrapApi` + 类型
- `web/src/App.tsx` — import + `<Route path="semi-scraps">`
- `web/src/nav/menuTree.tsx` — 占位补全为 `M("半成品报废单","/semi-scraps","半成品报废")`
- `src/ErpApi/Program.cs` — DI `SemiScrapService`
- `src/ErpApi/Engines/Posting/PostableDocuments.cs` — 白名单 `半成品报废单`
- `src/ErpApi/Engines/Inventory/InventorySummaryService.cs` — SemiSql 追加 `数量*-1` 分支
- `src/ErpApi/Features/Admin/MenuCatalog.cs` — `("半成品仓库","半成品报废")`
- `db/run-db.ps1` — 注册两个新脚本

## 验证 & 部署清单（Windows / PowerShell）

### 1. 后端编译
```powershell
dotnet build WebpageERP.sln
```
关注新文件 SemiScrap{Controller,Service,Dtos}.cs + 4 处接线（Program.cs / PostableDocuments / InventorySummaryService / MenuCatalog）。

### 2. 后端测试
```powershell
dotnet test tests\ErpApi.Tests\ErpApi.Tests.csproj
```
`PostableDocumentsTests` 应仍全绿（不枚举白名单，加 半成品报废单 不影响）。

### 3. 前端编译 + 测试
```powershell
cd web
npm ci
npm run build     # tsc -b && vite build，全量类型检查
npm run test      # vitest run，含 semiScrap.test.ts
```

### 4. 数据库部署（**erp 与 erp_test 两库都要跑**）
```powershell
# 生产库
dotnet run --project tools\DbDeploy -- "<erp 连接串>" `
  db\migrate_semi_scraps.sql db\seed_semi_scrap_perms.sql
# 测试库
dotnet run --project tools\DbDeploy -- "<erp_test 连接串>" `
  db\migrate_semi_scraps.sql db\seed_semi_scrap_perms.sql
```
> 教训沿用：迁移必须同时部署到 **erp 与 erp_test**，否则一库 create 515 / 另一库缺表。

### 5. 应用内冒烟（账号需有「半成品报废」权限）
- [ ] 菜单「半成品仓库 → 半成品报废单」进入，路由 `/semi-scraps`
- [ ] 「资料」弹原料资料查询，勾选产品带入明细行
- [ ] 填数量 → 保存 → 单号 `BBF+日期+序号`
- [ ] 审核 / 反审核正常；已审核不能改删
- [ ] 前单/后单、复制单、删除正常
- [ ] **审核后**「半成品库存统计表」对应物料库存**减少**报废数量（方向正确性核心验证：union 分支为 `数量*-1`）

## 待办
- 本机无 dotnet/node，未本地编译/跑测试；以上清单在 Windows 执行。
- 工具栏「装配采购清单」按钮暂 disabled（与退库单一致，后续实现）。
- 半成品报表组的「半成品报废查询」仍为占位，后续补。
