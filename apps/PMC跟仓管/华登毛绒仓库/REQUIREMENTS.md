# 需求清单(给 Claude Code)

> 按本清单的优先级顺序实现,每完成一个任务后**必须**跑 `python test_logic.py` 确认没破坏现有逻辑。

## 测试为先!

**在动手写任何代码之前**,先跑一次:
```bash
python test_logic.py
```
应该看到 `✓ 全部测试通过!`(29 个用例全绿)

**每次写完一个 API**,再跑一次 `test_logic.py`,确认没有破坏现有逻辑。

如果加了新功能,**主动给 test_logic.py 加测试用例**(参考现有写法)。

---

## 优先级 1:出库 API(必做)

### database.py 加三个函数

```python
def query_all_out_records(category=None):
    """查询出库记录,按日期倒序。category 可选筛选品类"""
    # 仿照 query_all_in_records,但查 out_records 表

def insert_out_record(data, username):
    """新增出库记录,字段比入库多 po(可空) 和 picker(可空)"""
    # 仿照 insert_in_record,SQL 多 po 和 picker 两个字段

def delete_out_record(record_id):
    """删除出库记录"""
    # 仿照 delete_in_record
```

### app.py 加三个 API

- `GET /api/out?category=plush|costume` — `@login_required`,所有角色可看
- `POST /api/out` — `@role_required('admin', 'operator')`
- `DELETE /api/out/<int:record_id>` — `@role_required('admin')`

### 字段校验规则(必须严格按这个写)

```python
# 1. 必填:date, billNo, sku, style, flag, qty
# 2. 可选:po, picker, name
# 3. category 默认 'plush',只能是 'plush' 或 'costume'
# 4. 如果是毛绒,style 必须是 'normal' 或 'rare'
# 5. 如果是戏服,style 是自由文本(非空即可)
# 6. qty 必须是正整数
```

### 测试

完成后跑 `test_logic.py`,然后手动测试:

```bash
# 启动服务
python app.py

# 浏览器打开 http://localhost:5000
# 用 admin/123456 登录
# 进入"出库流水",尝试录入一笔
# 切换"戏服"品类,再录一笔(注意 style 字段是自由文本)
```

**新增测试用例**(可选但推荐):在 `test_logic.py` 加测试,验证:
- 出库 API 能正常插入毛绒和戏服记录
- 出库后库存数量正确减少
- 删除出库记录后库存恢复

---

## 优先级 2:布标 API

### database.py

```python
def query_all_flags():
    """返回布标名称数组(按 sort_order 排序)"""
    # SELECT name FROM flags ORDER BY sort_order, id

def add_flag(name):
    """新增布标,sort_order 自动取当前最大值+1"""
    # 先 SELECT MAX(sort_order),再 INSERT

def delete_flag(name):
    """按名称删除布标"""
    # DELETE FROM flags WHERE name = ?
```

### app.py

- `GET /api/flags` — 任何角色,返回 `["中国","美国",...]`
- `POST /api/flags` — admin,body: `{"name": "荷兰"}`
- `DELETE /api/flags/<name>` — admin

**注意**:URL 中的 name 是中文,要 url-decode。Flask 默认会处理。

---

## 优先级 3:用户管理 API

### database.py

```python
def query_all_users():
    """返回所有用户(不含 password_hash)"""

def insert_user(username, password_hash, role, display_name):
    """新增用户"""

def delete_user(user_id):
    """删除用户"""

def update_user_password(user_id, new_password_hash):
    """更新密码"""
```

### app.py

- `GET /api/users` — admin
- `POST /api/users` — admin,body: `{"username","password","role","display_name"}`
- `DELETE /api/users/<int:user_id>` — admin,**不能删自己**
- `PUT /api/users/<int:user_id>/password`:
  - admin 可以改任何人,可以不带 old_password
  - 非 admin 只能改自己 + 必须验证 old_password

### 校验

- username 非空,4-20 字符
- password 至少 4 位
- role ∈ ('admin', 'operator', 'viewer')

---

## 优先级 4:导出 CSV API(可选)

前端目前已经有 JS 版本的 CSV 导出,所以这个优先级低。但后端导出有优势:可以按权限和时间范围控制。

如果做,实现:
- `GET /api/export/in?category=plush&from=2026-01-01&to=2026-12-31` — 返回 CSV
- `GET /api/export/out?category=plush&from=...&to=...`
- `GET /api/export/stock?category=plush` — 库存总览

**重要**:CSV 第一字节必须是 BOM(`\ufeff`),不然 Excel 打开会乱码。

---

## 优先级 5:数据备份脚本

创建 `backup.py`:

```python
"""
数据备份脚本
功能:复制 data/inventory.db 到 backup/inventory_YYYYMMDD_HHMMSS.db
保留最近 30 天的备份,自动删除老的

用法:
  python backup.py          # 手动备份
  设 cron / 任务计划        # 自动每天凌晨 2 点跑
"""
import shutil
import os
from datetime import datetime, timedelta

BACKUP_DIR = 'backup'
DB_PATH = 'data/inventory.db'

# 1. 创建备份
timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
target = f'{BACKUP_DIR}/inventory_{timestamp}.db'
os.makedirs(BACKUP_DIR, exist_ok=True)
shutil.copy2(DB_PATH, target)
print(f'✓ 已备份到 {target}')

# 2. 删除 30 天前的备份
cutoff = datetime.now() - timedelta(days=30)
# ... 遍历 backup/ 目录,删除创建时间早于 cutoff 的文件
```

---

## 优先级 6:生产部署优化

`app.py` 当前用 Flask 开发服务器,生产环境应该用 waitress(已经在 requirements.txt):

创建 `serve.py`:
```python
from waitress import serve
from app import app
print('生产服务器启动: http://0.0.0.0:5000')
serve(app, host='0.0.0.0', port=5000, threads=8)
```

更新 `start.bat` 和 `start.sh` 用 `python serve.py`。

---

## 优先级 7:前端权限 UI 优化

当前前端通过 `document.body.dataset.role` 知道角色,但还没根据角色隐藏 UI。

在 app.html 的 `<style>` 里加:

```css
/* 游客隐藏所有"录入"和"删除"按钮 */
body[data-role="viewer"] .btn-in,
body[data-role="viewer"] .btn-out,
body[data-role="viewer"] .btn-danger {
  display: none;
}

/* 仓管员看得到录入,看不到删除 */
body[data-role="operator"] .btn-danger {
  display: none;
}

/* 仅 admin 能看用户管理入口 */
body:not([data-role="admin"]) .admin-only {
  display: none;
}
```

把"布标维护"导航项加 `admin-only` class。

---

## 优先级 8:用户管理页面

加一个 `users` 页面到导航(admin-only),展示用户列表 + 新增 + 改密码 + 删除。

参考布标维护页面的写法。

---

## 优先级 9:细节优化(锦上添花)

- **库存预警阈值可配置**:当前硬编码 `SAFE_STOCK = 100`,可以做成数据库配置
- **PO 号下拉联想**:出库时,基于历史 PO 号联想
- **统计图表**:近 30 天出入库趋势,毛绒 vs 戏服占比饼图
- **打印细表**:加一个"打印此页"按钮(window.print())
- **快捷搜索**:Ctrl+K 全局搜索货号

---

## 不要做的事

❌ 不要存"库存数量"字段,库存永远实时计算
❌ 不要加 BOM / 配比 / 多仓联动逻辑
❌ 不要自动生成单号(用户明确要求手动填)
❌ 不要引入 React/Vue/jQuery 等前端框架
❌ 不要把 SQLite 换成 MySQL/PostgreSQL
❌ 不要做软删除,直接物理删除
❌ 不要把毛绒和戏服分成两套表
❌ 不要破坏 test_logic.py 现有测试用例

---

## 完成标准

每个任务完成的标志:

1. ✅ `python test_logic.py` 全部通过
2. ✅ `python app.py` 能启动,无报错
3. ✅ 浏览器手动测试功能正常
4. ✅ 代码风格和现有代码一致
5. ✅ 中文注释清晰

如果加了新功能,推荐**主动给 test_logic.py 加测试用例**(参考现有写法)。
