# 2026-08-05 塑胶仓加工件发外需求计算(流程图第 3 步)

## 口径(用户确认)
需发数量 = 需求量(生产单接单数 × BOM 用量) − 白件(未加工胶件)现有库存 − 已发外未回数量,下限 0。

## 改动清单
### 后端(新模块 Features/Plastics/PlasticProcessDemand/,注册见 Program.cs)
- GET /api/plastic-process-demand?生产单号=(权限 塑胶物料单·打开):
  - 需求源:生产制单货号 × 款号物料明细表,**仅 BOM 台头 审核='1'**;只保留 加工内容/二次加工内容 非空(取自塑胶共用物料表)的行;二次加工件按 SecondProcessCategory 既有规则展开两行(第一次/第二次+加工字母)。
  - 白件库存:复用 PlasticInventoryService.StockOfAsync(塑胶台账 6 支聚合)。
  - 已发未回:已审核塑胶加工采购单明细订购 − 已审核塑胶入仓(按 生产单号+物料编号+颜色;口径同物料发外欠数表的"订购−已回",但欠数表可选审核过滤,这里固定只算已审核单——未审核不算"已发",代码注释已注明)。
  - 返回行:工模编号/物料编号/物料名称/颜色/加工内容/加工次序/加工字母/需求量/白件库存/已发未回/需发数量。
- POST /api/plastic-process-demand/create-orders(塑胶物料单·保存):选中行按 加工厂编号+加工内容 分组,复用 PlasticProcessPurchaseOrderService.CreateAsync 生成未审核塑胶加工采购单;**幂等**:同 生产单号+物料编号+加工内容 已有明细的行跳过(返回 跳过 数);写审计。
### 前端
- web/src/api/plasticProcessDemand.ts(新):demand/createOrders 封装+类型。
- PlasticMaterialAnalysisPage.tsx:页面上方"加工件发外需求"Card——已审核生产单下拉 + 计算按钮 → 需求表(需发数量红色加粗、行内加工厂 Select(factories)+单价 InputNumber、勾选)→ "生成加工采购单"(保存权限门控)→ 提示单号/跳过数并重算;固定表头 y:380;单价列随 hidePrice 隐藏。

## 验证
- dotnet build 0 错;dotnet test 212 过;npm run build 过;npm test 310 过;eslint 改动文件 1=基线 1(set-state-in-effect 同款)。
- curl(SC20260803002,77772×1000台):返回 3 行电镀件(57001902 A08-唱盘CD、57001918 A07-麦克风奖杯、57001919 A06-音符奖杯),各行 需求=1000(=1000×用量1)、白件=500、已发未回=0、**需发=500**,与台账一致。
- create-orders:57001902×500 生成 **SJ20260806001**(未审核,明细 加工内容=电镀/数量 500/单价 0.05);重放 → {单号列表:[],跳过:1}(幂等生效);验证单已删。
- Playwright:页面区块渲染正常,三行数字与 API 一致(截图 process_demand.png)。
- 部署:后端 Development 重启;web/dist 已同步 src/ErpApi/wwwroot(index-3JHDoE5F.js)。

## 遗留问题
- 白件库存取台账全量(入仓含加工回仓件)。当前流程加工回仓与白件入仓都进 塑胶入仓明细单,台账无法区分白件/加工件;若后续加工回仓量大,需引入仓库或单据类型区分(如 白件领料单 已存在 PlasticWhitePartIssue,但台账未含它)。
- 重算后行内已填加工厂/单价不保留(后端不返回);如需保留可前端按 物料编号+加工内容 合并。
- 已发未回按 生产单号+物料编号+颜色 聚合(欠数表同口径),同一加工件多次发外/多颜色混行时会有摊算误差。
- 57001908 的 套数 留空问题(源数据矛盾)仍在,未影响本功能。
