# 项目笔记 - 后续迭代记录

> 记录骨架 8 个任务完成之后,在原系统上做的所有功能扩展、设计决定、字段约定。
> 每次对话补充新内容时,按时间倒序追加到文件顶部。

---

## 当前架构概览

**端口**:5002(`serve.py` 和 `app.py` 里写死,如需改一并改两处)

**已有页面**(导航顺序):
- 库存总览 / 入库流水 / 出库流水
- 货号细表(点 SKU 进入)
- 布标维护(admin only)
- 用户管理(admin only)
- **排期对比**(所有人可见)
- **字母绑定**(所有人可见,改/删 viewer 隐藏)
- **布标映射**(所有人可见,改/删 viewer 隐藏)
- 导出 Excel

---

## 关键数据模型

### `po_schedules`(排期表)
来自 `xlsx` 上传,**整库替换**式入库。

| 字段 | 说明 |
|---|---|
| series | sheet 名(如 `15758二代`) |
| po_no | D 列 PO 号 |
| item_code | G 列 ITEM#(`15758-S001`、`15758A-S001` 等) |
| customer_sku | F 列 SKU(客户内部,如 `4500159232-190`) |
| variant_letter | 单款字母(拼盘行为空,看 letters_json) |
| qty | I 列 PO 数量 |
| customer | B 列 |
| country | C 列(走货国家) |
| **flag_type** | 排期布标类型(`MA布标 / 客版布标`),按 AM/AN 列哪列有数判定,fallback 到 AL 标签列 |
| **flag** | `{flag_type}-{country}` 拼接,如 `MA布标-美国` |
| **ratio_normal_text** | AU 列(`每款的23/24` 等) |
| **ratio_rare_text** | AV 列(`每款的1/24` 等) |
| **letters_json** | 字母分布 JSON:`[{letter:"A",qty:30,image_url:"/static/.../A.png"}]`,**不拆开存** |
| name_cn | H 列中文名 |
| plan_ship_date | M 列计划出货期 |
| image_url | 单款行的图(SKU 视图用) |

### `letter_bindings`(字母绑定主数据)
用户手动维护,UNIQUE(sku, letter)。

| 字段 | 说明 |
|---|---|
| sku | **纯数字货号**(如 `15758`),不是带后缀的 ITEM# |
| letter | A / B / D / E / G / H / J / K / L 等 |
| material_name | 入库时填的物料名(如 `小杏怪`) |

**匹配规则**:排期 ITEM# 用正则 `^(\d+)` 提取数字前缀 → 跟 `letter_bindings.sku` 匹配 → 查到 `material_name` → 用 `(sku, name, style, flag)` 4 维查库存。

### `flag_mappings`(布标映射)
UNIQUE(flag_type, country)。

| 字段 | 说明 |
|---|---|
| flag_type | 排期里布标类型(`MA布标` / `客版布标` ...) |
| country | 排期里国家(`美国` / `英国` ...) |
| inventory_flag | 库存里实际录入的布标(`MA标美国版` / `客标美国` ...) |

排期对比时,把排期 `(flag_type, country)` 翻译成 `inventory_flag` 后再查库存。没配映射就 fallback 用 `{flag_type}-{country}` 拼接。

---

## 排期 xlsx 解析规则

- **sheet 筛选**:首字符是数字的 sheet 才解析(自动过滤 `半成品MA / 包装MA / 布料MA / 取消订单`)
- **表头**:跨 R3+R4 合并扫描(`每款普通款数量` 在 R3,`PO号` 等在 R4)
- **蓝色字体跳过**:R<80 G<80 B>150 RGB 判定 = 已完货
- **不拆开**:每行 1 条 DB 记录,字母分布塞 letters_json
- **同货号配比回退**:AU/AV 空时,用同数字前缀 sku 上一行的比例
- **比例字符串**:支持 `N/M` 分数、`减去稀有款`、纯数字 3 种
- **兜底**:AU/AV 都失败时,全部归普通款,标 `ratio_assumed=true`
- **图片**:从每张 sheet 的 `_images`(产品缩略图)抽取,SHA1 hash 去重存到 `static/schedule_images/`

---

## 视图视图

### 排期对比页(`renderSchedule`)
- 上传按钮(admin+operator 见,viewer 不见)
- PO 号 / ITEM# / 客户 SKU 三种值都能搜
- 返回 `type`:`po` / `sku` / `none`
  - **PO 视图**:每个 ITEM# 一行,按比例拆成 **普通款需求 / 稀有款需求 两个表**
  - **SKU 视图**:每个 PO 行展开为字母 chips,同样**普通/稀有两表**
- 每行展示:货号 / 字母(带产品图) / 物料 / 库存布标(翻译后,如不同显示排期原文) / 比例文本 / 计划 / 库存 / 缺口 / 够否

### 字母绑定页(`renderBindings`)
- 主数据风格:列表 + 新增/改/删按钮
- 弹窗里物料名建议来自该 sku 已入库的 distinct name(`materials_by_sku`)
- 字母只允许 A-Z 单字母大写

### 布标映射页(`renderFlagMappings`)
- 已映射 + 待映射(从已上传排期里抽 `(flag_type, country)` 组合)
- 弹窗里"库存布标"输入框 datalist 从 `布标维护` 拉建议

---

## 入库 / 出库

- 录入弹窗去掉了 placeholder("如: IN-008" 等)
- 加了"清空"按钮
- 编辑功能:每行 [编辑][删除],PUT `/api/in/<id>` 和 `/api/out/<id>`,admin+operator 可编辑
- 录入时 SKU 字段填**纯数字货号**(15758),物料名填具体款(小杏怪)
- 布标字段填**库存约定的拼接名**(如 `MA标美国版`)

---

## 其他功能扩展

- **货号细表导出**:每个货号一个 xlsx,入库/出库 各一个 sheet,矩阵布局(行 = 单据,列 = 款式×布标)
- **数据库备份**:`python backup.py`(保留 30 天)
- **生产服务器**:`python serve.py`(waitress,8 线程,端口 5002)

---

## 测试

- `python test_logic.py` → 29/29 应当全过(每次改动都验证)
- 不要改 `calculate_stock` 和已有 29 个测试

---

## 仍可改进的方向

- 排期对比里,多 PO 排队时按出货期累计扣库存(目前每个 PO 独立看库存,不互相扣减)
- 字母绑定页可加批量导入(CSV)避免一条条填
- 布标映射页可加批量配置("MA布标 + 所有国家 → MA标XX版" 模板生成)
