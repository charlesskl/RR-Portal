# 华登包材管理 — 订单号重复提示

**Status:** Spec · 待用户 review
**Date:** 2026-05-15
**Branch:** `feat/huadeng-order-no-dedup`

## Problem

`flow_records.order_no` 字段无唯一约束，且各 party（hd/sy/xx）独立维护自己的台账。用户手工录入新记录时，可能不小心把已经录过的订单号再录一遍，造成自己台账里同号重复，影响后续对账。

目前没有任何提示，用户只能事后翻表格自己发现。

## Goal

录入新记录时，如果填的订单号在**当前用户自己**的台账里、**同一对往来**已经出现过，弹个警告告诉用户重复了，由用户决定是否照样保存。

> Non-goal: 编辑已有记录、Excel 批量导入两个场景**本期不做**。先解决最高频的手工录入。

## Scope

### 触发条件

| 维度 | 取值 |
|---|---|
| 触发场景 | `_flow_entry_form.html` 提交（手工录入新记录）|
| 重复定义 | `order_no` 完全相等（去前后空白后比较）|
| 比较池 | `recorded_by = 当前登录方 AND {from_party, to_party} = {当前方, 对方}`（双向）|
| 空值处理 | 新输入的 `order_no` 为空或纯空白 → 不检查、直接保存 |

举例：华登（hd）账号在"对兴信"面板录一条"发→兴信"的新记录，订单号 `A001` —— 系统查 `flow_records` 中所有 `recorded_by='hd' AND ((from_party='hd' AND to_party='xx') OR (from_party='xx' AND to_party='hd'))` 的记录里有没有 `order_no='A001'`，有就提示。

### 用户行为

1. 用户填好表单点保存
2. 后端检测到重复 → **不**写入数据库，**重新渲染**表单页（保留所有已填字段）+ 顶部黄色 flash 警告，列出冲突的已有记录信息（id、日期、方向、对方）+ 一个"仍然保存"的按钮
3. 用户点"仍然保存"→ 后端跳过去重检查直接落库
4. 用户改了订单号再点保存 → 重新走去重检查

### 不在范围内

- 编辑（`/record/<id>/edit`）：暂不做。
- Excel 导入（`/import/<config>`）：暂不做。
- 跨 party 的重复（如查 hd 录的 vs xx 录的）：刻意不做，因为对账系统两边本来就会各自登记同一笔单，订单号天然重叠，跨方检查 = 全是误报。

## Design

### 后端

**路由：** 复用现有的 `POST /party/<party>/entry`（`app.py:607`，`_flow_entry_form.html` 的 form action）。

**新增辅助函数：**

```python
def _find_duplicate_order(con, *, order_no, party, cp):
    """查当前 party 在 hd↔cp 对中,自己录的、order_no 完全相等的现有记录。

    Returns: list[dict]; 空 list 表示无重复。
    """
    order_no = (order_no or '').strip()
    if not order_no:
        return []
    rows = con.execute("""
        SELECT id, date, from_party, to_party
        FROM flow_records
        WHERE order_no = ?
          AND recorded_by = ?
          AND ((from_party = ? AND to_party = ?) OR (from_party = ? AND to_party = ?))
        ORDER BY id
    """, (order_no, party, party, cp, cp, party)).fetchall()
    return [dict(r) for r in rows]
```

**POST handler 改造：**

```python
@app.route('/party/<party>/entry', methods=['POST'])
@party_required
def entry(party):
    # ...解析 form 字段...
    order_no = request.form.get('order_no', '').strip()
    confirm_dup = request.form.get('confirm_dup') == '1'  # 用户点"仍然保存"时为 '1'

    if order_no and not confirm_dup:
        con = sqlite3.connect(DATABASE)
        dups = _find_duplicate_order(con, order_no=order_no, party=party, cp=cp)
        con.close()
        if dups:
            # 把表单数据 + dup 信息塞回 session,重渲染 party 页面
            session['dup_warning'] = {
                'form': dict(request.form),  # 用户已填的所有字段
                'dups': dups,
                'cp': cp,
                'direction': direction,
            }
            flash(f'订单号 {order_no} 已在你的台账里出现过 {len(dups)} 次', 'warning')
            return redirect(url_for('party_page', party=party))

    # 没重复 或 用户已确认 → 正常插入
    # ...原有 insert 逻辑...
```

### 前端

**`_flow_entry_form.html` 改造：**
- 在表单顶部读 `session['dup_warning']`，如果存在且 `cp/direction` 匹配当前 tab，渲染：
  - 黄色警告条，列出冲突记录的 id/日期/方向
  - 已填字段用 `value="{{ dup_warning.form[k] }}"` 回填
  - 隐藏字段 `<input type="hidden" name="confirm_dup" value="1">`
  - 保存按钮文案改成"仍然保存"（红色），旁边加"取消"按钮（清掉 session 警告，恢复空表单）
- 渲染后清掉 `session['dup_warning']`（防止下次进页面又看到）

**视觉示意：**

```
┌────────────────────────────────────────────────────────┐
│ ⚠ 订单号 A001 已在你的台账里出现过 1 次:                │
│   · id=234, 2025-12-31, 华登 → 兴信                     │
│                                                        │
│ 检查无误后,点"仍然保存"会强制保存这一条;若改订单号,    │
│ 修改后重新保存会自动重查。                              │
└────────────────────────────────────────────────────────┘

[日期 2026-05-15] [订单号 A001    ] [备注      ]
[胶箱  120] [钙塑箱 0] ...
                                  [取消] [仍然保存(红)]
```

## Data Flow

```
用户填表 → POST /party/hd/record/add
            ↓
        order_no 非空? ─── no ──→ INSERT 直接插
            ↓ yes
        confirm_dup=1? ─── yes ──→ INSERT 直接插
            ↓ no
        _find_duplicate_order
            ↓
        有重复? ─── no ──→ INSERT
            ↓ yes
        flash + session 保存表单数据 + redirect 回 party 页面
            ↓
        (前端) 渲染警告 + 回填字段 + confirm_dup=1 隐藏字段
            ↓
        用户点 "仍然保存" → POST 重发,带 confirm_dup=1 → INSERT
```

## Error Handling

| 情况 | 处理 |
|---|---|
| `order_no` 全空白 | 当作空处理，不查重 |
| `_find_duplicate_order` SQL 抛异常 | 让 Flask 默认 500 处理，不掩盖（极小概率）|
| 用户在两个 tab 各填了一半 | session 里只存最近一次的 dup_warning；新触发覆盖旧的 |
| 用户填了警告后关浏览器 | session 失效后 dup_warning 自然清掉，重新打开是空表单 |

## Testing

### 新增单元测试 `tests/test_duplicate_order.py`

| 用例 | 期望 |
|---|---|
| `test_no_duplicate_inserts_directly` | 新订单号 → 直接 INSERT，返回 302 |
| `test_duplicate_same_recorded_by_same_pair_blocks` | hd 录的 hd→xx A001 已存在，hd 再录 hd→xx A001 → 不 INSERT，flash 警告 |
| `test_duplicate_reverse_direction_same_pair_blocks` | hd 录的 hd→xx A001 已存在，hd 录 xx→hd A001 → 也提示（双向）|
| `test_duplicate_other_party_same_pair_passes` | xx 录的 xx→hd A001 已存在，hd 录 hd→xx A001 → **不**提示（跨录入人）|
| `test_duplicate_other_pair_passes` | hd 录的 hd→sy A001 已存在，hd 录 hd→xx A001 → 不提示（跨 pair）|
| `test_empty_order_no_passes` | order_no 为空字符串 / None / "   " → 直接 INSERT |
| `test_confirm_dup_force_insert` | 第一次提示，第二次带 confirm_dup=1 → INSERT |

### 回归

- 现有 121 个 huadeng 测试 100% 通过（去重逻辑只在 order_no 非空 + 非 confirm_dup 时触发，默认 path 不变）。

## Out of Scope (本期不做)

- 编辑路由 `/record/<id>/edit` 加去重检查 — 后续考虑
- Excel 导入 `/import/<config>` 预览页标记重复行 — 后续考虑
- 跨 party 去重 — 业务上不合理，不做
- 模糊匹配（如忽略大小写、忽略前导零等）— 不做，严格相等

## Implementation Notes

- 现有 `_flow_entry_form.html` 估计是个共享 partial，要小心两个 tab（发→/收自）的 cp/direction 状态。
- session 里 dup_warning 用完即焚 —— 渲染完后端要 `session.pop('dup_warning', None)`。
- flash 类型用 `'warning'`（已有 `flash(msg)` 调用是默认 category；视 `base.html` 怎么样式化 category 决定是否要扩展 CSS）。
- `confirm_dup=1` 这个隐藏字段只在用户主动点"仍然保存"时存在，第一次提交不带，所以默认就是检查模式 —— 设计上不依赖客户端"诚实"，因为最坏情况就是用户绕过提示存了重复，等同于现状。
