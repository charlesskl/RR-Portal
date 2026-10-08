# 2026-08-05 全修计划第一批:后端口径类 6 项

## 逐项状态与实测证据

### 1. BOM 台头审核后禁止改保存 ✅
- StyleService.ReplaceMaterialsAsync:UPDLOCK 查 款号物料总表.审核='1' → InvalidOperationException("该 BOM 已审核，请先反审核再修改")(与装配 调整审核 两套并存)。
- curl:77772 已审核 PUT → 409"款号 [77772] 的 BOM 已审核，请先反审核再修改。";反审核 204 → PUT 200(35 行完好)→ 再审核 204。前端保存失败透传 {消息} 链路已有(save catch errMsg)。

### 2. 装配类报表快照化 ✅(核查结论:07-28/08-04 已实现,本轮只验证未改码)
- AssemblyPurchaseQueryService 已是"落库单快照 ∪ 实时展开"混合口径(NOT EXISTS 整组排重,删单自动回实时),覆盖 summary/detail/tracking/required-materials/factory-inventory/auxiliary-issue-progress/factory-category-monthly 七个端点。
- AssemblyMaterialSummaryService(装配物料汇总表)是 BOM 设置清单报表,列的就是"当前设置",实时读为正确语义,未动。
- curl 两场景:造落库单 ZP20260806001 → summary/detail 出现快照行(加工数量 1000);删单 204 → summary 回到仅实时虚拟行(ZP4)。8 个端点全 200。

### 3. 采购订单日期可改 ✅
- PurchaseOrderCreateDto 加 日期(可空);CreateAsync 用 dto.日期 ?? 当天;UpdateAsync `COALESCE(@日期,[日期])` 更新单头+明细日期。前端 Drawer 日期 DatePicker 本就可编辑,save body 补 日期 字段;api 类型同步。
- curl:建单 日期=2026-08-01 → GET 确认 → PUT 改 2026-08-02 → GET 确认 → 删单清理。

### 4. 报表门槛 + 超数红字 ✅
- ProductionReportService:采购超数查询/领料超数查询 加 `JOIN 生产制单 审核='1'` 门槛(说明书 1-3:仅已审核生产通知单出数;"已做采购分析"本就是前提——需求取自 生产BOM物料清单快照,无分析自然无行)。制单用料查询是单点查询未加(见遗留)。
- 红字:前端两页已有(超数Cell/差异Cell 负数橙/正数红),无需改。

### 5. 盘点数量禁负数 ✅
- 三个盘点服务(MaterialStocktake/PlasticStocktake/PlasticRawMaterialStocktake)CreateAsync 加 `盘点数量<0 → ArgumentException("盘点数量不能为负")`。
- curl:来料/塑胶盘点 负数 → 均 400"盘点数量不能为负"。

### 6. 删除 5 个死接口 ✅
- 删 PlasticLabelQueryController.cs 整个文件;PurchaseReceiptController 的 label-query/detail|summary 两动作;PricingController 的 GET material;FinishedSalesReturn/FinishedVendorReturnController 的 GET {单号}(连带 CreatedAtAction(nameof(Get)) 改 StatusCode(201))。服务层方法保留(DB 测试在用)。
- 验证:死接口请求落到 SPA fallback(HTML)即路由已删;活接口(plastic-label-orders/label-query 等)正常 200 JSON;dotnet build 0 错。

## 总验证
- dotnet test 212 过 0 败;npm test 310 过;npm run build 过;eslint 改动文件 1=基线 1。
- 部署:后端 Development 重启;web/dist 已同步 src/ErpApi/wwwroot(index-CKjJ0zgU.js)。
- 未 git commit(等全修计划完成后统一提交)。

## 遗留
- 制单用料查询(按生产单点查)未加审核门槛——单点查询语义,需要时一行 JOIN 即可。
- 装配快照/实时配对边界:生产单未录 MO 行时,实时虚拟单归属键为 (null,款号),与快照 (生产单号,款号) 配不上,两行并存(服务注释已载明该边界)。
- SPA fallback 使"接口不存在"返回 200 HTML 而非 404,验证死接口须看响应体类型。

---

# 2026-08-06 追加:全修计划第二批(前端体验类 3 项)

## 7. BOM 明细多选批量加料 + 中间插行 ✅
- BomSetupPage.tsx:选料弹窗(页面内联 Modal,物料页签)加 rowSelection 多选 + "多选加入(N)" 按钮,勾选行一次性追加(字段映射同单行加入,用量留空);点 checkbox 列不再误触单行加入;数据刷新清空勾选防错位。
- 明细操作列扩为"插入|删":插入 = 该行下方 splice 空行(同添加行结构)。
- Playwright:77772 反审核后开 picker(35 行)→ 勾 2 行("多选加入(2)"高亮)→ 明细 57xxx 输入框 35→37;插入 8→9 行。未保存,现场已恢复(再审核 204、TESTV-PICK 款号已删)。截图 b2_picker_checked.png/b2_multi_added.png。

## 8. 供应商资料页加左树 ✅
- 新建 web/src/pages/master/SupplierMasterPage.tsx(左类别树带计数+新增同级/子类别(供应商类别·保存门控)+右表双击选中/工具栏增删改/新增默认带当前类别),MasterRouter 将 供应商资料 指向新页(其余主数据菜单仍走通用 MasterDataPage,机制未动)。
- **与任务假设的差异**:供应商类别 主数据无父级列(实体只有 类别/名称),树做成一级;"新增子类别"实际也建一级(两级需后端先给类别表加父级列)。职务/传真/邮政编码/电子邮箱 4 个表单字段后端实体未映射,保存会被静默丢弃(需后端加列才真正持久化)。存量供应商的 供应商类别 是旧编号("6"/"9"),与类别主数据对不上的行只在"全部供应商"下出现。
- Playwright:左树"全部供应商"+类别按钮齐、右表 50 行(截图 b2_supplier.png)。

## 9. 权限接线:发外对数/计件汇总 ✅
- 后端 OutsourceController.reconcile(菜单"发外对数")/PieceworkController.summary(菜单"计件汇总")本就按这两个权限名门控;缺的是前端页面门控。
- OutsourceReconcilePage/PieceworkSummaryPage 补 can(perms,"发外对数"/"计件汇总","打开") + 无权访问提示(项目惯例)。两页不在 menuTree(URL 直达),无需菜单项对齐。

## 总验证
- npm run build 过;npm test 310 过;eslint:BomSetupPage 3 个=基线 3,新页面为基线同款 set-state-in-effect 类(全仓既有模式),无新类别错误。
- dist 已同步 src/ErpApi/wwwroot;未 git commit。

---

# 2026-08-06 追加:全站窄文本列加宽防折行

## 方法
- 静态扫描(grep 列定义 width≤90 文本列)+ Playwright 行高实测(行高 >1.35×中位数标记)+ 单元格级 Range 高度定位(>30px 即两行)。

## 修复(只动列宽)
- PlasticMaterialMasterPage:工模编号 130→150、物料名称 140→170、原料名称 90→130、用料名称 100→200。
- PlasticMoldPage:用料名称 110→200。
- MaterialMasterPage:颜色 80→110。
- PlasticMaterialDocDrawer:工模编号 90→140(明细/汇总两处)。

## 实测
- 修复前折行点:塑胶物料资料(3 行 83px vs 中位 61:用料名称"透明MABS TX-0520IM-NP"等)、工模表(5 行 61 vs 39:用料名称)。
- 修复后行高实测:plastic-material-master 35 行全 39、plastic-molds 23 行全 39、material-master 50 行统一 61(本就等高)——全部无折行。截图 after_pmm/after_molds/after_mm.png。
- npm run build 过;npm test 310 过。
- 其余页面(部门人事/供应商/库存/生产/采购等 11 页)实测行高均匀,未动。
- 部署:web/dist 已同步 src/ErpApi/wwwroot。

---

# 2026-08-12 追加:采购+仓库线"减动作"优化 3 项

## 1. 入仓整单带入、默认全收 ✅
- 来料(MaterialLineTable,orderPicker 模式):新增"整单带入"按钮→输入采购单号→purchaseOrderApi.progress(onlyOwed) 全量欠数行前端按单号精确过滤→整单填入,数量=欠数(单行带入原本就默认欠数,本次补整单);表头供应商空时带出(onSupplier 传到抽屉回写)。**坑:progress 的 keyword 不匹配采购单号(只匹配生产单号/款号/物料),首版带 keyword 查询恒空,改全量拉取+前端过滤修复**。
- 塑胶入仓(PlasticReceiptFormPage,仅 plastic-receipts):"从采购单带入"→弹窗列已审核有欠数塑胶采购单(plastic-purchase-progress onlyOwed)→选单→欠数行填入(数量=欠数),单头供应商/订单单号带出(plasticPurchaseOrderApi.get 补供应商编号)。
- Playwright:塑胶 SP20260812002(TESTV)→57001896×10.00/57001897×20.00 带入正确;来料 PO20260812001→01030008 数量=30.00 全收欠数(截图 ux_receipt_bring.png / ux_material_receipt_bring.png)。

## 2. 领料按生产单一键带入 ✅
- 后端新增 GET /api/production/{生产单号}/issue-basis?档=来料|塑胶(生产通知单·打开):按生产BOM物料清单快照聚合 应领=Σ总数量(接单数×用量,需求侧不扣库存);档按 物料资料 存在性过滤(来料=存在,塑胶=不存在)。
- 前端:来料领料(MaterialLineTable usageCols 模式)与塑胶领料(PlasticIssueFormPage)各加"按生产单带入"按钮→输入生产单号→整单填入。
- Playwright:SC20260803002 → 塑胶档 35 行,57001896=1000(用量1×1000)、57001908=2000(用量2×1000)(截图 ux_issue_bring.png)。

## 3. 列表页批量审核 ✅
- MaterialDocPage(来料通用,覆盖采购入仓/领料等)、PlasticReceiptFormPage、PlasticIssueFormPage:列表加 rowSelection + "批量审核"按钮(各菜单"审核"权限门控),仅未审核勾选行逐张 approve,汇总提示"已审核 X 张/失败 Y 张(原因)"并刷新。
- Playwright:勾 2 张 TESTV 塑胶入仓单 → "已审核 2 张"(截图 ux_batch_approve.png)。

## 验证与清理
- dotnet build 0 错;dotnet test 212 过;npm run build 过;npm test 310 过;eslint 7=基线 7。
- TESTV 单据(塑胶入仓×2/塑胶采购/来料采购)全部反审核+删除,残留 0;正式单 SP/SR/SLL20260805001 与 SC20260803002 完好。
- 部署:后端 Development 重启;web/dist 已同步 src/ErpApi/wwwroot。
- **环境事故记录**:本轮 /tmp 被系统清理,erp_env_kv.sh(ERP_DB/ERP_JWT_KEY)丢失、后端被杀且 5000 被 macOS ControlCenter(AirPlay)抢占;已重建 env(新随机 JWT key,DB 无加密配置行,无影响;旧登录态失效重新登录即可)、抢回 5000 重启成功。erp_env_kv.sh 重建于 /tmp(仍易丢,建议重要环境另存)。

## 遗留
- 塑胶入仓带入行的 规格/单价 无来源(塑胶采购订单明细 schema 无此列),单价留空手填。
- 塑胶"从采购单带入"依赖 塑胶进度表·打开 权限,无该权限角色会 403。
- 来料"按生产单带入"对 usageCols 全部单据(领料/退料/报废)都显示,如需限领料单可加配置区分。
