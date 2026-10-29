# ERP入仓单打回与重新送审

该流程保留排产入库原行、ERP原入仓单号和每轮历史。只有ERP明确打回的整组原行可改实收件数、送货啤数；采购来源、模号、颜色、色粉和出模数保持原值。重新送审会锁定整组数量。入库结果以ERP审核为准。

## 配置与入口

- 排产服务配置 `ERP_RECEIPT_RETURN_TOKEN`，Compose从私有环境变量 `PAIJI_ERP_RECEIPT_RETURN_TOKEN` 透传。ERP配置对应 `Paiji__ReturnToken`。密钥仅保存在双方服务端，不提交到仓库、不传到浏览器。
- 保留原Nginx Basic认证。ERP调用下述两个服务端接口时还须带 `X-ERP-Token`。
- 开启该配置后，车间重新登录会取得12小时有效的签名会话。浏览器修改/重新送审带 `X-Paiji-Session`，不会覆盖Nginx使用的Authorization头。旧会话仍可使用原功能，处理ERP打回单前须重新登录。
- 当前车间的“入库单”页面顶部显示持久待办“ERP打回待修改”。点“查看原因并修改”核对整组数量，然后点“整单重新送审”。“已重新送审”仅表示数据已提交，不表示ERP已审核或已入库。

## 接口协议

`POST /api/warehouse-orders/_/erp-return`：

```json
{
  "request_id": "00000000-0000-4000-8000-000000000001",
  "erp_receipt_no": "P89-SR-DEMO",
  "round": 1,
  "workshop": "AT",
  "reason": "实收数量需要核对",
  "ids": [1, 2]
}
```

必须一次发送原ERP入仓单的全部排产行ID。ERP负责从已保存的真实同步关系确定这些ID。排产端核对行存在、车间、已送货状态和ERP来源标记后同一SQLite事务登记整组。相同request_id和原内容重试只返回当前状态，不撤销已经完成的重新送审。新一轮需新UUID、连续round、同一ERP单号和同一组ID，且上一轮已经重新送审。

`POST /api/warehouse-orders/_/erp-resubmit`：

```json
{
  "request_id": "00000000-0000-4000-8000-000000000001",
  "erp_receipt_no": "P89-SR-DEMO",
  "round": 1,
  "workshop": "AT",
  "submission_revision": 0,
  "ids": [1, 2],
  "rows": [
    { "id": 1, "delivery_pcs": 60, "delivery_shots": 10 },
    { "id": 2, "delivery_pcs": 40, "delivery_shots": null }
  ]
}
```

该接口使用当前车间签名会话。必须提交整组；实收件数为正整数，送货啤数为正整数或null。按当前revision比较并原子保存数量、锁定整组、revision加一。单产物可以按实收PCS送审；共模数量关系仍由ERP按冻结真实配件出模数核对，排产端不猜配件身份。相同原版本和完全相同数量重试不会加第二次版本。

ERP核对更正数量未通过时，`POST /api/warehouse-orders/_/erp-reopen` 使用与erp-return相同字段，并额外带**刚被拒绝的** `submission_revision`，原因改为实际校验失败原因。只有当前revision能解锁；旧拒绝请求不能把较新的重新送审打回。ERP继续复用原入仓单，不删除同步游标、不重新建单。

服务端动作返回：

```json
{
  "request_id": "00000000-0000-4000-8000-000000000001",
  "erp_receipt_no": "P89-SR-DEMO",
  "round": 1,
  "workshop": "AT",
  "ids": [1, 2],
  "status": "returned",
  "submission_revision": 0
}
```

`GET /api/warehouse-orders`及详情的原行额外返回：`erp_receipt_no`、`erp_return_token`、`erp_return_round`、`erp_review_status`、`erp_return_reason`、`erp_submission_revision`。新记录默认这些字段为NULL，不批量解释历史。

`GET /api/warehouse-orders/_/erp-returns?workshop=AT` 返回各ERP单最新一轮、原因、整组原行。旧轮次和每次操作持久保存在 `erp_receipt_returns` 与 `erp_receipt_review_events`。

ERP打回绑定后的行不能普通删除、取消入库、换来源或修改审批元数据。整组重新送审后不能继续改量。未接入该流程的普通入库单保留原行为。

## 独立物料名称

`orders` 和 `pi_warehouse_orders` 的 nullable `material_name` 只保存显示名称。ERP从已保存SP的真实成员名提供，同模多个产物全部显示；`mold_name` / `part_name` 保持原模号身份，不把名字拼入匹配字段。完成订单选模复制该独立名称。普通手工入库单也可填写，历史NULL不从模号猜名字。

任务支持 `PUT /api/orders/:id` 只传 `material_name`，其余值保持。旧入库单的普通PUT是历史全行更新接口，**不要用它仅传名称**。批量补名必须使用服务端专用入口：

```http
POST /api/warehouse-orders/_/erp-material-names
X-ERP-Token: <服务端配置>
```

```json
{
  "workshop": "AT",
  "rows": [
    { "id": 1, "material_name": "P89铲子、P89猫砂盆" }
  ]
}
```

每批1至1000个唯一ID，名称须非空且最多1000字。ERP须从真实已保存同步记录确定ID及物料名，不能按模号猜。未知ID、跨车间或任何额外业务字段整批拒绝；全批成功返回 `{ "workshop": "AT", "updated": 1, "ids": [1] }`。只更新显示名，不触碰任何来源、数量、状态、价格、送审元数据或时间戳；已锁定的打回行也可补显示名。

## 检查

```sh
cd server
node --test tests/erpReceiptReturn.test.js
node --test tests/*.test.js
cd ../client
node --test tests/*.test.mjs
npm run build
```

专项使用独立临时SQLite和loopback HTTP，覆盖整组原子性、数据库中途失败回滚、并发重试、两轮历史、过期请求、错误服务端密钥、车间隔离、字段冻结、普通单兼容及重开持久化。真实ERP审核、反审核、库存与订单额度须继续在ERP隔离测试库验收；本应用测试不代表ERP库存已经验证。
