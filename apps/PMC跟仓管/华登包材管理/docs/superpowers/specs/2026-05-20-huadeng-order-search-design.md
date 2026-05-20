# 华登台账页订单号搜索 — 设计文档

日期:2026-05-20
应用:华登包材管理 (huadeng)

## 目标

在台账页 `/party/<party>` 增加一个订单号搜索框,让用户能按订单号快速定位收发记录。

## 需求(已与用户确认)

- **搜索范围**:当前 party 台账页内过滤 —— 按订单号过滤页面上所有面板的「发出/收到」记录,只显示匹配行。与现有日期筛选并列,同一套机制。
- **匹配方式**:模糊包含。输入内容是订单号的一部分即匹配(如输入 `123` 匹配 `PO-2026-00123`)。
- **与日期筛选关系**:AND —— 订单号与日期范围同时生效。
- **不匹配的表格**:保持显示「暂无记录」,不折叠面板(与日期筛选行为一致)。

## 改动点(共 3 处)

| 位置 | 改动 |
|------|------|
| `app.py` `_query_flow()` | 加可选参数 `order_no=None`;有值时 SQL 追加 `AND order_no LIKE ?`,参数为 `%{order_no}%` |
| `app.py` `party_page()` | 读 `order_no = request.args.get('order_no', '').strip()`;传给全部 `_query_flow` 调用;`render_template` 多传 `order_no=order_no` |
| `templates/party.html` 筛选表单 | 日期输入框后加一个文本框 `<input type="text" name="order_no" value="{{ order_no }}" placeholder="订单号">` |

不新增路由、不改数据库 schema、不改 `page_link`。

## 数据流

用户在筛选表单输入订单号 → 点「筛选」→ `GET /party/<party>?order_no=xxx&date_from=…` → `party_page` 读取参数 → `_query_flow` 的 SQL 加 `LIKE` 子句 → 各面板的「发出/收到」表只含匹配记录 → 分页与合计行基于过滤后结果重算 → 渲染。

- 「重置」按钮已是 `href="/party/{{ party }}"`,清掉所有参数,无需改。
- 翻页链接经 `page_link()`(用 `request.args.to_dict()` 复制全部 query 参数)自动带上 `order_no`,无需额外改动。

## 边界与错误处理

- 空输入 → `order_no` 为空串 → `_query_flow` 不加 LIKE → 行为同现状。
- 无匹配 → 各表显示已有的「暂无记录」。
- **已知小限制**:订单号里若输入 `%` 或 `_`,会被 SQL LIKE 当通配符。订单号是业务编号一般不含这些字符,v1 不做转义。SQL 参数化已防注入,无安全问题。

## 测试

新增 `tests/test_order_search.py`(沿用 `test_duplicate_order.py` 的 pytest 惯例),覆盖:

- 完整订单号 → 只返回匹配记录
- 模糊子串 → 能匹配
- 空搜索 → 返回全部记录
- 订单号 + 日期同时筛选 → AND 生效
- 无匹配 → 空结果

## 不做(YAGNI)

- 跨 party / 全库搜索
- 纯前端 JS 即时过滤(与服务端分页冲突,会漏搜)
- 搜索时折叠空面板
- LIKE 通配符转义
