# 华登台账页订单号搜索 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在华登台账页 `/party/<party>` 增加一个订单号搜索框,按 order_no 模糊过滤收发记录。

**Architecture:** 复用现有日期筛选的服务端机制 —— `party_page` 多读一个 `order_no` 查询参数,传给 `_query_flow`,SQL 加一句 `LIKE` 子句;`party.html` 筛选表单加一个文本输入框。不新增路由、不改数据库 schema。

**Tech Stack:** Python 3.12 + Flask 3 + SQLite3 + Jinja2;测试用 pytest + Flask test client。

**工作目录:** 所有路径相对华登 app 根目录 `apps/PMC跟仓管/华登包材管理/`,命令也在该目录下执行。

**参考 spec:** `docs/superpowers/specs/2026-05-20-huadeng-order-search-design.md`

---

## File Structure

| 文件 | 责任 | 改动 |
|------|------|------|
| `app.py` `_query_flow()`(约 1283 行) | flow_records 查询 | 加 `order_no` 参数 + `LIKE` 子句 |
| `app.py` `party_page()`(约 587 行) | 台账页视图 | 读 `order_no` 参数、下传、传模板 |
| `templates/party.html` 筛选表单(约 9–20 行) | 筛选 UI | 加订单号文本框 |
| `tests/test_order_search.py`(新建) | 功能测试 | 过滤行为 + UI 渲染测试 |

---

## Task 1: 后端按 order_no 模糊过滤

**Files:**
- Create: `tests/test_order_search.py`
- Modify: `app.py`(`_query_flow` 约 1283 行;`party_page` 约 587 行)

- [ ] **Step 1: 写失败测试**

创建 `tests/test_order_search.py`,内容:

```python
"""订单号搜索 — party 台账页按 order_no 模糊过滤。"""
import sqlite3
import app as app_module


def _login(client, p='hd'):
    with client.session_transaction() as s:
        s['party'] = p


def _insert(order_no, date='2026-03-01'):
    """插一条 hd→sy 记录,带指定 order_no 和日期。"""
    con = sqlite3.connect(app_module.DATABASE)
    con.execute(
        "INSERT INTO flow_records (recorded_by, from_party, to_party, date, order_no, jx_qty) "
        "VALUES ('hd', 'hd', 'sy', ?, ?, 1)",
        (date, order_no))
    con.commit()
    con.close()


def test_search_matches_records_containing_term(client):
    """搜 'ALPHA' → 含该子串的记录显示,其它被过滤。"""
    _login(client, 'hd')
    _insert('ALPHA-001')
    _insert('BETA-002')
    rv = client.get('/party/hd?order_no=ALPHA')
    html = rv.data.decode('utf-8')
    assert 'ALPHA-001' in html
    assert 'BETA-002' not in html


def test_search_partial_substring_in_middle(client):
    """搜订单号中间的子串 → 模糊命中。"""
    _login(client, 'hd')
    _insert('PO-2026-00123')
    _insert('PO-2026-00999')
    rv = client.get('/party/hd?order_no=00123')
    html = rv.data.decode('utf-8')
    assert 'PO-2026-00123' in html
    assert 'PO-2026-00999' not in html


def test_empty_search_returns_all(client):
    """不传 order_no → 显示全部记录(基线保护)。"""
    _login(client, 'hd')
    _insert('ALPHA-001')
    _insert('BETA-002')
    rv = client.get('/party/hd')
    html = rv.data.decode('utf-8')
    assert 'ALPHA-001' in html
    assert 'BETA-002' in html


def test_search_combines_with_date_filter_as_and(client):
    """order_no + 日期同时筛选 → AND:只显示两个条件都满足的记录。"""
    _login(client, 'hd')
    _insert('ALPHA-001', date='2026-03-01')
    _insert('ALPHA-002', date='2026-03-10')
    rv = client.get('/party/hd?order_no=ALPHA&date_from=2026-03-05&date_to=2026-03-15')
    html = rv.data.decode('utf-8')
    assert 'ALPHA-002' in html
    assert 'ALPHA-001' not in html


def test_search_no_match_shows_nothing(client):
    """搜不存在的订单号 → 无记录,页面正常返回 200。"""
    _login(client, 'hd')
    _insert('ALPHA-001')
    rv = client.get('/party/hd?order_no=ZZZ-NOPE')
    assert rv.status_code == 200
    assert 'ALPHA-001' not in rv.data.decode('utf-8')
```

> 说明:每个测试的搜索词都是被断言订单号的**真子串**(如 `ALPHA` ⊂ `ALPHA-001`),所以 Task 2 加入搜索框后,输入框回填的 `value="ALPHA"` 不会让 `'ALPHA-001' in html` 误判 —— 断言依然只在记录行真正渲染时才成立。

- [ ] **Step 2: 跑测试确认失败**

Run: `pytest tests/test_order_search.py -v`
Expected: `test_search_matches_records_containing_term`、`test_search_partial_substring_in_middle`、`test_search_combines_with_date_filter_as_and`、`test_search_no_match_shows_nothing` 四个 **FAIL**(应被过滤的记录仍出现,因为 `order_no` 参数还没被处理);`test_empty_search_returns_all` **PASS**(基线保护,本来就不过滤)。

- [ ] **Step 3: 改 `_query_flow` 加 order_no 过滤**

`app.py` 中 `_query_flow` 当前为:

```python
def _query_flow(con, *, recorded_by, from_party, to_party, date_from=None, date_to=None):
    """查 flow_records。"""
    sql = """SELECT * FROM flow_records
             WHERE recorded_by=? AND from_party=? AND to_party=?"""
    args = [recorded_by, from_party, to_party]
    if date_from:
        sql += ' AND date >= ?'; args.append(date_from)
    if date_to:
        sql += ' AND date <= ?'; args.append(date_to)
    sql += ' ORDER BY date DESC, id DESC'
    return [dict(r) for r in con.execute(sql, args).fetchall()]
```

改为(加 `order_no` 参数 + `LIKE` 子句):

```python
def _query_flow(con, *, recorded_by, from_party, to_party, date_from=None, date_to=None, order_no=None):
    """查 flow_records。"""
    sql = """SELECT * FROM flow_records
             WHERE recorded_by=? AND from_party=? AND to_party=?"""
    args = [recorded_by, from_party, to_party]
    if date_from:
        sql += ' AND date >= ?'; args.append(date_from)
    if date_to:
        sql += ' AND date <= ?'; args.append(date_to)
    if order_no:
        sql += ' AND order_no LIKE ?'; args.append(f'%{order_no}%')
    sql += ' ORDER BY date DESC, id DESC'
    return [dict(r) for r in con.execute(sql, args).fetchall()]
```

- [ ] **Step 4: 改 `party_page` 读取并下传 order_no**

`app.py` `party_page()` 中做 3 处改动。

(4a) 在读取 `date_to` 之后,新增一行读 `order_no`。当前:

```python
    date_from = request.args.get('date_from', '')
    date_to = request.args.get('date_to', '')
```

改为:

```python
    date_from = request.args.get('date_from', '')
    date_to = request.args.get('date_to', '')
    order_no = request.args.get('order_no', '').strip()
```

(4b) `_query_flow` 调用(循环内那一处)加 `order_no=order_no`。当前:

```python
            all_r = _query_flow(con, recorded_by=party, from_party=from_p, to_party=to_p,
                                date_from=date_from, date_to=date_to)
```

改为:

```python
            all_r = _query_flow(con, recorded_by=party, from_party=from_p, to_party=to_p,
                                date_from=date_from, date_to=date_to, order_no=order_no)
```

(4c) `render_template('party.html', ...)` 加 `order_no=order_no`。当前:

```python
    return render_template('party.html', party=party, party_name=PARTIES[party]['name'],
                           panels=panels, prices=prices, monthly=monthly,
                           date_from=date_from, date_to=date_to, page_size=page_size,
                           dup_warning=dup_warning)
```

改为:

```python
    return render_template('party.html', party=party, party_name=PARTIES[party]['name'],
                           panels=panels, prices=prices, monthly=monthly,
                           date_from=date_from, date_to=date_to, page_size=page_size,
                           dup_warning=dup_warning, order_no=order_no)
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pytest tests/test_order_search.py -v`
Expected: 5 个测试全部 **PASS**。

- [ ] **Step 6: 提交**

```bash
git add tests/test_order_search.py app.py
git commit -m "feat(huadeng): order_no 模糊搜索过滤 _query_flow + party_page" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: party.html 筛选表单加订单号搜索框

**Files:**
- Modify: `templates/party.html`(筛选表单 约 9–20 行)
- Test: `tests/test_order_search.py`(追加 2 个测试)

- [ ] **Step 1: 写失败测试**

在 `tests/test_order_search.py` 末尾追加:

```python
def test_search_box_renders_on_page(client):
    """台账页筛选表单含订单号输入框。"""
    _login(client, 'hd')
    rv = client.get('/party/hd')
    assert 'name="order_no"' in rv.data.decode('utf-8')


def test_search_term_reflected_in_box(client):
    """搜索后,输入框回填当前搜索词。"""
    _login(client, 'hd')
    rv = client.get('/party/hd?order_no=KEYWORD-XYZ')
    assert 'value="KEYWORD-XYZ"' in rv.data.decode('utf-8')
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pytest tests/test_order_search.py::test_search_box_renders_on_page tests/test_order_search.py::test_search_term_reflected_in_box -v`
Expected: 两个测试都 **FAIL**(筛选表单还没有 `order_no` 输入框)。

- [ ] **Step 3: party.html 加输入框**

`templates/party.html` 筛选表单当前为:

```html
    <div>
        <label class="block text-xs text-gray-500 mb-1">结束日期</label>
        <input type="date" name="date_to" value="{{ date_to }}" class="border rounded px-2 py-1 text-sm">
    </div>
    <button class="px-3 py-1.5 bg-blue-600 text-white text-sm rounded">筛选</button>
```

在「结束日期」div 之后、`筛选` 按钮之前,插入订单号输入 div,改为:

```html
    <div>
        <label class="block text-xs text-gray-500 mb-1">结束日期</label>
        <input type="date" name="date_to" value="{{ date_to }}" class="border rounded px-2 py-1 text-sm">
    </div>
    <div>
        <label class="block text-xs text-gray-500 mb-1">订单号</label>
        <input type="text" name="order_no" value="{{ order_no }}" placeholder="订单号" class="border rounded px-2 py-1 text-sm">
    </div>
    <button class="px-3 py-1.5 bg-blue-600 text-white text-sm rounded">筛选</button>
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pytest tests/test_order_search.py -v`
Expected: 全部 7 个测试 **PASS**。

- [ ] **Step 5: 提交**

```bash
git add templates/party.html tests/test_order_search.py
git commit -m "feat(huadeng): party.html 筛选表单加订单号搜索框" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: 本地运行验证

> 用户要求:写完先在本地运行验证,确认无误后再谈部署。本任务**不提交代码**。

**Files:** 无改动。

- [ ] **Step 1: 跑完整测试套件**

Run: `pytest tests/ -q`
Expected: 全部测试 PASS(含原有测试 + 新增 7 个),无 FAIL / ERROR。

- [ ] **Step 2: 本地启动 Flask**

Run: `python app.py`
Expected: 控制台显示 Flask 在 `http://127.0.0.1:7000` 启动,无报错。
说明:本地未设 `DATA_PATH`,app 使用 app 根目录的 `huadeng.db`(本地副本),**不接触服务器数据**。

- [ ] **Step 3: 冒烟检查服务已起**

另开终端 Run: `curl http://127.0.0.1:7000/health`
Expected: 返回健康检查响应(HTTP 200)。

- [ ] **Step 4: 浏览器人工验证**

浏览器打开 `http://127.0.0.1:7000`,登录一个 party,进入台账页,逐项确认:
- 筛选表单出现「订单号」输入框
- 输入一个订单号片段点「筛选」→ 只显示匹配记录
- 订单号 + 日期一起筛选 → 两个条件同时生效(AND)
- 翻页时搜索词保留
- 点「重置」→ 清空订单号和日期,恢复全部记录

- [ ] **Step 5: 关闭本地服务**

确认无误后在 `python app.py` 终端按 `Ctrl+C` 停止。向用户报告本地验证结果。

---

## Self-Review

**1. Spec coverage:**
- 搜索范围(当前台账页内过滤)→ Task 1 改 `party_page` + `_query_flow`,过滤当前 party 各面板记录 ✓
- 匹配方式(模糊包含)→ Task 1 Step 3 `order_no LIKE '%...%'` ✓
- 与日期 AND → Task 1 Step 3 `LIKE` 子句与 date 子句并列叠加;`test_search_combines_with_date_filter_as_and` 验证 ✓
- 不匹配表格显示「暂无记录」→ 复用 `_flow_table.html` 现有逻辑,无需改;`test_search_no_match_shows_nothing` 验证 ✓
- UI 输入框 → Task 2 ✓
- 重置按钮、翻页保留 → 复用现有 `href="/party/{{ party }}"` 与 `page_link`,无需改;Task 3 Step 4 人工验证 ✓
- 测试文件 `tests/test_order_search.py` 覆盖 spec 全部 5 个过滤用例 + 2 个 UI 用例 ✓
- 本地运行验证(用户要求)→ Task 3 ✓

**2. Placeholder scan:** 无 TBD/TODO;每个代码步骤均给出完整代码。

**3. Type consistency:** `_query_flow` 新参数 `order_no` 在 Task 1 Step 3 定义,Task 1 Step 4b 调用处一致传 `order_no=order_no`;模板变量 `order_no` 在 Step 4c 传入、Task 2 Step 3 模板中使用,名称一致。

无遗漏,无需补任务。
