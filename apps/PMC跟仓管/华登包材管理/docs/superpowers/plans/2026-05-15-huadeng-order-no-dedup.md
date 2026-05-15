# 华登订单号重复提示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 当用户在 `_flow_entry_form.html` 提交录入时,若 `order_no` 在自己台账(同 `recorded_by` 同对)里已出现过,警告并要求二次确认才落库;空 `order_no` 不查。

**Architecture:** 后端在 `party_entry` POST handler 里加去重查询,命中时把表单数据塞进 `session['dup_warning']` 并 redirect 回 GET `party_page`;GET 端读 session 渲染警告横幅 + 回填表单 + `confirm_dup=1` 隐藏字段;用户再次提交带 `confirm_dup=1` 时跳过检查直接 INSERT。

**Tech Stack:** Python 3 / Flask / SQLite / Jinja2 / pytest。所有改动在 `apps/PMC跟仓管/华登包材管理/` 下。

**Branch:** `feat/huadeng-order-no-dedup`（已创建,off main,spec 已 commit `e5fd4b0`）。

---

## File Structure

```
apps/PMC跟仓管/华登包材管理/
├── app.py                                 (modify)
│   ├── + _find_duplicate_order() helper   ~line 600 (above party_page)
│   ├── M party_page() GET                 line 560
│   │       读 + pop session['dup_warning'], 传给 template
│   └── M party_entry() POST                line 607
│           检测 confirm_dup, 调 helper, 命中时 flash+redirect
├── templates/
│   ├── _flow_entry_form.html              (modify) 渲染 dup_warning 警告横幅 + 回填值 + confirm_dup hidden field
│   └── party.html                         (modify) 让命中的 panel 的 <details> 自动 open + 切到对应 tab
└── tests/
    └── test_duplicate_order.py            (create) 7 个测试用例
```

---

## Task 1: Add `_find_duplicate_order` helper (TDD)

**Files:**
- Test: `apps/PMC跟仓管/华登包材管理/tests/test_duplicate_order.py` (create)
- Modify: `apps/PMC跟仓管/华登包材管理/app.py` — add helper before `party_page` (around line 555)

- [ ] **Step 1: Create the test file with helper-only unit tests**

```python
# apps/PMC跟仓管/华登包材管理/tests/test_duplicate_order.py
"""订单号重复提示功能 — _find_duplicate_order helper + entry route 集成测试。"""
import sqlite3


def _login(client, p='hd'):
    with client.session_transaction() as s:
        s['party'] = p


def _insert(con, *, recorded_by, from_party, to_party, order_no, date='2026-05-01'):
    con.execute("""
        INSERT INTO flow_records (recorded_by, from_party, to_party, date, order_no)
        VALUES (?, ?, ?, ?, ?)
    """, (recorded_by, from_party, to_party, date, order_no))
    con.commit()


def test_helper_returns_empty_for_new_order(client):
    """未出现过的 order_no → 返回空 list。"""
    import app as app_module
    con = sqlite3.connect(app_module.DATABASE)
    result = app_module._find_duplicate_order(con, order_no='NEW-1', party='hd', cp='xx')
    con.close()
    assert result == []


def test_helper_finds_same_party_same_pair_same_direction(client):
    """hd 录的 hd→xx ORD-A,hd 再查同一对的 ORD-A → 命中。"""
    import app as app_module
    con = sqlite3.connect(app_module.DATABASE)
    _insert(con, recorded_by='hd', from_party='hd', to_party='xx', order_no='ORD-A')
    result = app_module._find_duplicate_order(con, order_no='ORD-A', party='hd', cp='xx')
    con.close()
    assert len(result) == 1
    assert result[0]['order_no'] == 'ORD-A'
    assert result[0]['from_party'] == 'hd'
    assert result[0]['to_party'] == 'xx'


def test_helper_finds_same_party_same_pair_reverse_direction(client):
    """hd 录的 xx→hd ORD-B,hd 查同一对 ORD-B → 也命中 (双向)。"""
    import app as app_module
    con = sqlite3.connect(app_module.DATABASE)
    _insert(con, recorded_by='hd', from_party='xx', to_party='hd', order_no='ORD-B')
    result = app_module._find_duplicate_order(con, order_no='ORD-B', party='hd', cp='xx')
    con.close()
    assert len(result) == 1


def test_helper_ignores_other_recorded_by(client):
    """xx 录的 xx→hd ORD-C,hd 查同一对 ORD-C → 不命中 (跨录入人)。"""
    import app as app_module
    con = sqlite3.connect(app_module.DATABASE)
    _insert(con, recorded_by='xx', from_party='xx', to_party='hd', order_no='ORD-C')
    result = app_module._find_duplicate_order(con, order_no='ORD-C', party='hd', cp='xx')
    con.close()
    assert result == []


def test_helper_ignores_other_pair(client):
    """hd 录的 hd→sy ORD-D,hd 查 hd↔xx 这对的 ORD-D → 不命中 (跨 pair)。"""
    import app as app_module
    con = sqlite3.connect(app_module.DATABASE)
    _insert(con, recorded_by='hd', from_party='hd', to_party='sy', order_no='ORD-D')
    result = app_module._find_duplicate_order(con, order_no='ORD-D', party='hd', cp='xx')
    con.close()
    assert result == []


def test_helper_empty_or_whitespace_returns_empty(client):
    """空字符串 / 纯空白 / None → 返回空 list,不查 DB。"""
    import app as app_module
    con = sqlite3.connect(app_module.DATABASE)
    assert app_module._find_duplicate_order(con, order_no='', party='hd', cp='xx') == []
    assert app_module._find_duplicate_order(con, order_no='   ', party='hd', cp='xx') == []
    assert app_module._find_duplicate_order(con, order_no=None, party='hd', cp='xx') == []
    con.close()
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd "d:/project/RR-Portal/apps/PMC跟仓管/华登包材管理"
python -m pytest tests/test_duplicate_order.py -v
```

Expected: 6 failures, all `AttributeError: module 'app' has no attribute '_find_duplicate_order'`.

- [ ] **Step 3: Implement `_find_duplicate_order` in `app.py`**

Insert at `app.py` immediately before the `@app.route('/party/<party>')` decorator of `party_page` (around line 555). Find this exact anchor in the file:

```python
@app.route('/party/<party>')
@party_required
def party_page(party):
```

Insert ABOVE it:

```python
def _find_duplicate_order(con, *, order_no, party, cp):
    """查 party 自己在 party↔cp 对里、order_no 完全相等的已存在记录。

    Args:
        con: 已打开的 sqlite3.Connection。
        order_no: 待检查的订单号 (会先 strip)。
        party: 当前登录方 (recorded_by 必须匹配)。
        cp: 对方 party。

    Returns:
        list[dict]: 命中记录的 (id, date, from_party, to_party, order_no);
                    空字符串/纯空白/None 直接返回 []。
    """
    order_no = (order_no or '').strip()
    if not order_no:
        return []
    rows = con.execute("""
        SELECT id, date, from_party, to_party, order_no
        FROM flow_records
        WHERE order_no = ?
          AND recorded_by = ?
          AND ((from_party = ? AND to_party = ?) OR (from_party = ? AND to_party = ?))
        ORDER BY id
    """, (order_no, party, party, cp, cp, party)).fetchall()
    # con.row_factory 可能未设,显式构 dict
    cols = ('id', 'date', 'from_party', 'to_party', 'order_no')
    return [dict(zip(cols, r)) for r in rows]
```

- [ ] **Step 4: Run helper tests to confirm pass**

```bash
python -m pytest tests/test_duplicate_order.py -v
```

Expected: 6 passed.

- [ ] **Step 5: Run full suite to check no regression**

```bash
python -m pytest -q
```

Expected: 127 passed (121 existing + 6 new) or close to it.

- [ ] **Step 6: Commit**

```bash
git add tests/test_duplicate_order.py app.py
git commit -m "feat(huadeng): add _find_duplicate_order helper for order_no dedup check

per spec docs/superpowers/specs/2026-05-15-huadeng-order-no-dedup-design.md
6 unit tests cover: same-pair same-recorded_by hit (both directions),
cross-recorded_by miss, cross-pair miss, empty/whitespace skip.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Wire duplicate check into `party_entry` POST handler (TDD)

**Files:**
- Test: `apps/PMC跟仓管/华登包材管理/tests/test_duplicate_order.py` (append)
- Modify: `apps/PMC跟仓管/华登包材管理/app.py:607-652` — `party_entry` function

- [ ] **Step 1: Append integration tests at the end of `test_duplicate_order.py`**

```python
# (appended to tests/test_duplicate_order.py)


def test_entry_first_submit_unique_order_inserts(client):
    """新订单号 → 直接 INSERT,无警告。"""
    _login(client, 'hd')
    rv = client.post('/party/hd/entry', data={
        'direction': 'sent', 'counterparty': 'xx',
        'date': '2026-05-01', 'order_no': 'UNIQ-1', 'jx_qty': '10',
    }, follow_redirects=False)
    assert rv.status_code == 302

    import app as app_module
    con = sqlite3.connect(app_module.DATABASE)
    cnt = con.execute(
        "SELECT COUNT(*) FROM flow_records WHERE order_no='UNIQ-1'"
    ).fetchone()[0]
    con.close()
    assert cnt == 1


def test_entry_duplicate_blocks_insert_and_sets_session_warning(client):
    """hd 已有 hd→xx ORD-X,hd 再录 hd→xx ORD-X → 不 INSERT,session 有 dup_warning。"""
    import app as app_module
    con = sqlite3.connect(app_module.DATABASE)
    _insert(con, recorded_by='hd', from_party='hd', to_party='xx', order_no='ORD-X')
    con.close()

    _login(client, 'hd')
    rv = client.post('/party/hd/entry', data={
        'direction': 'sent', 'counterparty': 'xx',
        'date': '2026-05-02', 'order_no': 'ORD-X', 'jx_qty': '5',
    }, follow_redirects=False)
    assert rv.status_code == 302
    assert rv.location.endswith('/party/hd')

    # 数据库应该只有原来那 1 条,新提交未落库
    con = sqlite3.connect(app_module.DATABASE)
    cnt = con.execute(
        "SELECT COUNT(*) FROM flow_records WHERE order_no='ORD-X'"
    ).fetchone()[0]
    con.close()
    assert cnt == 1

    # session 里有 dup_warning
    with client.session_transaction() as s:
        assert 'dup_warning' in s
        w = s['dup_warning']
        assert w['cp'] == 'xx'
        assert w['direction'] == 'sent'
        assert w['form']['order_no'] == 'ORD-X'
        assert w['form']['date'] == '2026-05-02'
        assert w['form']['jx_qty'] == '5'
        assert len(w['dups']) == 1
        assert w['dups'][0]['order_no'] == 'ORD-X'


def test_entry_duplicate_reverse_direction_also_blocks(client):
    """hd 已有 hd→xx ORD-Y,hd 在'收自xx' tab 录 ORD-Y (即 xx→hd) → 也命中。"""
    import app as app_module
    con = sqlite3.connect(app_module.DATABASE)
    _insert(con, recorded_by='hd', from_party='hd', to_party='xx', order_no='ORD-Y')
    con.close()

    _login(client, 'hd')
    rv = client.post('/party/hd/entry', data={
        'direction': 'received', 'counterparty': 'xx',
        'date': '2026-05-03', 'order_no': 'ORD-Y', 'jx_qty': '7',
    }, follow_redirects=False)
    assert rv.status_code == 302

    con = sqlite3.connect(app_module.DATABASE)
    cnt = con.execute(
        "SELECT COUNT(*) FROM flow_records WHERE order_no='ORD-Y'"
    ).fetchone()[0]
    con.close()
    assert cnt == 1  # 没新增


def test_entry_confirm_dup_force_inserts(client):
    """带 confirm_dup=1 → 跳过检查,直接 INSERT。"""
    import app as app_module
    con = sqlite3.connect(app_module.DATABASE)
    _insert(con, recorded_by='hd', from_party='hd', to_party='xx', order_no='ORD-Z')
    con.close()

    _login(client, 'hd')
    rv = client.post('/party/hd/entry', data={
        'direction': 'sent', 'counterparty': 'xx',
        'date': '2026-05-04', 'order_no': 'ORD-Z', 'jx_qty': '3',
        'confirm_dup': '1',
    }, follow_redirects=False)
    assert rv.status_code == 302

    con = sqlite3.connect(app_module.DATABASE)
    cnt = con.execute(
        "SELECT COUNT(*) FROM flow_records WHERE order_no='ORD-Z'"
    ).fetchone()[0]
    con.close()
    assert cnt == 2  # 原来的 + 强制新增


def test_entry_empty_order_no_skips_dedup_and_inserts(client):
    """order_no 留空 → 不查重,直接落库 (即使其它字段有冲突也无所谓)。"""
    import app as app_module
    con = sqlite3.connect(app_module.DATABASE)
    _insert(con, recorded_by='hd', from_party='hd', to_party='xx', order_no=None)
    con.close()

    _login(client, 'hd')
    rv = client.post('/party/hd/entry', data={
        'direction': 'sent', 'counterparty': 'xx',
        'date': '2026-05-05', 'order_no': '   ', 'jx_qty': '1',  # 纯空白
    }, follow_redirects=False)
    assert rv.status_code == 302

    con = sqlite3.connect(app_module.DATABASE)
    cnt = con.execute(
        "SELECT COUNT(*) FROM flow_records WHERE order_no IS NULL"
    ).fetchone()[0]
    con.close()
    assert cnt == 2

    # 不应有 dup_warning
    with client.session_transaction() as s:
        assert 'dup_warning' not in s
```

- [ ] **Step 2: Run new integration tests, confirm they fail**

```bash
python -m pytest tests/test_duplicate_order.py -v -k "test_entry_"
```

Expected: 5 failures (helper-only tests still pass).

- [ ] **Step 3: Modify `party_entry` in `app.py`**

Locate `app.py:607-652` (the `party_entry` function). Find this block:

```python
    qty_cols = [f'{k}_qty' for k, _ in ITEMS]
    qty_vals = []
    for col in qty_cols:
        v = request.form.get(col, '0').strip()
        try:
            qty_vals.append(float(v) if v else 0)
        except ValueError:
            qty_vals.append(0)

    con = sqlite3.connect(DATABASE)
    placeholders = ', '.join(['?'] * len(qty_cols))
    con.execute(f"""
        INSERT INTO flow_records (recorded_by, from_party, to_party, date, order_no, remark,
                                  {', '.join(qty_cols)})
        VALUES (?, ?, ?, ?, ?, ?, {placeholders})
    """, [party, from_p, to_p, date, order_no, remark, *qty_vals])
    con.commit()
    con.close()
    return redirect(url_for('party_page', party=party))
```

Replace the `con = sqlite3.connect(DATABASE)` line and everything after up through the final `return` with:

```python
    confirm_dup = request.form.get('confirm_dup') == '1'

    con = sqlite3.connect(DATABASE)
    if order_no and not confirm_dup:
        dups = _find_duplicate_order(con, order_no=order_no, party=party, cp=cp)
        if dups:
            con.close()
            session['dup_warning'] = {
                'cp': cp,
                'direction': direction,
                'form': {k: v for k, v in request.form.items()},
                'dups': dups,
            }
            flash(f'订单号 {order_no} 已在你的台账里出现过 {len(dups)} 次,确认无误后可强制保存')
            return redirect(url_for('party_page', party=party))

    placeholders = ', '.join(['?'] * len(qty_cols))
    con.execute(f"""
        INSERT INTO flow_records (recorded_by, from_party, to_party, date, order_no, remark,
                                  {', '.join(qty_cols)})
        VALUES (?, ?, ?, ?, ?, ?, {placeholders})
    """, [party, from_p, to_p, date, order_no, remark, *qty_vals])
    con.commit()
    con.close()
    return redirect(url_for('party_page', party=party))
```

Note: `order_no` here is the local variable assigned at line 628 (`request.form.get('order_no', '').strip() or None`) — so it's already `None` when blank, which short-circuits the `if order_no and ...` check correctly.

- [ ] **Step 4: Run integration tests to confirm pass**

```bash
python -m pytest tests/test_duplicate_order.py -v
```

Expected: 11 passed (6 helper + 5 integration).

- [ ] **Step 5: Run full suite for regressions**

```bash
python -m pytest -q
```

Expected: 132 passed (121 existing + 11 new).

- [ ] **Step 6: Commit**

```bash
git add app.py tests/test_duplicate_order.py
git commit -m "feat(huadeng): party_entry 检测 order_no 重复,session 暂存表单

非空 order_no 且 confirm_dup!=1 时调 _find_duplicate_order,
命中则不 INSERT,把表单原样存入 session['dup_warning'] 后 redirect
回 party_page,由 GET 端负责渲染警告。

5 个集成测试覆盖:唯一直存/重复阻止/反向命中/confirm_dup 强存/空号跳过。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `party_page` GET 读 + pop session 警告,传给 template

**Files:**
- Modify: `apps/PMC跟仓管/华登包材管理/app.py:560-604` — `party_page` function

- [ ] **Step 1: Modify `party_page` to read & pop `dup_warning`**

Locate the final `return render_template(...)` block in `party_page` (around line 602-604):

```python
    return render_template('party.html', party=party, party_name=PARTIES[party]['name'],
                           panels=panels, prices=prices, monthly=monthly,
                           date_from=date_from, date_to=date_to, page_size=page_size)
```

Insert BEFORE the `return` (after `monthly = _build_monthly_stats(party)` line):

```python
    dup_warning = session.pop('dup_warning', None)
```

And update the `render_template` call to pass it:

```python
    return render_template('party.html', party=party, party_name=PARTIES[party]['name'],
                           panels=panels, prices=prices, monthly=monthly,
                           date_from=date_from, date_to=date_to, page_size=page_size,
                           dup_warning=dup_warning)
```

- [ ] **Step 2: Run all huadeng tests — backend wiring still passes**

```bash
python -m pytest -q
```

Expected: 132 passed (template still renders without `dup_warning` because Jinja default is `None`,partials don't reference it yet).

- [ ] **Step 3: Commit**

```bash
git add app.py
git commit -m "feat(huadeng): party_page GET pop dup_warning from session

让前端 partial 拿到上一次 POST 留下的去重警告 + 表单数据。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: 在 `_flow_entry_form.html` 渲染警告横幅 + 回填表单

**Files:**
- Modify: `apps/PMC跟仓管/华登包材管理/templates/_flow_entry_form.html`

- [ ] **Step 1: Add a test for HTML rendering**

Append to `tests/test_duplicate_order.py`:

```python


def test_party_page_renders_dup_warning_in_matching_panel(client):
    """触发 dup 后再 GET /party/hd,应该看到警告横幅 + 回填的 order_no + confirm_dup hidden。"""
    import app as app_module
    con = sqlite3.connect(app_module.DATABASE)
    _insert(con, recorded_by='hd', from_party='hd', to_party='xx', order_no='RENDER-1')
    con.close()

    _login(client, 'hd')
    # 触发 dup
    client.post('/party/hd/entry', data={
        'direction': 'sent', 'counterparty': 'xx',
        'date': '2026-05-06', 'order_no': 'RENDER-1', 'jx_qty': '4',
    }, follow_redirects=False)

    # GET party 页面
    rv = client.get('/party/hd')
    assert rv.status_code == 200
    html = rv.data.decode('utf-8')
    # 警告横幅
    assert '订单号 RENDER-1 已在你的台账里出现过' in html
    # 回填的 order_no
    assert 'value="RENDER-1"' in html
    # confirm_dup hidden field 出现
    assert 'name="confirm_dup"' in html
    assert 'value="1"' in html


def test_party_page_clears_dup_warning_after_render(client):
    """渲染过一次,session 中 dup_warning 应已被 pop;再 GET 不再显示。"""
    import app as app_module
    con = sqlite3.connect(app_module.DATABASE)
    _insert(con, recorded_by='hd', from_party='hd', to_party='xx', order_no='ONCE-1')
    con.close()

    _login(client, 'hd')
    client.post('/party/hd/entry', data={
        'direction': 'sent', 'counterparty': 'xx',
        'date': '2026-05-07', 'order_no': 'ONCE-1', 'jx_qty': '2',
    }, follow_redirects=False)
    client.get('/party/hd')  # 第一次 GET,看到警告
    rv2 = client.get('/party/hd')  # 第二次 GET,不应再看到
    assert '订单号 ONCE-1 已在你的台账里出现过' not in rv2.data.decode('utf-8')
```

- [ ] **Step 2: Run new tests, confirm they fail**

```bash
python -m pytest tests/test_duplicate_order.py::test_party_page_renders_dup_warning_in_matching_panel -v
```

Expected: FAIL (template doesn't render warning yet).

- [ ] **Step 3: Modify `_flow_entry_form.html`**

Replace the entire file content with:

```jinja
{% set _dw = dup_warning if (dup_warning and dup_warning.cp == cp and dup_warning.direction == direction) else None %}
{% set _f = _dw.form if _dw else {} %}
<details class="border rounded mb-3"{% if _dw %} open{% endif %}>
    <summary class="cursor-pointer px-3 py-2 bg-blue-50 text-blue-700 font-medium text-sm">
        ➕ 新增 {{ '发→' if direction == 'sent' else '收自' }}{{ cp_name }}
    </summary>
    <form method="POST" action="/party/{{ party }}/entry" class="p-3 border-t">
        <input type="hidden" name="direction" value="{{ direction }}">
        <input type="hidden" name="counterparty" value="{{ cp }}">
        {% if _dw %}
        <div class="mb-3 p-3 border border-yellow-400 bg-yellow-50 rounded">
            <div class="text-sm font-medium text-yellow-800 mb-2">
                ⚠ 订单号 {{ _f.order_no }} 已在你的台账里出现过 {{ _dw.dups|length }} 次:
            </div>
            <ul class="text-xs text-yellow-900 list-disc list-inside mb-2">
                {% for d in _dw.dups %}
                <li>id={{ d.id }}, {{ d.date }}, {{ PARTIES[d.from_party].name }} → {{ PARTIES[d.to_party].name }}</li>
                {% endfor %}
            </ul>
            <div class="text-xs text-yellow-700">
                检查无误后,点"仍然保存"会强制保存;若改订单号,修改后重新保存会自动重查。
            </div>
            <input type="hidden" name="confirm_dup" value="1">
        </div>
        {% endif %}
        <div class="flex gap-3 mb-2 flex-wrap items-end">
            <div>
                <label class="block text-xs text-gray-500 mb-1">日期</label>
                <input type="date" name="date" value="{{ _f.date or '' }}" required class="border rounded px-2 py-1 text-sm">
            </div>
            <div>
                <label class="block text-xs text-gray-500 mb-1">订单号</label>
                <input type="text" name="order_no" value="{{ _f.order_no or '' }}" class="border rounded px-2 py-1 text-sm w-32">
            </div>
            <div class="flex-1">
                <label class="block text-xs text-gray-500 mb-1">备注</label>
                <input type="text" name="remark" value="{{ _f.remark or '' }}" class="border rounded px-2 py-1 text-sm w-full">
            </div>
        </div>
        <div class="table-scroll">
            <table class="text-sm border-collapse w-full">
                <thead><tr class="bg-gray-50">
                    {% for key, name in ITEMS %}<th class="border px-1 py-1">{{ name }}</th>{% endfor %}
                </tr></thead>
                <tbody><tr>
                    {% for key, name in ITEMS %}
                    <td class="border px-1 py-1">
                        <input type="number" step="any" name="{{ key }}_qty" value="{{ _f.get(key + '_qty', '0') }}"
                               class="w-16 border rounded px-1 py-0.5 text-right text-sm">
                    </td>
                    {% endfor %}
                </tr></tbody>
            </table>
        </div>
        <button type="submit" class="mt-2 px-3 py-1.5 {% if _dw %}bg-red-600 hover:bg-red-700{% else %}bg-blue-600 hover:bg-blue-700{% endif %} text-white text-sm rounded">
            {{ '仍然保存' if _dw else '提交' }}
        </button>
    </form>
</details>
```

Notes:
- `_dw` (dup warning) only takes effect when the warning's `cp` AND `direction` match this form instance — `_flow_entry_form.html` is included once per (cp, direction) combo in `party.html`, so only the matching form lights up.
- `_f.get(key + '_qty', '0')` falls back to `'0'` for missing qty columns; `PARTIES` is in `jinja_env.globals` (verified at `app.py:476`), so `PARTIES[d.from_party].name` works in template.
- When `_dw` is set, `<details>` is auto-opened (so the user actually sees the warning).
- `confirm_dup=1` hidden field is only present when there's a warning — first submit is always check-mode.

- [ ] **Step 4: Run new tests to confirm pass**

```bash
python -m pytest tests/test_duplicate_order.py -v
```

Expected: 13 passed.

- [ ] **Step 5: Run full suite**

```bash
python -m pytest -q
```

Expected: 134 passed.

- [ ] **Step 6: Commit**

```bash
git add templates/_flow_entry_form.html tests/test_duplicate_order.py
git commit -m "feat(huadeng): _flow_entry_form 渲染重复警告 + 回填表单

只在 (cp, direction) 匹配的那个 form 实例显示警告,<details> 自动展开,
按钮变红 + 文案 '仍然保存',隐藏 confirm_dup=1 字段让用户二次提交时落库。

2 个 HTML 集成测试覆盖渲染 + session 一次性消费。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: 让命中 panel 的 `<details>` open + 切到对应 tab

**Files:**
- Modify: `apps/PMC跟仓管/华登包材管理/templates/party.html`

> `<details open>` 已经在 Task 4 处理（`_flow_entry_form.html` 内部）。但 form 是嵌在两个 tab 之一里(`tab-sent-{{ cp }}` 或 `tab-received-{{ cp }}`),如果用户提交的是 `received` 方向、默认 tab 是 `sent`,用户看不到 form。需要 JS 自动切到匹配的 tab。

- [ ] **Step 1: Find the existing `(function (){})()` IIFE that handles `?tab=` in `party.html`**

Read `party.html` around line 320-335 (the existing tab auto-switch code we noted in earlier diff context):

```javascript
const panel = document.querySelector(`[data-cp="${cpKey}"]`);
if (!panel) return;
switchTab(tabId, cpKey);
const target = panel.querySelector('#tab-' + tabId);
if (target) target.scrollIntoView({block: 'start'});
```

- [ ] **Step 2: Add a script block reading `dup_warning` and switching tab**

Add this just before the closing `</script>` tag at the bottom of `party.html` (the one that wraps `openReconcileModal`, line ~355):

```javascript
{% if dup_warning %}
// dup warning 自动切到对应 tab + 滚到 form
(function () {
    const cp = {{ dup_warning.cp|tojson }};
    const direction = {{ dup_warning.direction|tojson }};
    const tabId = direction + '-' + cp;  // 'sent-xx' / 'received-xx'
    if (typeof switchTab === 'function') {
        switchTab(tabId, cp);
    }
    const target = document.getElementById('tab-' + tabId);
    if (target) target.scrollIntoView({block: 'start'});
})();
{% endif %}
```

- [ ] **Step 3: Append a test**

Append to `tests/test_duplicate_order.py`:

```python


def test_party_page_includes_tab_switch_js_when_warning(client):
    """触发 dup 后,party.html 应包含切 tab 的 JS,direction/cp 嵌进去。"""
    import app as app_module
    con = sqlite3.connect(app_module.DATABASE)
    _insert(con, recorded_by='hd', from_party='hd', to_party='xx', order_no='TAB-1')
    con.close()

    _login(client, 'hd')
    client.post('/party/hd/entry', data={
        'direction': 'received', 'counterparty': 'xx',
        'date': '2026-05-08', 'order_no': 'TAB-1', 'jx_qty': '2',
    }, follow_redirects=False)
    rv = client.get('/party/hd')
    html = rv.data.decode('utf-8')
    # JS 里有正确的 direction 和 cp 字符串
    assert '"received"' in html
    assert '"xx"' in html
    # 包含 switchTab 调用
    assert 'switchTab' in html
```

- [ ] **Step 4: Run new test + full suite**

```bash
python -m pytest tests/test_duplicate_order.py -v
python -m pytest -q
```

Expected: 14 passed + 135 total.

- [ ] **Step 5: Commit**

```bash
git add templates/party.html tests/test_duplicate_order.py
git commit -m "feat(huadeng): dup warning 自动切到对应 tab

direction='received' 时默认 tab 是 'sent',用户会看不见 form。
渲染时注入 IIFE 调 switchTab() + scrollIntoView。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: 本地手工烟雾验证 + 总结

**Files:** 无代码改动,仅手工验证 + 文档更新。

- [ ] **Step 1: 确认本地 Flask app 已重启或 debug 模式自动重载**

```bash
# 如果后台 app (bts8op1xq) 还在跑,debug 模式应自动 reload。
# 否则重新启动:
cd "d:/project/RR-Portal/apps/PMC跟仓管/华登包材管理"
python app.py &
```

- [ ] **Step 2: 浏览器 smoke test**

打开 `http://127.0.0.1:7000`:

1. 用 `hd / hd123456` 登录(进 `party_login` for hd)
2. 进华登 party 页面,展开"对兴信"面板,展开"➕ 新增 发→兴信"
3. 填:日期任意、订单号 `SMOKE-1`、胶箱数量 `5` → 点提交
4. 应该正常保存,记录出现在表格里
5. 再展开新增 form,填:日期任意、订单号 `SMOKE-1`(故意重复)、胶箱 `9` → 提交
6. **预期:** 页面 redirect 回来,顶部 flash "订单号 SMOKE-1 已在你的台账里出现过 1 次",发→兴信 tab 的新增 form 自动展开,黄色警告横幅列出冲突记录,表单回填了刚才的值,按钮变红色"仍然保存"
7. 点"仍然保存" → 第二条 `SMOKE-1` 也落库,表格里出现 2 条
8. 重复一次,但这次填到"收自兴信" tab(direction=received),订单号 `SMOKE-1` → 应该也命中,警告显示,且自动切到"收自兴信" tab
9. 留空订单号提交一条 → 应直接保存,不触发警告

- [ ] **Step 3: 如果 smoke 全过,跑最终全套**

```bash
python -m pytest -q
```

Expected: 全绿(预计 135+ passed)。

- [ ] **Step 4: Final summary commit (可选,文档)**

如果有发现的 corner case 或新增的 learning,补充到 spec 文件末尾然后 commit。否则跳过。

---

## Out of Scope (本期不实现,后续可单独开 plan)

- 编辑路由 `/record/<int:rid>/edit` 也做去重检查
- Excel 导入预览 (`import_preview.html`) 标记重复行
- 跨 party 去重(刻意不做,业务上不合理)

---

## Verification Checklist

完成所有 task 后:

- [ ] `python -m pytest -q` 全绿
- [ ] 手工 smoke 6 项全过
- [ ] `git log --oneline` 显示 5 个干净的 feat/feat commits + spec commit
- [ ] `git diff main..HEAD --stat` 受影响文件:
  - `app.py` (+30~40 行,2 处改)
  - `templates/_flow_entry_form.html` (重写)
  - `templates/party.html` (+10 行 JS)
  - `tests/test_duplicate_order.py` (新建,~250 行)
  - `docs/superpowers/specs/2026-05-15-huadeng-order-no-dedup-design.md`
  - `docs/superpowers/plans/2026-05-15-huadeng-order-no-dedup.md`
- [ ] 没有动到其他 service / 不相关代码 (scope discipline)
