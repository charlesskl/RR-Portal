# 2026-07-31 塑胶物料资料关联工模表

## 功能点
- 塑胶物料资料新增:先弹工模选择器(PlasticMoldPicker 复用)→ 工模带出 颜色/色粉号/用料名称/整啤模腔数/水口比例/模具日产量/整啤毛重/整啤净重/啤机机型/啤机价钱/胶件啤工价/原料单价(←工模.胶料单价)/原胶料单价 → 打开表单补手动字段。编辑可"重选工模",只覆盖工模字段、手动字段保留。表单 Modal 加宽 780,Divider 分组 基本资料/工模资料/重量与用量/价格(antd 6 用 titlePlacement,不是 orientation)。默认值 单位 PCS、货币 toDocCurrency(featureSettings.默认货币)、类别=当前树选中。
- 列表加"工模编号"列(PlasticMaterialRow DTO + ListAsync SELECT 加工模编号/客户)。
- 保存校验(PlasticMaterialController.ValidateForSaveAsync):工模编号 Trim+大写(与工模表录入口径一致),非空必须存在于工模表(复用 塑胶共用物料校验.校验工模编号存在);套数/出模数/用量三值齐全时校验 套数=出模数÷用量(复用 校验套数)。
- 导入:PLASTIC_IMPORT_SPEC 表头映射改为真实列(塑胶货号→款号、原胶件单价→单价、加工总单价(HKD)→加工总单价 等 27 列),后端 PlasticMaterialImportRow/ValidPlasticMaterialImportRow/INSERT 同步扩展全部新字段;备注打包规则保留但理论上只剩序号列(不打包),备注列接收表格真实"备注"。

## DB
- db/63_plastic_material_mold_link.sql:塑胶物料资料 +25 列(工模编号/客户/色粉号/加工内容/二次加工/原料名称/用料名称/啤机机型 nvarchar;整啤毛重/整啤净重/原胶件单净重/整啤模腔数/套数/出模数/用量/水口比例/模具日产量/啤机价钱/胶件啤工价/原料单价/胶件料价/原胶料单价/二次加工价/加工总单价/其他成本 decimal(18,4)),全 NULL 可空、sys.columns 幂等。实体 塑胶物料资料.cs 同步加属性(价格列标 [PriceField] 参与脱敏/回填保护)。

## 数据迁移(77772塑胶物料资料.xlsx,35 行)
- 工模表补录:Excel 唯一工模 23 个,全部插入(此前表内 2 行,现 25 行);胶料单价=Excel 原料单价;整啤毛重/水口比例/原胶料单价 Excel 无 → NULL。
- 塑胶物料资料 35 行按物料编号 UPDATE 回填全部新字段,备注置 NULL(原打包串清掉);抽查 2 行字段正确,关联工模行备注非 NULL 数=0。
- 迁移脚本在 /tmp/migrate_77772.py(一次性,不进仓库)。

## 验证
- dotnet build 0 错;dotnet test 212 过 0 败(DB 测试跳过正常);前端 vitest 310 过、npm run build 过;eslint 改动文件仅剩 2 个既有基线错误(react-hooks/set-state-in-effect,改动前 HEAD 同样报)。
- curl 实测:不存在工模编号新增 400"工模编号不存在于工模表";套数≠出模数÷用量 400;真实工模新增 201;编辑换工模 204(工模编号 Trim+大写落库);导入接口新增 1 行新字段全部落列、备注 NULL。测试行已删。
- 注意:通用 CRUD 的 PUT 依赖请求体带 id(JSON camelCase "id" 不区分大小写绑定到 ID),前端 form.setFieldsValue(详情) 已含 id 故 UI 无影响;纯 curl 验证时须自带 id,否则撞"物料编号已存在"。

## 运维备注
- DbDeploy 手动跑:`~/.dotnet/dotnet run --project tools/DbDeploy -- "$ERP_DB" db/63_plastic_material_mold_link.sql`(非启动自动执行)。
- web/dist 已同步 src/ErpApi/wwwroot(删旧 assets 目录整体替换 + index.html/favicon.svg/icons.svg;旧 hash 文件已清),5000 端口 SPA 验证 200。

## 清除演示数据(同日追加)
- 按 db/60 种子脚本的反向顺序(子表→父表)删除全部 DEMO 演示数据,共 70 行:演示物料6/塑胶1/工模2(DEMO-MOLD)/啤机2/仓库位置2/客户1/供应商2/加工厂1/款号3/部门1,及演示单据(采购/入仓/领料/盘点/生产制单/MO单/BOM/标签单/装配采购单等,含 7-29 演示期创建的真实号单据 PO20260729001·PO20260729002·CG20260729001·LL20260729001——其供应商/生产单均为 DEMO)。
- 例外保留:工模表 DEMO-06M-01/07M-01/08M-01/09M-01 共 4 行——名字带 DEMO 但来自 77772 真实 Excel,被物料 57001968/69/70/84 引用。
- 单事务执行(首轮因 CG/PO/LL 单据外键引用 DEMO 物料回滚,补删后提交)。删除后:物料资料 288、塑胶物料资料 35、工模表 23、物料类别 12,接口验证分类树与列表正常。

---

# 2026-07-31 追加:塑胶物料资料左树分类管理(两级,镜像来料)

## 功能点
- db/64_plastic_material_category.sql:新建 [塑胶物料类别] 主数据表(镜像 db/01 [物料类别]:ID/编号20/名称40/类别30=父级/备注max),幂等,DbDeploy 已应用(表数 214)。
- 后端:新实体 塑胶物料类别.cs + ErpDbContext 注册;Controllers.cs 加 api/master/plastic-material-categories 通用 CRUD(权限菜单复用"塑胶物料资料",避免新增菜单权限种子)。
- PlasticMaterialMasterService.CategoriesAsync 改为 主数据+物料数量 用 MaterialCategoryTree.Build 合并(来料同款);ListAsync 加 含子级 参数,用 MaterialCategoryTree.SubtreeKeys 对 [塑胶物料类别] 展开后代;PlasticMaterialCategoryNode DTO 加 编号/父级;List 过滤由 `= @cat` 改 `IN @cats`(来料同写法)。
- 前端 PlasticMaterialMasterPage:照 MaterialMasterPage 加 类别按钮区(canSave 门控,菜单同权故不另设 CAT_MENU)/两级树(全部塑胶物料 根)/选中过滤(父类 含子级=true)/新增类别弹窗(编号=名称=输入名,父级=当前选中编号或名称)。

## 验证
- dotnet build 0 错;dotnet test 212 过 0 败;前端 vitest 310 过、build 过;eslint 仍只有 2 个既有基线错误。
- curl 实测:建父类"胶件"+子类"唱盘类" 201;categories 返回层级(唱盘类.父级=胶件);物料 57001896 改类后 父类+含子级 total=1 命中、父类不含子级 total=0、子类精确 total=1;测完物料类别改回 NULL(归类物料数=0)、两个测试类别已 DELETE,categories 恢复空。
- 坑:curl 直接拼中文查询参数名(如 ?类别=x)会被 Kestrel 以 400/空响应拒绝(请求行非 ASCII),需对参数名也 percent-encode;前端 axios 默认编码不受影响。
- web/dist 已同步 src/ErpApi/wwwroot(index-DA6CpjIq.js),SPA 验证 200。

---

# 2026-07-31 追加:塑胶物料资料表格改为旧系统固定 27 列表头

## 功能点
- 表格列固定为旧系统顺序:物料编号|客户|塑胶货号|工模编号|物料名称|颜色|色粉号|原料名称|用料名称|加工内容|加工总单价(HKD)|二次加工|二次加工价|整啤净重|原胶件单净重|整啤模腔数|套数|出模数|用量|啤机机型|模具日产量|啤机价钱|胶件啤工价|原料单价|胶件料价|原胶件单价|备注 + 操作列。塑胶货号绑 款号,原胶件单价绑 单价;原 类别/规格/单位/仓位号/销售价/库存/最低库存/供应商 列从网格去掉(数据保留,编辑表单不动)。
- PlasticMaterialRow DTO 补齐全部展示字段;ListAsync SELECT 同步扩列。
- 价格脱敏范围扩大:无"单价"权限时 单价/销售价/加工总单价/二次加工价/啤机价钱/胶件啤工价/原料单价/胶件料价/其他成本 全部置 null(前端 money() 显示 ***);数字列右对齐空值显空。

## 验证
- dotnet build 0 错;dotnet test 212 过 0 败;前端 vitest 310 过、build 过;eslint 仍只有 2 个既有基线错误。
- curl 抽查 57001896:27 字段全部返回,客户=ZURU/款号=77772/色粉号=7726/胶件啤工价=0.0426/原胶件单价(单价)=0.0687,与 Excel 源数据一致。
- 后端 Development 重启;web/dist 已同步 src/ErpApi/wwwroot(index-BK5_VUPh.js),SPA 200。

## 表头吸顶(同日追加)
- PlasticMaterialMasterPage / MaterialMasterPage 表格表头固定:先用 antd `sticky={{ offsetHeader: 60 }}` 试,吸顶克隆层透明与内容重叠(antd6 CSS-in-JS 下的坑)弃用;改用 `scroll={{ x: "max-content", y: "calc(100vh - 300px)" }}`——表头固定、表体内部滚动;操作列 fixed:right 与横向滚动叠加错位,一并去掉 fixed。已构建同步 wwwroot。
- 附带修复(本就有):硬刷新/直开 URL 时列表为空——loadRows 的 useEffect 依赖不含 canOpen,挂载时权限未就绪提前 return 后不重试;两个主数据页 effect 依赖加 canOpen。
- 验证方式:playwright-core(装 /tmp/pwtest,浏览器用 ~/erp-tools/pw-browsers 的 chrome-headless-shell,不进项目依赖)localStorage 注入 token 截图,确认表头固定不重叠、右滚操作列对齐、硬刷新数据正常加载。

## 行操作改双击选中+工具栏(同日追加)
- 来料/塑胶两个物料档案页:去掉行内"操作"列;双击行选中(浅蓝高亮+工具栏显示"已选中:编号 名称"),工具栏新增 编辑/删除 按钮(未选中禁用,删除有确认);刷新列表/保存/删除后清空选中。playwright 截图验证:双击选中→编辑弹窗字段回填正确。

---

# 2026-07-31 追加:12 个资料/设置页统一"双击选中行 + 工具栏编辑/删除"交互

## 改动要点(每页)
统一模式:删行内"操作"列;加 selRow state;Table onRow 双击选中(选中行 #e6f4ff + cursor pointer);工具栏加 编辑/删除(danger,Popconfirm 带选中行主键)按钮(未选中 disabled)+ 提示文字(未选中灰字"双击行选中后可编辑/删除",选中蓝字"已选中:xxx");load/保存/删除成功后 setSelRow(null);权限门控沿用各页原 canSave/canDelete 或 can(perms,MENU,...)。
1. master/MasterDataPage.tsx(通用,影响全部基础资料菜单):额外把"明细"动作搬到工具栏(cfg.detailLink 存在时才有该按钮);rowLabel 回退链 编号/名称/客户编号/客户名称/物料编号/供应商编号/加工厂编号/加工厂名称/键/id。
2. master/FactoryMasterPage.tsx:标签=加工厂编号/名称。
3. auxiliary/AuxiliaryMaterialMasterPage.tsx:标签=辅料编号(类型里无物料编号字段);原"双击直接开编辑"改为双击选中。
4. plastics/PlasticMoldPage.tsx:另修复一个既有 bug——crud=masterApi("plastic-molds") 的 list 不做 id→ID 归一化,导致 rowKey/openEdit/del 的 r.ID 全是 undefined(编辑弹窗永远显示"新增工模"、删除必然失败);loadRows 加 id→ID 归一化(与其他自定义 api 同款注释)。
5. plastics/PlasticCommonMaterialPage.tsx:任务里说 grep 没搜到操作列,实际有(约 157 行 EditOutlined/DeleteOutlined 图标列),按统一模式改造,未跳过。
6. system/WarehouseLocationPage.tsx / 7. system/InjectionMachineRatePage.tsx:行内编辑/删除逻辑提取为 openEdit/onDelete;标签=编号/啤机机型。
8. system/SysConfigPage.tsx / 9. attendance/ShiftPage.tsx:主键非 id(键/识别),选中比较与编辑删除均按主键字段。
10. attendance/RosterPage.tsx:只有删除无编辑,工具栏只加删除按钮,提示文案"双击行选中后可删除";选中按 工号+日期 双字段比较。
11. production/PurchaseMaterialSettingsPage.tsx / 12. plastics/PlasticMaterialSettingsPage.tsx:虚拟行 ID 可空,删除保留 !ID 禁用逻辑,选中按 物料编号 比较。

无"操作列里搬不动的动作"(除 MasterDataPage 明细已搬外,各页操作列均只有编辑/删除)。

## 验证
- npm run build 过;npm test 310 过;eslint:12 个改动文件 error/warning 计数 18=18(与 git stash 基线完全一致,无新增,均为既有 set-state-in-effect/exhaustive-deps 基线)。
- Playwright(chrome-headless-shell,token localStorage 注入)抽查 3 页全过:
  - 客户资料(/master/客户资料,MasterDataPage):双击行→"已选中:PWTEST01"+行背景 rgb(230,244,255)+编辑点亮→点编辑弹窗"编辑客户资料"。
  - 工模表(/plastic-molds):"已选中:MNVN-05M-01"→弹窗"编辑工模"(ID 归一化修复后标题正确)。
  - 辅料资料(/auxiliary-material-master):点树节点辅料(8)→双击行"已选中:12000063"→弹窗"编辑辅料资料"。
- 验证用测试客户 PWTEST01 已删除;坑:antd 6 弹窗容器类名是 .ant-modal-container(不是 .ant-modal-content);表格首行可能是 aria-hidden 的 ant-table-measure-row,选择器要用 tr.ant-table-row;antd 按钮两字中文自动插空格("编 辑")。
- web/dist 已同步 src/ErpApi/wwwroot(index-BcFTNIE0.js)。本轮纯前端改动,后端未重启。

---

# 2026-07-31 追加:全部页面表格固定表头(scroll.y 扫荡)

标杆:`scroll={{ x: "max-content", y: "calc(100vh - 300px)" }}`(PlasticMaterialMasterPage/MaterialMasterPage 现状)。规则:页面主表格缺 y 补 y(默认 calc(100vh-300px),Tabs/双工具栏页 320~340);`x: true` 顺手规范为 `"max-content"`;弹窗/抽屉/Picker 内表无 y 补固定 380;LineTable/单据编辑明细行 grid 不动;极小静态表不动。

## 改动分类(共约 100 处 scroll 改动,~85 文件;仅改 scroll 属性)
- **上轮 12 页(自改)**:MasterDataPage/WarehouseLocationPage/InjectionMachineRatePage 补 scroll;FactoryMasterPage/SysConfigPage/ShiftPage/RosterPage(x:true→max-content+y);AuxiliaryMaterialMasterPage(x:1350+y);PlasticMoldPage/PlasticCommonMaterialPage(+y);Purchase/PlasticMaterialSettingsPage 本就有 y。
- **plastics(两批,约 50 文件)**:20+ 报表/分析/库存/进度页主表补 y;4 个 Tabs 查询页(明细+汇总两表)补 y;11 个带 Tabs 原料查询页 y 取 340;12 个 DetailDrawer 明细表补 380;3 个单据页 Modal 选择表补 380;PlasticRawMaterialMasterPage x:true 规范化。
- **warehouse+semi**:FinishedIssue/SalesReturn/VendorReturn/Transfer(x:true 规范+y)、FinishedInventory/FinishedStocktake/MonthEnd(320)/SemiFinishedShortageAnalysis/SemiFinishedCommonMaterials(320) 补 y;SemiReceiptDetailDrawer 补 380。
- **materials+production**:MaterialDocPage/MaterialInventoryPage/MaterialStocktakePage + 15 个生产查询/分析页(保留数值 x 补 y);8 个 Tabs 查询页两表补 y(320);MaterialUsageQueryPage 左右主从两表(340/300);4 个 DetailDrawer/PurchaseOrderDrawer 补 380。
- **sales/payables/payroll/orders/admin/workshop**:15 个列表页 x:true 规范+y;ReceivablesPage/PayablesPage Tabs 报表页 9 个 tab 表(340);3 个待核销 Picker + 8 个 DetailDrawer + PayrollRunPage 抽屉 + AccountPage 权限表 补 380。
- **assembly/styles/master/attendance**:FactoryCategoryDetailPage/ProcessShortagePage(x:1500 保留)/PriceAdjustPage 左表/DailyPage(340) 补 y;AssemblyPurchaseQueryDetailDrawer 补 380。
- **auxiliary**:AuxiliaryPurchaseAnalysisPage 补 y;AuxiliaryStocktakeQueryDetailDrawer 补 380(其余 18 文件本就有 y)。

## 跳过及原因
- 已有 y:auxiliary 18 文件、assembly 8 文件(y 560~620)、全部 Picker(y 360~440)、auxiliary/warehouse 多数单据页(y 410~680)。
- LineTable/单据编辑明细行 grid(不动):全部 *LineTable.tsx、CreateDrawer 明细行、盘点录入表、PriceAdjustPage 右侧调价明细、StyleDetailPage Tab 内小编辑表。
- 极小静态/表单页内嵌小表(不动):各单据 FormPage 底部 pageSize 10 历史单据列表(加 calc y 会强行撑高,难看)——两个 agent 都标注了此判断点,如需固定建议用固定值 y:300 而非 calc。

## 验证
- npm run build 过;npm test 62 文件 310 过;eslint:181 个改动文件问题计数 215 ≤ 基线 216(git stash 对比,无新增)。
- Playwright 表头固定抽查(1500×520 矮视口强制可滚):客户资料(基础资料页,12 条测试数据)表体滚到底 thead top 164→164 不动;采购入仓单查询 thead 318→318;系统参数 thead 164→164;截图确认表头钉在工具栏下、无重叠、无页面级纵向滚动条;与标杆页(plastic-material-master)同视口表现完全一致。测试客户 PWS01~12 已删(customers total=0)。
- 运维:web/dist 已同步 src/ErpApi/wwwroot(index-DEAtfzCw.js)。纯前端改动,后端未重启。

---

# 2026-07-31 追加:工模表旧系统表头(11 列) + 工模编号改名同步

## 改动清单
- db/65_plastic_mold_add_cols.sql:工模表 +[客户] nvarchar(20)、+[整啤套数] decimal(18,4)(幂等,DbDeploy 已应用);实体 工模表.cs 同步加属性。
- PlasticMoldPage.tsx:网格改旧系统固定 11 列(客户|工模编号|工模名称|整啤模腔数|整啤套数|啤机机型|模具日产量|用料名称|整啤净重|水口比例|备注;数字列右对齐空值显空);色粉号/整啤毛重/啤机价钱/胶件啤工价/胶料单价/原胶料单价 移出网格保留在表单;表单加 客户/整啤套数;money 渲染随网格价格列移除(表单价格字段仍受 priceHidden 门控)。
- 改名同步:后端 PlasticMoldController 加 [HttpPost("sync-code")](权限 工模表·保存;{旧编号,新编号} Trim+大写;单事务 UPDATE 塑胶物料资料/塑胶共用物料表 的工模编号;写审计;返回 {物料资料更新,共用物料更新})。前端编辑保存时记 origCode,编号变了 → Modal.confirm("检测到工模编号有修改,工模编号是否更新到【塑胶物料资料】【塑胶共用物料表】吗?",是/否)→ 是则调 sync-code 提示"已同步更新:物料资料 X 条、共用物料 Y 条"。
- 注意:基类 MasterCrudController 的 AllowAsync/AuditAsync 是 private,sync-code 动作直接用子类捕获的 IPermissionService/IAuditLogger(与 PlasticMaterialMasterController 同款)。改名撞 UX_工模表_工模编号 唯一索引时基类 Update 不抓 DbUpdateException,会 500(EF 包装 SqlException 2601/2627)——按约定不改基类,仅在此说明;MaterialMasterController.Create 的抓法可参照,但那是独立控制器不是基类。
- 数据回填(/tmp 一次性脚本):工模表.客户 从引用它的塑胶物料资料回带,23 行已有客户(ZURU);整啤套数留空。

## 验证
- dotnet build 0 错(中途缺 using System.Security.Claims 已补);dotnet test 212 过 0 败;npm test 310 过;npm run build 过;eslint 改动文件仅 1 个既有基线错误。
- curl:无引用工模改名→sync→{0,0};MNVN-05M-01→MNVN-05M-01-T sync→{物料资料 1,共用 0},57001896 跟着变;回滚 sync→{1,0},57001896 恢复 MNVN-05M-01;测试工模已删。
- Playwright:表头 11 列与旧系统完全一致;编辑改 MNVN-05M-01→-T 保存→confirm 文案逐字一致→点"是"→提示"已同步更新:物料资料 1 条、共用物料 0 条"(截图 mold_rename_synced.png);再走一遍改回,DB 现场已恢复。
- 部署:后端 Development 重启;web/dist 已同步 src/ErpApi/wwwroot(index-DE3txQjd.js)。

## 通用 CRUD 唯一冲突友好提示(同日追加)
- MasterCrudController.Update 捕获 DbUpdateException(内层 SqlException 2601/2627)→ 409 {消息:保存失败:编号已存在(唯一性冲突)};一处改动覆盖全部主数据编辑路径(工模改名撞 UX_工模表_工模编号 等)。实测 409 文案正确。

---

# 2026-07-31 追加:工模技术字段同步到塑胶物料资料(sync-fields)

## 改动清单
- PlasticMoldController 加 [HttpPost("sync-fields")](权限 工模表·保存;{工模编号} Trim+大写):单条 UPDATE...JOIN 把两表同名字段(用料名称/整啤模腔数/水口比例/模具日产量/整啤毛重/整啤净重/啤机机型/啤机价钱/胶件啤工价/原胶料单价)+ 原料单价←胶料单价 同步;写审计;返回 {物料资料更新}。**不同步** 颜色/色粉号(说明书:一套模多色时由塑胶物料资料手动维护)/备注/客户/工模名称/整啤套数/手动字段。
- PlasticMoldPage.tsx:openEdit 记 origRow;保存成功后(改名 confirm 流程之后,用最终编号)比较 SYNC_FIELDS(含 胶料单价)差异,有差异 → Modal.confirm("检测到工模资料有修改,是否把相同字段同步更新到【塑胶物料资料】吗?")→ 是则 sync-fields 提示条数;改名 confirm 的 是/否 两个分支都会续接字段同步检查。

## ⚠️ 顺带发现的系统性问题(未修,建议单独处理)
- **EF Core 默认 decimal 精度 (18,2)**:ErpDbContext 无 OnModelCreating 精度配置,经 MasterCrudService(EF)实际**改值写入**的小数会被截断到 2 位(实测 胶件啤工价 PUT 0.9999 → 库存 1.0000)。未改值的属性因 change tracking 只写变更列而不受影响。建议:OnModelCreating 加全局约定 `foreach decimal 属性 SetPrecision(18)/SetScale(4)`(对本来就是 (18,2) 的列无害,SQL 会自行转换)。启动日志里 EF 已对 物料资料.单价 等发过同样警告。
- 本次 sync-code/sync-fields 均走 Dapper 原生 SQL,不受该问题影响;但 UI 编辑工模把小数价格改成 4 位值会丢精度,待上述修复。
- 工模表 ID=9(MNVN-05M-01)在本轮验证前已处于字段被清空状态(疑为此前某次稀疏 PUT 所致,通用 CRUD 全实体覆盖语义),已从 57001896/Excel 原值用 SQL 修复;往返无损性已验证(GET→原样PUT→DB 不变)。

## 验证
- dotnet build 0 错;dotnet test 212 过;npm test 310 过;npm run build 过;eslint 改动文件仅 1 个既有基线错误。
- curl(为绕开上述 EF 精度问题,用工模值 SQL 改动):工模 胶件啤工价→0.9999,sync-fields → {物料资料更新:1},57001896 胶件啤工价=0.9999(4 位无损)、原料单价=0.0163(=胶料单价)、颜色/色粉号/物料名称/款号 不变;工模改回 0.0426 再 sync → 57001896 恢复。
- Playwright:UI 编辑工模 模具日产量 3400→3500 保存 → confirm 文案逐字一致 → 点"是" → "已同步更新:物料资料 1 条";再走一遍改回,最终 工模/57001896 模具日产量均 3400,现场恢复(截图 syncfields_confirm.png / syncfields_done.png)。
- 部署:后端 Development 重启;web/dist 已同步 src/ErpApi/wwwroot(index-CUVMnKWO.js)。

## EF decimal 精度修复(同日追加)
- 问题:EF Core 默认 decimal 精度 (18,2),UI 编辑 4 位小数价格(如胶件啤工价 0.0427)经 MasterCrudService 写入被截成 2 位(0.04);Dapper 路径(导入/sync-code/sync-fields)不受影响。
- 修复:ErpDbContext 加 ConfigureConventions → Properties<decimal>/Properties<decimal?> 统一 HavePrecision(18,4)(注意:OnModelCreating 里 ModelBuilder.Properties<T>() 在本项目 EF 版本不可用在 OnModelCreating 内调用,须用 ConfigureConventions)。
- 坑:构建失败被 `tail -2` 遮掉导致旧 dll 重启验证假象;验证构建要看完整输出/dll 时间戳。实测 PUT 0.0427→库存 0.0427,恢复 0.0426。
