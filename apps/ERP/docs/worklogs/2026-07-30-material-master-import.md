# 2026-07-30 物料档案 Excel 导入(来料/塑胶)

目标:为"物料资料"(`/material-master`,表 `[物料资料]`)和"塑胶物料资料"(`/plastic-material-master`,表 `[塑胶物料资料]`)两个页面提供 xlsx/csv 导入能力,并用该功能把两份真实数据导入本地开发库。

## 功能设计

- 前端解析、后端兜底:`web/src/utils/materialImport.ts`(纯函数,可单测)在二维数组里定位含"物料编号"的表头行(跳过第 1 行合并标题),按表头列名映射(不按位置),解析数字列,并把未映射且非空的列以 "列名:值" 空格连接打包进备注(备注列内容最前,有追加项时用 ";" 连接;空表头列/序号列不参与打包)。后端只做必填/Trim/列宽/数字/去重的兜底校验,不再拆列。
- 列映射:
  - 来料 → `[物料资料]`:物料编号/货号/物料名称/规格/颜色/单位/单价/仓库位置/备注/最低库存/货币;"材料"列按通用打包规则进备注(即 "材料:X")。
  - 塑胶 → `[塑胶物料资料]`:物料编号、塑胶货号→款号、物料名称、颜色、原胶件单价→单价,单位默认 PCS、货币固定 HKD;其余列(客户/工模编号/色粉号/各重量/模腔数/各种价格等)全部打包进备注。
- 接口(均需"保存"权限,写一条"导入"审计):
  - `POST /api/material-master/import`、`POST /api/plastic-material-master/import`,请求 `{ rows: [{ 行号, ... }] }`,返回 `{ 新增, 跳过, 失败, 失败明细: [{ 行号, 物料编号, 原因 }] }`。
  - 行为:物料编号空白/列超长(按表 nvarchar 宽度)/数字非法 → 失败明细;编号已存在(库中或本批前面) → 跳过;其余单事务批量 INSERT。插入用 Dapper 原生 SQL(EF 实体未映射 `[货号]`/`[最低库存]`)。
  - 塑胶控制器按需补注入了 `MasterCrudService<塑胶物料资料>`/`IAuditLogger`/`ISqlConnectionFactory`(crud 暂未使用,编译有一个 CS9113 警告,预留给后续新增/编辑迁移)。
- 页面:两页工具栏"新增"旁加"导入表格"按钮(需保存权限),弹窗(共用组件 `web/src/components/MaterialImportModal.tsx`)走 antd Upload(beforeUpload=false,xlsx 用 SheetJS `XLSX.read` → `sheet_to_json({header:1,raw:true})`;csv 复用 bomImport 的解码/切分)→ 预览表格(错误行标红)→ 确认导入 → 显示 新增/跳过/失败 及失败明细 → 成功后刷新左树与列表。
- 依赖:`web` 新增 `xlsx@0.18.5`(SheetJS)。

## 一次性数据导入结果(本地开发库 erp)

通过新接口真实导入(临时用户 tmpimport,导入后已删除其用户与权限行):

- `77772来料资料.xlsx`(289 数据行,含 1 行"合 计"):解析 288 行、跳过 1 行(空编号合计行),导入 **新增 288 / 跳过 0 / 失败 0**。库表 `[物料资料]` 由 6 → 294 行。
- `77772塑胶物料资料.xlsx`(35 行):**新增 35 / 跳过 0 / 失败 0**。库表 `[塑胶物料资料]` 由 1 → 36 行。
- 抽查:`01030008` 备注="材料:铁"、单价 0.0045;`57001896` 款号=77772、单价 0.0687(HKD)、备注为 "客户:ZURU 工模编号:MNVN-05M-01 色粉号:7726 … 胶件料价:0.0261" 全字段打包;无"合计"行泄漏。

## 测试与验证

- `dotnet build src/ErpApi` 通过(0 错误,1 个上述 CS9113 警告);`dotnet test` 通过 212 / 跳过 507(DB 测试无 ERP_TEST_DB,正常)/ 失败 0,含新增纯单测 `tests/ErpApi.Tests/MaterialImportValidationTests.cs`(7 个:Trim/空串→null、必填、列宽、数字兜底、批内去重、塑胶映射)。
- `npm --prefix web run test` 309/309 通过(含新增 `materialImport.test.ts` 10 个:表头定位、列映射、材料合并备注、塑胶打包备注、空编号跳过、数字解析);`npm run build`(tsc+vite)通过;`npm run lint` 新增/修改文件 0 错误(项目基线本身有 284 个遗留 `react-hooks/set-state-in-effect` 等错误,两页面里 4 个为 HEAD 既有,未新增)。
- 后端已以新代码重启(PID 67609,监听 5000,swagger 200)。

## 注意事项

- 重启后端时工作目录必须是 `src/ErpApi/bin/Debug/net8.0`(appsettings.json 所在目录):此前按仓库根目录启动导致 `Erp:Jwt:Issuer/Audience` 读不到,签发的 JWT 无 iss/aud,所有认证请求 401。在输出目录启动后恢复。
- 两份 xlsx 原文件未改动;导入脚本在 `/tmp/erp_import.py`(未进仓库)。

## 改动文件

- 新增后端:`src/ErpApi/Features/MasterData/MasterImportHelper.cs`(共用 ImportResult/Trim/列宽/数字解析)、`src/ErpApi/Features/Materials/MaterialMaster/MaterialImport.cs`、`src/ErpApi/Features/Plastics/PlasticMaterialMaster/PlasticMaterialImport.cs`、`tests/ErpApi.Tests/MaterialImportValidationTests.cs`
- 修改后端:`Features/Materials/MaterialMaster/MaterialMasterController.cs`(+import 动作)、`MaterialMasterService.cs`(+ImportAsync)、`Features/Plastics/PlasticMaterialMaster/PlasticMaterialMasterController.cs`(补注入 + import 动作)、`PlasticMaterialMasterService.cs`(+ImportAsync)
- 新增前端:`web/src/utils/materialImport.ts`、`web/src/__tests__/materialImport.test.ts`、`web/src/components/MaterialImportModal.tsx`、`web/src/api/importResult.ts`
- 修改前端:`web/src/api/materialMaster.ts`、`web/src/api/plasticMaterialMaster.ts`(各 +importRows)、`web/src/pages/materials/MaterialMasterPage.tsx`、`web/src/pages/plastics/PlasticMaterialMasterPage.tsx`(各 +"导入表格"按钮与弹窗)、`web/package.json`/`package-lock.json`(xlsx)
- 无 schema 变更。

## 分类整理(同日追加)
- 按旧系统([BQR]生产管理软件)分类清单建 12 个顶级分类:01 五金/02 吸塑/03 马达/04 IC/05 电池/06 开关/07 利宝说明书/08 彩盒内咭/09 车缝与车发/10 外购物/11 胶袋及收缩膜/12 辅料(物料类别.编号=两位码,名称=类名)。
- 删除 12 行 DEMO 演示类别(种子重复 4 遍);6 行 DEMO 演示物料因被 采购入仓明细单 外键引用无法删除,改为清空其 物料类别(仅出现在"全部物料",不进树)。
- 288 条 77772 来料按编号前两位归类:五金5/吸塑5/IC44/利宝说明书106/彩盒内咭100/外购物4/胶袋及收缩膜16/辅料8;马达/电池/开关/车缝与车发暂为空类。接口验证:categories 树数量正确,按类别过滤列表正常。

## 物料编号唯一性(同日追加)
- 现状:物料资料早有唯一约束 UQ_物料资料_物料编号(db/02);塑胶物料资料缺 → 新增 db/62_unique_plastic_material_code.sql 建 UX_塑胶物料资料_物料编号(幂等,已应用本地库)。
- 应用层前置校验(中文提示):MaterialController/PlasticMaterialController 重写 ValidateForSaveAsync(Trim+非空+查重排除自身);MaterialMasterController.Create 捕获 EF 包装的 DbUpdateException(内层 SqlException 2601/2627)→ 409 {消息:物料编号已存在}。注意 EF 会把 SqlException 包成 DbUpdateException,直接 catch SqlException 抓不到。
- 前端:MaterialMasterPage/PlasticMaterialMasterPage 保存失败时展示后端 {消息}(沿用 errMsg 惯例),不再只显示"保存失败"。
- 实测:通用CRUD新增重复 400、编辑改重 400、空编号 400、档案新增接口撞索引 409、正常新增 201/删除 204;dotnet test 212 过;前端构建过(lint 4 个错误为既有基线)。
- 运维备注:5000 后端需以 ASPNETCORE_ENVIRONMENT=Development + cwd=src/ErpApi/bin/Debug/net8.0 启动(Development 才加载 staticwebassets 清单映射 src/ErpApi/wwwroot,否则 SPA 404;swagger 也仅 Development);web/dist 构建后同步覆盖 src/ErpApi/wwwroot 即更新 5000 端口前端。
