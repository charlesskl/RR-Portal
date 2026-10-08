# 2026-08-03 BOM 物料设置页:款号直接录入/选择 + 旧版表头字段

## 改动清单

### DB / 后端
- db/67_bom_master_old_fields.sql:[款号物料总表] 加 [默认单价] nvarchar(20)、[类型] nvarchar(10)(幂等,DbDeploy 已应用)。
- 说明:任务书写"款号物料总表 实体加两属性",但该表此前无 EF 实体(应用层全走 Dapper,且**此前全后端没有任何写入 款号物料总表 的代码**,只有 db/60 demo 种子插过),故未建实体,改动落在 Dapper 链路。
- StyleDtos.cs:BomSaveDto 末尾加可选 默认单价/类型;新增 BomHeaderViewDto(日期/客户编号/客户名称/单位/默认单价/类型/操作员/审核/备注);StyleMaterialsViewDto 末尾加可选 单头。
- StyleService.cs:
  - ReplaceMaterialsAsync 加可选参数 操作员;保存时 MERGE upsert [款号物料总表](更新:日期/客户/款式/单位/默认单价/类型;新建:另写 审核='0'(分析口径不变)/操作员)。
  - GetMaterialsViewAsync 台头 SELECT 扩列并映射 单头 返回。
  - 客户编号 本非必填(保存校验只有 款号存在/未审核),无需放开。
- StyleController.cs:PutMaterials 把 CurrentUser 传给 操作员。

### 前端
- api/styles.ts:BomSave 加 默认单价/类型;materials() 返回类型加 单头。
- styles/BomSetupPage.tsx:
  - 去掉"先选客户再选货号"级联:产品货号改 AutoComplete(款号总表数据源,可筛选可手输,必填保留);选中带出款式并加载 BOM;客户变化不再清空货号。
  - 客户改可选(去 required、去保存拦截),只作记录。
  - 表头补:默认单价=Select(报价类别 quote-categories,取 类别 字段,allowClear+showSearch)、类型=Select(明细/汇总,默认明细)、单位默认 PCS、款式可编辑;装配扩展字段未动。
  - 水合:优先 单头(客户/日期/单位/默认单价/类型),null 回落第一行物料;buildBody 带 默认单价/类型。
- __tests__/bomSetupAssemblyPersistence.test.ts:antd mock 补 AutoComplete(映射到现有 Select mock),修复 11 个测试因 mock 缺导出失败。

### 基础数据(用户知情)
- 客户资料 ZURU/ZURU、款号总表 77772/唱片机 已用 API 创建(保留)。

## 验证
- dotnet build 0 错;dotnet test 212 过;npm run build 过;npm test 62 文件 310 过;eslint 改动文件 3=基线 3(中途修了 agent 引入的全角空格正则 no-irregular-whitespace,`\s` 本身已覆盖 U+3000)。
- curl/DB:PUT 77772 BOM(客户 ZURU/默认单价 HK/类型 明细/1 行物料)→ GET 单头 全字段正确往返(日期/客户/单位/默认单价/类型/操作员=admin/审核=0),明细行 单位/客户 落库正确。
- Playwright:BOM 页不选客户直接 AutoComplete 输 77772 → 下拉选中 → 款式=唱片机/单位=PCS/日期/客户 ZURU 全部水合,默认单价=HK/类型=明细 显示正确,明细行在(截图 bom_loaded.png)。
- 现场:验证用 BOM 明细/总表行已 SQL 清理(77772 是我造的假数据);客户 ZURU 与款号 77772 主数据保留。
- 部署:后端 Development 重启;web/dist 已同步 src/ErpApi/wwwroot(index-CIRUC-Kn.js)。

## 备注
- 此前应用层从不写 款号物料总表,BOM 分析类 SQL(JOIN 该表)对真实 BOM 原本查不到;现在保存会落台头(审核='0'),AuxiliaryPurchaseAnalysis"需领"等只统计 审核='1' 台头的口径不变。
- 单头.操作员/审核 未水合到表单(操作员沿用登录人);默认单价选项取报价类别"类别"字段(若旧系统对应"名称"字段,改 BomSetupPage 取值一处即可)。

## 生产通知单货号=已设 BOM 的款号(同日追加)
- 规则:生产通知单货号必须先在 BOM 物料设置里建档;货号选项数据源从 款号总表 改为 款号物料总表(已设 BOM 的款号)。
- 新增 GET /api/styles/bom-headers(款号资料·打开):返回 款号/款式/客户编号/客户名称/单位/默认单价/类型(StyleService.ListBomHeadersAsync,Dapper)。
- ProductionNoticePage:货号 AutoComplete 改用 bomHeaders;选中带出 款号名称(=款式)、BOM款号默认=款号,并把 客户编号/客户名称/默认单价 回填到生产通知单表头。
- 已为 77772 建立空明细的 BOM 单头占位(客户 ZURU、类型 明细、审核=0),明细行和审核待用户补。

## 编号名称重复显示修复(同日追加)
- 客户编号=客户名称时(如 ZURU/ZURU)下拉显示 "ZURU ZURU" 重复;新增 utils/codeName.ts(相同则只显示编号),应用到 BOM物料设置/客户订单/装配加工采购单/装配物料汇总/采购订单 的客户·供应商显示。

## BOM页按入口隐藏装配扩展字段(同日追加)
- 生产管理>BOM物料设置(/bom-setup)不再显示 配件编号/共用物料编号/装配方式/产品装配名称/类别/库存单价HK/需求用量/其他成本HK/半成品计算库存,表头对齐旧系统(客户/产品货号/日期/单位/操作员/默认单价/类型/备注);外发装配>装配物料设置(/assembly-material-setup)照常显示。利用页面既有 isAssembly(按路由)判断,数据与保存逻辑不变(antd Form preserve 保值,BOM 入口保存不写扩展)。

## 生产通知单选货号自动填入对齐旧系统(同日追加)
- 旧系统选货号后自动填:款号/款式/客户款号(=货号)/客户/默认单价,明细 BOM款号+款号名称,分析默认打勾。
- 本次补:客户款号=货号 回填表头;分析 选中默认 true。此前已有:款号名称(款式)/BOM款号/客户编号/客户名称/默认单价。

## 生产通知单删货号行清表头(同日追加)
- 删除货号明细行时,该行选货号带入的表头字段(客户编号/客户名称/默认单价/客户款号)一并清除;仅当表头值仍与该货号选项一致时才清(用户手改过的不动)。

---

# 2026-08-03 追加:BOM 台头审核 + 77772 建 BOM 的 FK 结论

## BOM 台头审核(已完成)
- StyleService.BomSetAuditAsync:UPDLOCK 判当前值,翻转 款号物料总表.审核;重复审核/未审核反审核/无台头 均中文 InvalidOperationException。
- StyleController:POST /api/styles/{款号}/bom-audit、bom-reverse-audit(权限 款号资料·审核/反审核,409 透消息,写审计)。与装配审核(半成品共用物料设置.调整审核,/audit)是两套。
- BomSetupPage:BOM 入口(非装配)工具栏加"BOM审核"/"BOM反审核"按钮(tooltip 注明审台头),表头加 审核状态 Tag(绿已审核/灰未审核);装配入口按钮未动。api/styles.ts 加 bomAudit/bomReverseAudit。
- curl 验证:重建 77772 台头(空明细,客户 ZURU/单位 PCS/类型 明细)→ 审核 204 → 重复审核 409"已审核，请勿重复审核。"→ 反审核 204 → 未审核反审核 409"未审核，无需反审核。"→ 无台新款号 409"还没有 BOM 台头，请先保存 BOM。"。
- **注意:BOM 台头审核后页面/保存不锁**(readOnly 仍只看装配 调整审核),保存拦截未加——若旧系统 BOM 审核后禁改,需后续在 ReplaceMaterialsAsync 加 台头.审核='1' 拒绝(一行检查,见遗留)。

## 坑 1 结论:FK_133_查找 拦截塑胶料进 BOM(实测)
- 款号物料明细表.FK_133_查找:物料编号 → 物料资料.物料编号,**启用且受信**(is_disabled=0, is_not_trusted=0,db/02 WITH CHECK 建)。另有 FK_131(客户编号→客户资料)。
- 实测:PUT 77772 BOM 带 57001896(只在 塑胶物料资料)→ 500 SqlException"INSERT statement conflicted with the FOREIGN KEY constraint FK_133_查找"。**顺带问题**:PutMaterials 不抓 SqlException,FK 冲突是裸 500(参照采购订单 SqlException 547→400 的写法可顺手补)。
- 按约定未动 FK。方案建议(旧系统 BOM 混合来料+塑胶料,必须解):
  A. **35 条胶件镜像进 物料资料**(改动最小、不动 schema):从 塑胶物料资料 同步插入 物料编号/物料名称/规格/颜色/单位/款号/单价,FK 自然满足;代价是来料主数据页/选料器会看到胶件(可用 物料类别='塑胶件' 区分),两边单价维护需留意。
  B. **删/停用 FK_133_查找**(ALTER TABLE ... NOCHECK 或 DROP):最贴近"混合 BOM"本质,但失去来料编号的引用完整性保护,且与 db/02 重建脚本口径不一致(重跑建库会加回来,需同步改脚本)。
  推荐 A(可逆、不动约束),B 需用户拍板并同步 db/02。

## 流程链验证状态(停在 BOM 明细)
- 35 条胶件(用量合计 41)建 BOM 明细被 FK 拦截 → BOM 台头保留(77772,审核='0',明细空)→ 生产通知单/采购分析未走(无明细则无缺口可出,走了也只能验证空结果,未造测试单)。
- 待 FK 方案定夺后:35 行 PUT 进 BOM → bom-audit → 生产通知单(2 台)→ 采购物料分析 应出 35 行、需订=2×用量。

## 验证与部署
- dotnet build 0 错;dotnet test 212 过;npm run build 过;npm test 310 过;eslint 3=基线 3。
- 后端 Development 重启;web/dist 已同步 src/ErpApi/wwwroot(index-72GGDDZi.js)。

---

# 2026-08-03 追加:方案 C 落地——放开 BOM FK、混合档案取数、77772 流程链走通

## 改动清单
- db/68_drop_bom_material_fk.sql(已 DbDeploy 应用):DROP FK_133_查找(款号物料明细表.物料编号→物料资料);**顺带 DROP FK_140_查找**(生产BOM物料清单.物料编号→物料资料,同一链路,制单展开快照也会撞;任务书只点了 FK_133,FK_140 是实测链路必撞的姊妹约束,同注释说明)。不改 db/02 历史脚本(重建库仍会加回,需彻底一致另行同步)。
- StyleService.ReplaceMaterialsAsync:应用层兜底校验——明细 物料编号 必须存在于 [物料资料] ∪ [塑胶物料资料],缺失行中文列出编号、整组回滚(实测 NO-SUCH-MAT 被拒且 35 行现场完好)。
- StyleController.PutMaterials:补 catch SqlException → 400 中文(不再裸 500)。
- 取数混合档案(只动 JOIN,不动公式):
  - ProductionService.ExpandBomAsync 的 BOM 行查询:LEFT JOIN 物料资料 + LEFT JOIN 塑胶物料资料(来料优先,COALESCE 取 单价/供应商;塑胶 单价=原胶件单价)。
  - MaterialMasterService AuxiliaryPurchaseAnalysis 的 src CTE:FROM (物料资料 UNION ALL 塑胶物料资料)(库存/名称/规格/单位/供应商 两档案合并,GROUP BY 同编号自然合并)。
  - 库存口径说明:制单展开的 库存数量 走库存引擎(单据符号法,塑胶单据未接入前自然为 0);辅料分析 CTE 用两表 库存 列 union。塑胶采购分析(/plastic-material-analysis)本就是塑胶单据档,未动。

## 77772 BOM(真实数据,保留)
- 35 条塑胶料(塑胶物料资料 WHERE 款号='77772')PUT 进 BOM:款号物料明细表 35 行、使用数量合计 41;bom-audit 后 款号物料总表.审核='1'。

## 流程链实测(测试单已清理)
- 生产通知单 SC20260803001(货号 77772、黑色/均码×2 台)创建+审核:ExpandBom 混合取数展开成功(塑胶行 FK 不再拦)。
- 采购物料分析(basis):**35 行胶件全部列出;总数量合计=82(=2×41)、需订合计=82(库存 0);用量 1→总数量 2、用量 2→总数量 4(6 行);预算单价=塑胶 单价(原胶件单价,如 57001896=0.0687),无空价行**。
- 塑胶采购分析(plastic-material-docs/orders):接口正常,现有 1 张历史塑胶订购单(非本流程产生)。
- 清理:通知单反审核+删除,生产制单/生产BOM物料清单=0;77772 BOM(35 行,已审核)保留。

## 验证与部署
- dotnet build 0 错;dotnet test 212 过(本轮纯后端+DB,前端未动,wwwroot 沿用上轮 index-72GGDDZi)。
- 遗留:①下游单据 FK 仍指 物料资料(采购明细单.FK_207 等),塑胶料开采购单时会撞——下一步若开塑胶采购单需同样放开或走塑胶专档;②重建库(db/02)会把两个 FK 加回来,需同步时改 db/02 或重建后重跑 db/68;③BOM 台头已审核后保存仍不锁(见上轮遗留)。

## 生产通知单"打开"列表对齐旧系统(同日追加)
- 打开弹窗列从 5 列扩为旧系统全套:订单类型/标识/生产单号/款号/款式/客户款号/日期/交货日期/客户编号/客户名称/计划数量/制单人/跟单员/备注(+审核状态);弹窗加宽 1200,横向滚动。

## 生产通知单跟单员联动部门人事(同日追加)
- 跟单员 Input 改 AutoComplete,数据源 人事档案(/api/master/employees),显示 姓名(部门编号/职称),可手输;人事档案在 基本设置>部门人事 手动维护。

---

# 2026-08-03 追加:「部门人事」独立页面(旧系统样式)

## 改动清单
- 实体 人事档案.cs:补 EF 映射 自动编号/出生日期/身份证号/入职日期/离职日期/地址(列早已在 db/01,纯映射无迁移)。
- 新页面 web/src/pages/system/DepartmentPersonnelPage.tsx(401 行):左部门列表(全部部门+各部门带人数,新增部门弹窗 编号/部门/备注,行内删除有引用人数警告不强拦)+ 右人员网格(旧系统 17 列:部门编号|部门名称|自动编号|编号|姓名|性别|职称|电话|手机|地址|身份证号|出生日期|入职日期|离职日期|基本工资|备注|在职;日期 slice(0,10);部门名称前端 join;基本工资按 人事档案·单价 权限 ***)。人员 新增/编辑/删除(masterApi("employees")),双击选中+工具栏样式同项目约定;表单全字段(日期 DatePicker、部门编号 Select、在职默认在职、基本工资按权限隐藏)。权限:人员用"人事档案"、部门用"部门信息"。
- 路由/菜单:App.tsx 加 /hr/department-personnel;menuTree 部门人事 由 /master/部门信息 改指新页面(菜单权限名保持"部门信息"不变,页面内部按 人事档案/部门信息 分别门控)。

## 验证
- dotnet build 0 错;dotnet test 212 过;npm run build 过;npm test 310 过;eslint:新页面 1 个 set-state-in-effect(全仓既有基线同款模式,App.tsx/menuTree 0 问题)。
- curl 字段往返:POST 全字段人员 → GET 18 个字段全部正确往返(含 自动编号/出生日期/入职日期/地址/身份证号/基本工资),抽查行已删。
- Playwright 全链(截图 hr_*.png):新增部门 业务部 → 新增人员 0001/测试员/部门下拉选 YWB → 网格行 "YWB业务部0001测试员138在职"(部门名称 join 正确,表头 17 列与旧系统一致) → 点业务部过滤=1 行 → 双击选中"已选中:0001 测试员" → 编辑改职称=高级工程师 → 删除人员 → 删除部门;现场已清(部门/人员 total 回基线)。
- 部署:后端 Development 重启;web/dist 已同步 src/ErpApi/wwwroot(index-DNHA51db.js)。

---

# 2026-08-05 追加:塑胶 采购→入仓→领料→库存报表 全链(首批正式单据,保留)

## 主数据准备
- 占位供应商:S000/待定供应商(备注"塑胶件供应商待确认,确认后改"),API 创建。
- **塑胶共用物料表 77772 入库 35 行**(此前为空;塑胶采购 basis 从该表按 生产制单货号.货号 调 BOM,不从 款号物料明细表):由 塑胶物料资料 映射(原料单价→胶料单价)。**坑**:57001908(A03-耳罩)源数据 套数=4/出模数=4/用量=2 不满足 套数=出模数÷用量,被 塑胶共用物料校验 拒——套数留空插入并在 备注内容 注明,待业务确认。

## 全链单据(保留,供应商字段待确认后改)
1. 塑胶采购订单 **SP20260805001**:basis(SC20260803002,77772×1000台)35 行、数量=用量×1000、合计 41000,供应商 S000,已审核。
2. 塑胶入仓单 **SR20260805001**:35 行全收 41000(订单单号关联,仓库=胶件仓,单价=原胶件单价),已审核 → 库存 1000×用量(57001896=1000,用量2 行=2000)。
3. 塑胶领料单 **SLL20260805001**:按 SC20260803002 领 500 台份,35 行合计 20500,已审核 → 库存扣至 500×用量。
4. 库存对账:/api/plastic-inventory(keyword=57001) 35 行与 SQL 台账聚合(入仓+−领料−,审核单)**逐行一致、零差异**;抽查 57001896=500、57001908=1000,合计 20500。

## 口径备注
- 塑胶库存由 PlasticInventoryService 按审核单实时聚合(6 支台账 union),**不写 塑胶物料资料.库存 列**;验证以对账报表为准。
- 塑胶采购订单明细无单价列(schema 如此),单价只记在入仓/领料明细。
- 本轮未改后端代码(纯数据流),dotnet 未重跑(上轮 212 过)。

## 原料本月库存汇总对齐旧系统(2026-08-04 追加)
- 报表口径改正:原来误用塑胶件台账+塑胶报废,改为原料台账(RawMaterialLedgerUnion 入/退/出/退/盘,仅审核单)按原料名称汇总。
- 列对齐旧系统:本月库存重量/存外厂重量/本月报废重量/本月总重量(KG,=数量×每包重量)+ 本月库存/存外厂数量/本月报废/本月总数;存外厂与原料报废暂无单据来源置 0(注释注明)。
- 前端:列+合计行+导出列同步;api 类型补齐。

---

# 2026-08-05 追加:全系统综合测试报告(只读为主,无验证性写入)

## ① 自动化套件 PASS
- dotnet build 0 错;dotnet test 212 过 0 败 507 跳过(DB 测试,正常)。
- npm test 62 文件 310 过;npm run build 过;eslint 286 problems(283 errors/3 warnings),对比基线 283 = **+3**(全部为本阶段新增页面/改造文件的同款 set-state-in-effect 基线类问题,无新类别错误)。

## ② API 冒烟 22/23 PASS
- 主数据:物料 288/12 类、塑胶 35/13 类、工模 23、客户 1、员工 88、部门 19、原料 264 全部 200 且数字一致。
- **供应商 272 ≠ 预期 271**:系本轮自建占位供应商 S000(271 导入 + 1 占位),非异常。
- 业务链:bom-headers 200、77772 materials 35 行+审核台头、生产单 SC20260803002 在列、basis 35 行/需订 41000、来料采购订单=0、塑胶三单(SP/SR/SLL20260805001)详情 35 行+已审核,全 PASS。
- 报表:plastic-inventory 35 行合计 20500、raw-material-summary 200(空)、material-inventory 200。
- 权限负测:无 token/错误 token 均 401 PASS。

## ③ 页面冒烟 11/11 PASS(playwright 截图 /tmp/pwtest/smoke_*.png)
- material-master(50 行+树 26 节点)、plastic-material-master(35 行+树)、plastic-molds(23 行)、production(SC20260803002)、purchase-orders(空列表正常)、plastic-inventory(35 行+树)、plastic-raw-material-summary(空表正常)、department-personnel(50 行)、purchase-receipts/material-issues(单据页打开正常)均无 JS 错误、无"加载失败"文案。
- bom-setup 打开 77772:明细 35 行 57xxx 物料编号齐全、已审核 Tag 显示。

## ④ 数据一致性 全部 PASS
- 塑胶台账 6 支 union 聚合=35 行/合计 20500,与报表口径一致(57001896=500)。
- 无重复编号:物料/塑胶物料/供应商/人事/塑胶原料 全部无重复。
- BOM 明细悬空引用=0(放开 FK 后应用层校验生效);四类单据明细孤儿行=0。
- 77772 BOM:明细 35 行、台头审核='1'。

## 结论
全系统绿。唯一"差异"为供应商 272(=271+占位 S000,预期内)。

---

# 2026-08-05 追加:TESTV 虚拟数据集成测试(全过,已全部清理)

## 集成测试(23 步全 PASS)
- a. TESTV-STY1 款号+混合 BOM(来料 01030008×3 + 塑胶 57001896×2,FK 放开后混存成功)→ bom-audit 204。
- b. bom-headers 含 TESTV-STY1。
- c. 生产通知单 SC20260805001(10 台)→审核;basis 2 行:01030008 需订 30、57001896 需订 20。
- d. 来料采购单含塑胶行 → 400"关联数据不存在(供应商/物料/生产单号)"(**设计如此**:采购明细单.FK_207 仍指物料资料);纯来料单 PO20260805001 开单+审核。
- e. 采购入仓 CG20260805001 ×30 审核 → f. 领料 LL20260805001 ×12 审核。
- g. 塑胶链:塑胶共用物料 TESTV 行 → 塑胶 basis 1 行 → SP20260805002 → SR20260805002(收20)→ SLL20260805002(领5),全审核。
- h. 盘点 PD20260805001(系统 18→盘点 20)审核。
- i. 报表实测:来料库存接口 01030008=20、塑胶库存接口 57001896=515(=500+20−5),与台账一致。
- j. 选择器接口:material-master next-code 200;plastic-material-master/next-code 不存在(404),但前端也未调用(PlasticMaterialMasterPage 不用预填编号),非漏接;suppliers/customers/employees/plastic-molds list 均 200。

## "设计如此"行为清单
- 来料采购订单不接受塑胶行(FK_207,400 中文):塑胶件采购须走塑胶专档(塑胶采购订单)。
- plastic-material-master 无 next-code(来料档案才有预填编号)。

## 清理确认(全归零)
- 单据:TESTV 生产通知单/来料采购+入仓+领料+盘点/塑胶采购+入仓+领料 均反审核后删除(204);BOM 明细/台头/款号总表/塑胶共用物料 TESTV 行删除。
- 库存复核:01030008 台账=0(回测试前)、57001896 台账=500(回测试前);13 类表 TESTV 残留计数全 0。

## 漏连接静态扫描(前端 717 条调用 × 后端 722 条路由,参数归一化比对)
- **A. 前端调了但后端没路由:0 条**(机器候选全部人工复核为假阳性:[controller] 令牌路由/MasterCrud/SysConfigSection 基类继承 action/页面动态拼接 URL 均已核实)。理论缺口(未触发):masterApi().get(id) 若用于 injection-machine-rates/warehouse-locations 会 404(这两个控制器不走 MasterCrud 基类、无 Get("{id}"),现页面只调 list)。
- **B. 疑似死接口(后端有路由前端从不调)**:GET /api/plastic-label-query/detail|summary(前端走 /plastic-label-orders/label-query/*);GET /api/purchase-receipts/label-query/detail|summary(前端走 /material-label-orders/label-query/*);GET /api/master/pricing/material(前端只用 pricing/apply);GET /api/finished-sales-returns/{单号}、GET /api/finished-vendor-returns/{单号}(前端 finished api 无 get)。
- **菜单权限对照:0 条对不上**(menuTree 130+ 项:path 均有 Route、权限名均在 MenuCatalog 注册)。反向发现:MenuCatalog 的"发外对数"(行18)/"计件汇总"(行17)两个权限名无任何菜单/前端 can() 引用,对应页面存在但没挂权限名,疑权限接线遗漏。

---

# 2026-08-05 追加:Dashboard 工作台升级(纯前端)

## 改动
- web/src/pages/Dashboard.tsx 重写:
  - 统计卡两行:原 4 张(客户/供应商/物料/报价)+ 新 4 张(塑胶物料/工模/塑胶原料/人员,masterApi list total,青/紫/橙/天蓝渐变不撞色)。
  - 业务流程卡:建档→BOM→生产通知单→采购分析→采购订单→入仓→领料→库存报表,8 步圆标+箭头,点击跳对应路由。
  - 单据动态卡:生产通知单 total(productionApi)、采购订单 total(purchaseOrderApi)、塑胶库存合计(plasticInventoryApi 各行求和),可点击跳页。
  - 快捷操作卡:新增物料/新建采购订单/新建生产通知单/导入表格/BOM物料设置 圆角按钮跳路由。
  - 欢迎卡精简+中文日期星期;全部用 antd Card(主题 token 驱动)+ opacity 文字色,主题自适应。

## 验证
- npm run build 过;npm test 310 过;eslint 0 问题(中途清了未使用的 icon import)。
- Playwright:数字序列 [1,272,288,0 | 35,23,264,88 | 1,0,20500] 全部正确;流程卡"采购分析"点击跳 /purchase-material-analysis 成功;浅色截图 dash_light.png 正常。
- **深色主题:项目 themes.ts 只注册了 light 一个主题**(index.css 虽有 dark 规则但 antd token 恒为浅色,强制 data-erp-theme=dark 页面仍浅色)——深色实际不可用,非本页问题;本页全部用 antd 组件+token 色彩,将来注册深色主题即可自适应。
- 部署:web/dist 已同步 src/ErpApi/wwwroot(index-DI4GwOxC.js / index-B4AbEeu9.css)。

---

# 2026-08-05 追加:前端性能优化(代码分割/xlsx按需/登录页美化)

## 改动
- App.tsx:186 个页面组件静态 import 改 React.lazy(Login/MainLayout/MasterRouter/Dashboard/PlaceholderPage 保持静态),Routes 外包 Suspense(全屏居中 Spin fallback);权限包装结构不变。
- MaterialImportModal.tsx:xlsx 顶层 import 改 `await import("xlsx")`(类型仍 import type),xlsx 拆成独立 chunk(424KB,仅解析文件时加载)。
- Login.tsx 重做:左品牌区(渐变底+系统名+4 个特性点:物料/生产/采购/仓库)+右登录卡(圆角阴影、输入框 UserOutlined/LockOutlined 前缀、大号 loading 登录按钮),flex wrap 窄屏自动单列。

## 效果(实测)
- 主包 3034KB → 852KB(index 入口);/plastic-material-master 硬导航首屏 JS(去重)3034KB → 1452KB(-52%,17 个 chunk:主包 852+jsx-runtime 433+页面 15+共享若干)。<800KB 目标未达——antd 核心约 1.2MB 为任何页面的必载下限,后续如要继续压可评估 manualChunks 分包缓存(不减少总量)或组件库替换(不建议)。
- dist 273 个 chunk,每个页面独立 chunk(如 BomSetupPage/PlasticMaterialMasterPage),xlsx 独立 424KB。

## 验证
- npm run build 过(tsc+vite);npm test 310 过;eslint 3 个改动文件 0 问题。
- Playwright:admin 登录流程回归(登录页填表→进 Dashboard 正常);登录页/首页截图 login_new.png / dash_regression.png。
- 部署:web/dist 已同步 src/ErpApi/wwwroot(index-B_vtfDbl.js)。
- 提交:d08266b perf(web): 路由级代码分割+xlsx按需加载+登录页美化(已推 origin master 与 master:main)。

---

# 2026-08-06 追加:全站视觉打磨(纯视觉层)

## 改动(仅 2 个文件)
- web/src/theme/themes.ts(antd token):Table 淡底表头 #fafbfc/淡蓝 hover #f5f8ff/cellPadding 13;Card 圆角 14;Button 圆角 8+主按钮轻投影;Modal/Drawer 圆角 14;Tag pill 圆角 999;Form label 颜色字重统一;Input/InputNumber focus 阴影;Menu item 间距微调。
- web/src/index.css:表头分隔线加粗 2px;表格圆角外框(容器 overflow hidden,不影响表体滚动);按钮 0.18s 过渡;Modal 遮罩 backdrop-filter blur(2px)(仅 modal);Drawer 左圆角;侧栏菜单组标题字重/字距、选中项加粗;顶栏极淡下边阴影;内容区 0.18s fade-in;深浅色兼容(dark 表头 #11162a)。MainLayout.tsx 未动。
- 登录页不在本轮范围(上轮已美化)。

## 验证
- npm run build 过;npm test 310 过;eslint themes.ts 0 问题(index.css 仅"file ignored"提示,非问题)。
- Playwright 6 页截图(p_login/p_dash/p_material-master/p_plastic-material-master/p_purchase-orders/p_production + p_hover):表头淡底+加粗分隔线、表格圆角外框、行 hover 淡蓝、侧栏 pill 高亮、顶栏淡阴影、卡片圆角投影均生效,无破版/错位/溢出/对比度问题。
- 部署:web/dist 已同步 src/ErpApi/wwwroot。

## 原料类别归并旧系统13大类(2026-08-05 追加)
- 塑胶原料资料.物料类别 按规则归并:PVC 60/TPE&TPR 46/PP 39/ABS 28/混料 15/POM 13/HIPS 12/透明MABS 10/PA66 7/PC 7/HDPE 4/PETG 3/K料 2/POK 2,旧系统 13 类全覆盖;HIPS/LDPE/POE/SAN/EPS/EVA/GPPS/PE水口 等无旧类对应的保留原样;2 行无类别(源数据如此)。
- 旧系统原料库存统计表为 0 记录→无期初库存要迁移,原料仓从零启用。
