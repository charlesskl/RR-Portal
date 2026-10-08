# 2026-07-31 采购订单改造为旧系统单据页(自由开单+未审核可编辑+打印)

## 改动清单

### DB
- db/66_purchase_line_material.sql:[采购明细单] 加 [材料] nvarchar(40) NULL(幂等,DbDeploy 已应用)。

### 后端(src/ErpApi/Features/Materials/PurchaseOrder/)
- PurchaseOrderDtos.cs(整文件重写,顺带统一行尾):明细 DTO 加 材料/生产单号(行级,空回落单头)/款号/备注;创建 DTO 加 收件人;单头 DTO 加 收件人/打印次数;明细查询行 DTO 加 材料/生产单号/款号/备注。
- PurchaseOrderService.cs:
  - CreateAsync:支持自由开单(生产单号可空);单头插 收件人/打印次数=0;明细插 材料/款号/行级生产单号/备注;数量/金额后端按明细汇总(不信任前端)。
  - 新增 UpdateAsync:仅 审核<>'1' 可改(否则 InvalidOperationException "已审核的采购订单不能修改，请先反审核。");UPDLOCK 锁单行;单事务 更新单头+删旧明细插新明细+重算数量金额。
  - 新增 PrintAsync:打印次数+1,返回新计数。
  - ListAsync/GetAsync SELECT 带 收件人/打印次数/材料/款号/生产单号/备注。
- PurchaseOrderController.cs(整文件重写):新增 PUT {单号}(保存权限;已审核 400 中文)和 POST {单号}/print(打印权限,返回 {打印次数})。

### 前端
- api/purchaseOrders.ts:类型补 收件人/打印次数/材料/款号/生产单号/备注;加 update/print 封装。
- PurchaseOrderListPage.tsx:工具栏加"新建"(保存权限)打开自由开单抽屉。
- PurchaseOrderDrawer.tsx(重写,569 行):三模式(新建自由开单/未审核编辑/已审核只读)。
  - 表头:供应商(SupplierPicker)、日期(默认今天)、交货日期、收件人、仓库、备注、电脑单号(保存后显示)、操作员。
  - 明细可编辑网格:生产单号|款号|物料编号|物料名称|规格|材料|颜色|单位|数量|单价|金额|备注+行删;"加行"弹 MaterialPicker 带出(材料从 物料.备注 的 "材料:X" 解析;无单价权限不带单价);金额=数量×单价自动;底部数量/金额合计。
  - "录入清单":弹输入生产单号 → basis 接口追加行(保留原 basis 开单能力;PurchaseMaterialAnalysisPage 的 生产单号 prop 调用方兼容)。
  - 保存:新建 POST/未审核 PUT;已审核 PUT 被后端 400 拒。
  - 打印(查看态+打印权限):先 print 接口计数 → createPortal 到 body 的 po-print-only 隐藏 div(白底黑字 单头+明细+合计)→ window.print()。

## 验证
- dotnet build 0 错;dotnet test 212 过;npm run build 过;npm test 310 过(前端 agent 交付后统一跑);eslint 3 个改动文件 2 ≤ 基线 3(无新增)。
- curl 全链路(测试数据:供应商 PWSUP01/款号 PW777 临时建,物料用 01030008/01030026):
  ① 自由开单(不带生产单号,3 行含材料/款号)→ PO20260731001,单头 数量=350/金额=3.45=明细汇总;
  ② GET 详情 材料=铁/款号/收件人/打印次数=0 齐全;
  ③ PUT 行1 数量 100→300 → 重算 数量=550/金额=4.35;
  ④ 审核 204 → ⑤ 已审核 PUT 400 "已审核的采购订单不能修改，请先反审核。";
  ⑥ 反审核 204 → ⑦ print×2 → 打印次数 1、2。测试单/供应商/款号已全部清理(采购订单 total=0)。
- 注意:采购订单/采购明细单 有 FK(供应商编号→供应商资料、物料编号→物料资料、款号→款号总表、生产单号→生产制单),自由开单时 款号/生产单号 留 NULL 才不受 FK 限制;报错走 SqlException 547 → 400 "关联数据不存在"。
- Playwright:UI 新建(选供应商/加行选料带出 材料=铁/数量合计)→ 保存 PO20260731002 → 列表出现 → 审核 → 查看态(已审核 Tag/反审核/打印按钮)→ 打印(po-print-only 视图生成)。截图 po_new_form.png / po_approved.png / po_print.png。
- 坑:antd 6 Drawer 容器类名是 .ant-drawer-section/.ant-drawer-content-wrapper(没有 .ant-drawer-content);隐藏 Modal 残留 DOM,Picker 选择器要用 :visible 过滤。
- 部署:后端 Development 重启;web/dist 已同步 src/ErpApi/wwwroot(index-Pz_DU0wv.js)。

## 已知限制(汇报用)
- 表头"日期"只显示不提交(创建/更新 DTO 无日期字段,后端创建取当前时间);如需改单日期,后端 DTO 加字段即可。
- 原"合同号"字段按任务书从表单去掉(DTO 仍保留)。
- "录入清单"按钮未做权限门控(保存按钮有门控)。

## "加载采购订单失败"排查(同日追加)
- 现象:用户实测新建 PO 后报"加载采购订单失败"。审计轨迹:用户完整走完了 新增→审核→打印→反审核→删除 流程,单据本身创建成功。
- 排查:后端 create→GET 序列实测正常;明细为 null 时前端 `r.data.明细.map` 会抛 TypeError 被 catch 误报为"加载失败";404 时也一律显示笼统文案。
- 修复:purchaseOrders.get 明细兜底 `(明细 ?? [])`;PurchaseOrderDrawer.loadDetail 404 显示"单据不存在或已被删除",其他错误透传后端 {消息}。
- 另:5173 的 vite dev 进程是 7-26 启动的旧进程,已重启确保最新代码;复现测试数据(PO20260731003/TESTS01 供应商)已清理。

## 生产通知单货号改选择(同日追加)
- ProductionNoticePage 货号明细行的 货号/BOM款号 由手输改为 AutoComplete 选择(数据源 款号总表 stylesApi.list);选货号自动带出 款号名称(=款式),BOM款号 未填时默认=货号;仍可手输。
