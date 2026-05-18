# 实现计划(Claude Code 必读)

> 这份文档是你的工作手册。**严格按顺序、按步骤完成每个任务。**
>
> 每个任务都有「完成标准」,不达标不能进入下一个任务。

---

## 总览:你要完成 8 个任务

```
[基础准备]
□ 任务 0:环境验证(确认能跑起来)

[核心功能]
□ 任务 1:出库 API(P1,最重要)
□ 任务 2:布标 API(P2)
□ 任务 3:用户管理 API(P3)

[前端完善]
□ 任务 4:前端权限 UI(P5)
□ 任务 5:用户管理页面(P6)

[导出 & 部署]
□ 任务 6:导出 CSV API(P4)
□ 任务 7:数据备份脚本(P7)
□ 任务 8:生产服务器配置(P8)
```

**估计总时长**:每个任务 15-40 分钟,全部完成 3-5 小时。

---

## ⚠️ 开始前的铁律(每个任务都适用)

1. **每写完一段代码,先想:这会不会破坏已有功能?** 如果不确定,跑 `python test_logic.py` 验证
2. **完成每个任务后,必须跑 `python test_logic.py`,全绿才能进入下一个任务**
3. **不要修改 `database.py` 中的 `calculate_stock()` 函数**
4. **不要修改 `test_logic.py` 中已有的测试用例**(你可以新增测试,但不能改已有的)
5. **不要为了让测试通过而修改测试**,测试失败说明你的实现有问题
6. **每个任务完成后,告诉用户「✓ 任务 X 完成」并简单说明做了什么**

---

## 📋 任务 0:环境验证

### 目标
确认你接手的项目能正常启动。

### 步骤

1. 进入项目目录
2. 运行 `pip install -r requirements.txt`
3. 运行 `python init_db.py` — 应该看到"初始化完成"
4. 运行 `python test_logic.py` — 应该看到 **29 个测试全部通过**
5. 运行 `python app.py` — 应该看到"http://localhost:5000"
6. (可选)用浏览器访问,用 admin/123456 登录,确认登录页和主页能打开

### 完成标准

- [x] `python test_logic.py` 输出 `✓ 通过 29 个 / ✗ 失败 0 个`
- [x] `python app.py` 能启动,无报错

### 出问题怎么办

- 测试失败 → **不要往下做**,先告诉用户,贴出报错信息
- 安装依赖失败 → 让用户改用 `pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple`

### 完成后说什么

> ✓ 任务 0 完成。环境验证通过,29/29 测试绿,服务能启动。准备开始任务 1。

---

## 📋 任务 1:出库 API(最重要)

### 为什么必须最先做

前端的"录入出库"、"出库流水"、"货号细表显示出库"全部依赖这个 API。

### 你要做的事

**1. 在 `database.py` 中添加 3 个函数**(仿照入库的写法):

- `query_all_out_records(category=None)` — 查询所有出库记录
- `insert_out_record(data, username)` — 新增出库记录
- `delete_out_record(record_id)` — 删除出库记录

**关键点**:出库表比入库表多 `po`(PO 号)和 `picker`(领货人)两个字段。

参考代码已经在 `REQUIREMENTS.md` 的 P1 部分给出,直接复制粘贴即可。

**2. 在 `app.py` 中添加 3 个路由**:

- `GET /api/out` — 任何登录用户,可带 `?category=plush|costume` 筛选
- `POST /api/out` — admin/operator,新增
- `DELETE /api/out/<id>` — admin,删除

参考代码同样在 `REQUIREMENTS.md` 的 P1 部分。

### 完成标准

- [x] `python test_logic.py` 全 29 个测试通过(其中很多测试都用到了出库)
- [x] 启动服务后,用 curl 或浏览器开发者工具能调通:
  - `GET /api/out` 返回出库列表
  - `POST /api/out` 能新增一条记录(后续 GET 能看到)
  - `DELETE /api/out/<id>` 能删除

### 验证脚本(任务完成后跑一遍)

```bash
# 登录(替换 cookie 文件路径)
curl -c cookies.txt -X POST http://localhost:5000/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"123456"}'

# 查询出库列表
curl -b cookies.txt http://localhost:5000/api/out

# 按品类筛选
curl -b cookies.txt "http://localhost:5000/api/out?category=costume"

# 新增一条出库
curl -b cookies.txt -X POST http://localhost:5000/api/out \
  -H "Content-Type: application/json" \
  -d '{"category":"plush","date":"2026-05-13","billNo":"OUT-TEST","sku":"HD-T001","style":"normal","flag":"美国","qty":50}'
```

### 出问题怎么办

- 测试失败 → 看错误信息,大多是字段名错了(注意:前端 camelCase → 后端 snake_case)
- POST 返回 400 → 看错误信息,通常是缺字段或字段值不对

### 完成后说什么

> ✓ 任务 1 完成。出库 API(GET/POST/DELETE)已实现,29/29 测试通过。可以前往任务 2:布标 API。

---

## 📋 任务 2:布标 API

### 你要做的事

**1. 在 `database.py` 添加 3 个函数**(参考 `REQUIREMENTS.md` P2):

- `query_all_flags()` — 返回字符串列表
- `add_flag(name)` — 新增
- `delete_flag(name)` — 删除

**2. 在 `app.py` 添加 3 个路由**:

- `GET /api/flags` — 任何登录用户,返回 `["中国","美国",...]`
- `POST /api/flags` — admin
- `DELETE /api/flags/<name>` — admin

### 完成标准

- [x] `python test_logic.py` 全 29 个测试通过
- [x] 前端"布标维护"页面能正常显示布标列表
- [x] 能在该页面新增 / 删除布标

### 验证脚本

```bash
# 查询所有布标
curl -b cookies.txt http://localhost:5000/api/flags
# 应该看到: ["中国","美国","德国",...]

# 新增布标(admin)
curl -b cookies.txt -X POST http://localhost:5000/api/flags \
  -H "Content-Type: application/json" \
  -d '{"name":"荷兰"}'

# 删除布标(admin,注意中文要 URL 编码)
curl -b cookies.txt -X DELETE "http://localhost:5000/api/flags/%E8%8D%B7%E5%85%B0"
```

### 完成后说什么

> ✓ 任务 2 完成。布标 API 已实现,29/29 测试通过。可以前往任务 3:用户管理 API。

---

## 📋 任务 3:用户管理 API

### 你要做的事

**1. 在 `database.py` 添加 5 个函数**:

- `query_all_users()` — 返回所有用户(不含 password_hash)
- `get_user_by_id(user_id)` — 按 ID 查询
- `insert_user(username, password_hash, role, display_name)`
- `delete_user(user_id)`
- `update_user_password(user_id, new_password_hash)`

参考代码在 `REQUIREMENTS.md` P3。

**2. 在 `app.py` 添加 4 个路由**:

- `GET /api/users` — admin
- `POST /api/users` — admin,新增用户
- `DELETE /api/users/<id>` — admin,**禁止删自己**
- `PUT /api/users/<id>/password` — 任何登录用户改自己 / admin 改任何人

**关键校验**:
- username 4-20 字符
- password 至少 4 位
- role ∈ ('admin', 'operator', 'viewer')
- 非 admin 改自己密码时必须验证 old_password

### 完成标准

- [x] `python test_logic.py` 全 29 个测试通过
- [x] curl 测试通过(见下方验证脚本)
- [x] 不能删除自己(返回 400)
- [x] 普通用户改密码必须验证旧密码

### 验证脚本

```bash
# 列出所有用户(admin)
curl -b cookies.txt http://localhost:5000/api/users

# 新增用户(admin)
curl -b cookies.txt -X POST http://localhost:5000/api/users \
  -H "Content-Type: application/json" \
  -d '{"username":"tester","password":"abcd","role":"operator","display_name":"测试员"}'

# 尝试删除自己(应该返回 400)
curl -b cookies.txt -X DELETE http://localhost:5000/api/users/1

# 改密码
curl -b cookies.txt -X PUT http://localhost:5000/api/users/1/password \
  -H "Content-Type: application/json" \
  -d '{"old_password":"123456","new_password":"newpass"}'
```

### 完成后说什么

> ✓ 任务 3 完成。用户管理 API 已实现,29/29 测试通过。后端 API 三大模块全部完成,准备开始前端任务。

---

## 📋 任务 4:前端权限 UI

### 你要做的事

打开 `templates/app.html`,找到 `<style>` 区域,在合适位置添加 CSS:

```css
/* 游客隐藏录入和删除按钮 */
body[data-role="viewer"] .btn-in,
body[data-role="viewer"] .btn-out,
body[data-role="viewer"] .btn-danger { display: none !important; }

/* 仓管员看不到删除 */
body[data-role="operator"] .btn-danger { display: none !important; }

/* admin-only 元素只 admin 可见 */
body:not([data-role="admin"]) .admin-only { display: none !important; }
```

然后在 HTML 里:
- 给"布标维护"导航项的 `<div class="nav-item">` 加上 `admin-only` class

### 完成标准

- [x] 用 viewer 登录,看不到任何"录入"和"删除"按钮
- [x] 用 operator 登录,能录入但看不到"删除"按钮
- [x] 用 admin 登录,所有功能正常

### 验证方法

依次用三个账号登录,检查页面:
- viewer/123456 → 全只读
- warehouse/123456 → 能录入,不能删
- admin/123456 → 全部权限

### 完成后说什么

> ✓ 任务 4 完成。前端按角色自动隐藏对应按钮,三个角色权限正确。准备开始任务 5。

---

## 📋 任务 5:用户管理页面

### 你要做的事

在 `templates/app.html` 添加一个新页面 `users`(管理员可见)。

**1. 在侧边栏导航加入口**(放在"基础数据"那一组,在"布标维护"下面):

```html
<div class="nav-item admin-only" data-page="users" onclick="navigate('users')">
  <span class="nav-icon">👤</span><span>用户管理</span>
</div>
```

**2. 在 JS 里加 `navigate('users')` 的处理**和 `renderUsers()` 函数。

参考布标维护页面(`renderFlags()`)的写法,做一个用户列表:

- 表格列:用户名 / 显示名 / 角色 / 创建时间 / 操作(改密码 / 删除)
- 上方一个"+ 新增用户"按钮 → 弹窗(用户名 / 密码 / 角色 / 显示名)
- 改密码按钮 → 弹窗(新密码)
- 删除按钮 → 确认后调 DELETE
- **不能删除自己**(前端隐藏当前用户的删除按钮)

### 完成标准

- [x] admin 登录后能看到"用户管理"导航项
- [x] 能列出所有用户
- [x] 能新增用户
- [x] 能改任意用户的密码
- [x] 能删除其他用户,但不能删自己
- [x] viewer 和 operator 登录时看不到"用户管理"入口(因为有 admin-only class)

### 完成后说什么

> ✓ 任务 5 完成。用户管理页面已实现,所有 CRUD 操作正常,自身保护生效。准备开始任务 6:导出 CSV。

---

## 📋 任务 6:导出 CSV API

### 你要做的事

在 `app.py` 添加 3 个导出路由:

- `GET /api/export/in?from=...&to=...&category=...` — 导出入库
- `GET /api/export/out?from=...&to=...&category=...` — 导出出库
- `GET /api/export/stock?category=...` — 导出当前库存

**关键技术点**:

1. CSV 文件**第一字节必须是 BOM** (`\ufeff`),否则 Excel 打开中文会乱码
2. 响应头:
   - `Content-Type: text/csv; charset=utf-8`
   - `Content-Disposition: attachment; filename=xxx.csv`(filename 要 URL 编码,因为可能含中文)

参考代码:

```python
from flask import Response
from urllib.parse import quote
import csv
import io

@app.route('/api/export/in', methods=['GET'])
@login_required
def api_export_in():
    category = request.args.get('category')
    date_from = request.args.get('from')
    date_to = request.args.get('to')

    records = db.query_all_in_records(category=category)
    if date_from:
        records = [r for r in records if r['date'] >= date_from]
    if date_to:
        records = [r for r in records if r['date'] <= date_to]

    # 生成 CSV
    output = io.StringIO()
    output.write('\ufeff')  # BOM
    writer = csv.writer(output)
    writer.writerow(['品类','日期','单号','货号','物料名称','款式','布标','数量'])
    for r in records:
        writer.writerow([
            '毛绒' if r['category']=='plush' else '戏服',
            r['date'], r['bill_no'], r['sku'], r.get('name',''),
            '普通款' if r['style']=='normal' else '稀有款' if r['style']=='rare' else r['style'],
            r['flag'], r['qty']
        ])

    filename = f'入库流水_{datetime.now().strftime("%Y%m%d")}.csv'
    return Response(
        output.getvalue(),
        mimetype='text/csv; charset=utf-8',
        headers={'Content-Disposition': f"attachment; filename*=UTF-8''{quote(filename)}"}
    )
```

### 完成标准

- [x] 访问 `/api/export/in` 能下载 CSV
- [x] Excel 打开 CSV 中文不乱码
- [x] `?category=plush` 能筛选品类
- [x] `?from=2026-05-01&to=2026-05-10` 能筛选日期

### 完成后说什么

> ✓ 任务 6 完成。后端 CSV 导出(入库/出库/库存)已实现,中文无乱码。准备开始任务 7。

---

## 📋 任务 7:数据备份脚本

### 你要做的事

在项目根目录创建 `backup.py`:

```python
"""
数据库备份脚本
使用:python backup.py
建议设置为定时任务每天凌晨 2 点跑
"""
import shutil
from datetime import datetime, timedelta
import os
import glob

BACKUP_DIR = 'backup'
KEEP_DAYS = 30
DB_PATH = 'data/inventory.db'


def backup():
    os.makedirs(BACKUP_DIR, exist_ok=True)

    if not os.path.exists(DB_PATH):
        print(f'✗ 数据库文件不存在: {DB_PATH}')
        return False

    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    dst = f'{BACKUP_DIR}/inventory_{timestamp}.db'
    shutil.copy2(DB_PATH, dst)
    size_kb = os.path.getsize(dst) / 1024
    print(f'✓ 备份完成: {dst} ({size_kb:.1f} KB)')

    # 删除 30 天前的备份
    cutoff = datetime.now() - timedelta(days=KEEP_DAYS)
    cleaned = 0
    for f in glob.glob(f'{BACKUP_DIR}/inventory_*.db'):
        if datetime.fromtimestamp(os.path.getmtime(f)) < cutoff:
            os.remove(f)
            cleaned += 1
    if cleaned:
        print(f'✓ 清理了 {cleaned} 个 {KEEP_DAYS} 天前的旧备份')

    return True


if __name__ == '__main__':
    backup()
```

### 完成标准

- [x] `python backup.py` 能成功备份
- [x] `backup/` 目录会出现一个 `inventory_YYYYMMDD_HHMMSS.db` 文件

### 完成后说什么

> ✓ 任务 7 完成。备份脚本已就位,可手动 `python backup.py` 或设置定时任务。准备开始最后一个任务。

---

## 📋 任务 8:生产服务器(waitress)

### 你要做的事

**1. 创建 `serve.py`**:

```python
"""
生产服务器(waitress)
比 Flask 自带的开发服务器更稳定,适合多人并发访问
"""
from waitress import serve
from app import app

if __name__ == '__main__':
    print('=' * 50)
    print('华登库存管理系统 - 生产服务器')
    print('=' * 50)
    print()
    print('访问地址:')
    print('  本机:        http://localhost:5000')
    print('  局域网其他人: http://<本机IP>:5000')
    print()
    print('按 Ctrl+C 停止服务')
    print('=' * 50)

    serve(app, host='0.0.0.0', port=5000, threads=8)
```

**2. 更新 `start.bat`**:把 `python app.py` 改为 `python serve.py`

**3. 更新 `start.sh`**:同上

### 完成标准

- [x] `python serve.py` 能正常启动
- [x] 浏览器访问能正常使用
- [x] 双击 `start.bat` 启动正常

### 完成后说什么

> ✓ 任务 8 完成。生产服务器已配置,启动脚本已更新。
>
> 🎉 全部 8 个任务完成!整个系统已经可以投入使用。
>
> **建议用户接下来做的事**:
> 1. 用 admin 登录,在用户管理里修改默认密码
> 2. 把项目部署到公司专用电脑
> 3. 设置 Windows 任务计划每天自动跑 `python backup.py`
> 4. 开放防火墙 5000 端口,让局域网其他电脑能访问

---

## 🛡 整个过程要遵守的原则

### ✅ 该做的

- 每个任务完成后跑 `python test_logic.py`,**全 29 个测试通过才能算完成**
- 保持代码风格和已有代码一致(中文注释、简单清晰)
- 遇到不确定的设计,**先问用户,不要擅自决定**
- 每个任务完成后给用户一个简短的总结

### ❌ 绝对不做的

- 不要修改 `calculate_stock()` 函数
- 不要修改 `test_logic.py` 已有的测试
- 不要在数据库添加 "库存数量" 字段(永远是计算出来的)
- 不要引入新的 Python 库(只用 Flask + SQLite + waitress)
- 不要引入前端框架(React/Vue 等)
- 不要做单号自动生成(用户要求手动填)
- 不要加 BOM / 配比 / 多仓联动这些复杂业务概念

---

## 🐛 出问题怎么办

| 现象 | 排查方向 |
|---|---|
| 测试失败 | 看测试报错信息,**绝大多数是字段名错了**(camelCase vs snake_case) |
| API 返回 500 | 看后端 console 错误堆栈,通常是 SQL 语法或字段名问题 |
| API 返回 401 | 没登录,先 POST `/api/login` |
| API 返回 403 | 权限不够,换 admin 账号 |
| 前端调用 API 失败 | 看浏览器开发者工具 Network,查看返回内容 |
| 中文乱码 | CSV 要加 BOM,数据库要 UTF-8 |

**遇到任何无法解决的问题,立即停下来问用户,不要瞎改。**

---

## 📞 沟通规范

每个任务完成后,用类似格式向用户汇报:

```
✓ 任务 X 完成

做了什么:
- 在 database.py 添加 3 个函数(query_all_out_records / insert_out_record / delete_out_record)
- 在 app.py 添加 3 个路由(GET/POST/DELETE /api/out)

验证结果:
- python test_logic.py:✓ 29/29 通过
- curl 测试:✓ 通过

下一步:任务 Y(布标 API)
```

如果遇到问题:

```
⚠ 任务 X 遇到问题

现象:[具体描述]
我尝试了:[已经尝试的方案]
请问:[需要用户决定的事]
```

---

## 🏁 全部完成的标志

当 8 个任务都打 ✓ 后,系统就完整了。这时候应该:

1. 跑完整测试 `python test_logic.py`,29/29 通过
2. 启动服务 `python serve.py`,能正常访问
3. 用三个角色(admin/operator/viewer)分别登录测试,功能符合权限
4. 录入几条数据,看库存计算正确
5. 删除一条记录,看库存自动重算
6. 导出 CSV,Excel 打开正常
7. 跑一次备份 `python backup.py`,文件正确生成

全部通过后,告诉用户:

> 🎉 系统已经完整可用,可以部署到生产环境了!
