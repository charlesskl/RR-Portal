# 华登包材管理 — 板块登录权限设计

**日期:** 2026-04-22
**涉及应用:** `apps/PMC跟仓管/华登包材管理/` (Flask, 单文件 `app.py`)
**状态:** 待实现

## 目标

为 `app.py` 中 `SECTIONS` 字典定义的 3 个板块各加一道独立登录门。每个板块一个密码,3 个密码互不相通;登录状态以 Flask session 维持,板块之间互相独立(登录 section 1 不会自动授权 section 2 或 3)。

3 个板块:

| sec | 名称 | channels |
|---|---|---|
| 1 | 华登和邵阳华登包材往来 | 1, 2 |
| 2 | 兴信和华登包材往来 | 3, 4 |
| 3 | 邵阳华登和兴信包材往来 | 5, 6 |

## 非目标 (Non-goals)

- **不引入用户/账号系统** —— 3 个板块各有一个共享密码,不区分谁在操作
- **不接入 RR-Portal 核心 JWT 认证** —— huadeng 是独立 Flask 应用,保持自治
- **不保护跨板块的汇总视图** —— `/reports`、`/export/reports`、`/export/triangle*`、`/api/prices`、首页 `/` 保持公开,任何人可以看汇总数据
- **不加数据库 schema 改动** —— 不建 users 表、不建登录日志表
- **不引入新的 Python 依赖** —— 只用 Flask 自带的 session cookie

## 架构

```
浏览器
  │
  │  GET /section/1
  ▼
Flask app.py
  │  @require_section 装饰器检查 session['unlocked_sections']
  │
  ├─ 已解锁 sec 1  → 正常返回 section 页面
  └─ 未解锁       → 302 → /section/1/login
                     ↓
                     用户输入密码 POST
                     ↓
                     比对 SECTION_PASSWORDS[1] (来自环境变量)
                       ├─ 错:flash 错误 + 跳回 login
                       └─ 对:session['unlocked_sections'] ← [..., 1]
                             302 → /section/1
```

**session 机制:** Flask 默认的 signed cookie session,`secret_key` 从环境变量读。session 有效期 8 小时(`app.permanent_session_lifetime = timedelta(hours=8)`),登录时设 `session.permanent = True`。

**关键数据结构:** `session['unlocked_sections']` 是 `list[int]`,保存当前浏览器会话已解锁的 section id。登录时 append,登出时 remove,8 小时后整个 session 过期全部清空。

## 组件

### 新增代码(`app.py`)

`app.py` 顶部现有 import 为 `from flask import Flask, render_template, request, redirect, url_for, jsonify, send_file` —— 追加 `session, flash, abort` 三项。再加:

```python
import os
from datetime import timedelta
from functools import wraps

app.secret_key = os.environ.get('HUADENG_SECRET_KEY', 'dev-change-me-in-prod')
app.permanent_session_lifetime = timedelta(hours=8)

SECTION_PASSWORDS = {
    1: os.environ.get('HUADENG_SEC1_PASSWORD', ''),
    2: os.environ.get('HUADENG_SEC2_PASSWORD', ''),
    3: os.environ.get('HUADENG_SEC3_PASSWORD', ''),
}


def channel_to_section(ch: int) -> int | None:
    for sec_id, sec_info in SECTIONS.items():
        if ch in sec_info['channels']:
            return sec_id
    return None


def require_section(get_sec):
    """get_sec: 接收 kwargs,返回 section id。"""
    def deco(f):
        @wraps(f)
        def wrapped(*args, **kwargs):
            sec = get_sec(kwargs)
            if sec is None:
                abort(404)
            unlocked = session.get('unlocked_sections', [])
            if sec not in unlocked:
                return redirect(url_for('section_login', sec=sec))
            return f(*args, **kwargs)
        return wrapped
    return deco
```

### 新增路由

| 路由 | 方法 | 用途 |
|---|---|---|
| `/section/<int:sec>/login` | GET | 渲染登录页 |
| `/section/<int:sec>/login` | POST | 验证密码,成功后解锁该 section |
| `/section/<int:sec>/logout` | GET | 从 session 移除该 section(不影响其他) |

### 需要加装饰器的现有路由

从 `app.py` 中 grep 到的需保护路由,共 **11 个**:

| 路由 | section 推导方式 |
|---|---|
| `GET  /section/<sec>` | 直接用 URL 里的 sec |
| `POST /channel/<ch>/add` | `channel_to_section(ch)` |
| `POST /channel/<ch>/edit/<record_id>` | 同上 |
| `POST /channel/<ch>/delete/<record_id>` | 同上 |
| `POST /channel/<ch>/inventory` | 同上 |
| `POST /channel/<ch>/add-investment` | 同上 |
| `POST /channel/<ch>/delete-investment/<inv_id>` | 同上 |
| `POST /channel/<ch>/month/<year_month>/delete` | 同上 |
| `POST /channel/<ch>/month/<year_month>/update` | 同上 |
| `GET  /export/channel/<ch>` | 同上 |
| `GET  /export/monthly/<ch>` | 同上 |

### 保持公开(不加装饰器)

- `/` (首页,展示 3 个板块入口)
- `/reports`、`/export/reports`
- `/export/triangle-qty`、`/export/triangle-display`、`/export/triangle`
- `/api/prices`
- `/health`

### 新增模板

**`templates/section_login.html`** (~30 行)

- 继承 `base.html`,保持整体样式
- 居中卡片:标题显示 `登录:{{ section.name }}`,密码输入框,提交按钮
- 顶部显示 flash 的错误消息
- 底部"返回首页"链接

### 修改模板

**`templates/section.html`** —— 右上角加"退出该板块"链接,指向 `/section/<sec>/logout`。+2 行。

## 数据流

**登录成功路径:**

1. `GET /section/1/login` → 渲染 section_login.html
2. 用户提交 `POST /section/1/login` 带 password
3. 后端:
   - 若 `SECTION_PASSWORDS[1] == ''` 或不匹配输入 → `flash("密码错误")`、`redirect(url_for('section_login', sec=1))`
   - 若匹配 → `session.permanent = True`;`unlocked = session.get('unlocked_sections', [])`;`if 1 not in unlocked: unlocked.append(1)`;`session['unlocked_sections'] = unlocked`;`session.modified = True`;`redirect(url_for('section', sec=1))`

**登出路径:**

1. `GET /section/1/logout`
2. 后端从 `session['unlocked_sections']` 移除 1(其他 section 保留)
3. 重定向首页

**session 过期:** 超过 8 小时自动失效。用户下次访问受保护路由会被装饰器重新跳登录页。

## 错误处理

| 情况 | 处理 |
|---|---|
| 密码不匹配 | flash "密码错误",重新渲染 login 页;**不区分**"密码长度不够"或"密码为空"等细节,防枚举 |
| 环境变量未配置(密码为空字符串) | 登录接口直接拒绝所有输入(空密码也不能通过);启动时在日志 WARN `section N password not configured` |
| URL 里的 sec 不在 {1,2,3} | `abort(404)`,与现有 `/section/<sec>` 行为一致 |
| 用户篡改 session cookie | Flask signed cookie 会校验失败,session 被丢弃,相当于未登录 |
| `channel_to_section(ch)` 返回 None(未知 channel) | `abort(404)` |

## 配置

### 环境变量(新增 4 个)

| 变量 | 用途 |
|---|---|
| `HUADENG_SECRET_KEY` | Flask session cookie 的签名密钥。部署时必须设,长随机串 |
| `HUADENG_SEC1_PASSWORD` | Section 1 (华登和邵阳华登) 密码 |
| `HUADENG_SEC2_PASSWORD` | Section 2 (兴信和华登) 密码 |
| `HUADENG_SEC3_PASSWORD` | Section 3 (邵阳华登和兴信) 密码 |

`.env.example` 增加这 4 行示例(**值留空,提示用户填真实值**)。

### docker-compose

根目录 `docker-compose.yml` 的 `huadeng` service 确认已通过 `env_file` 或 environment 把这 4 个变量传进容器。如果已有 env_file 指向 `.env.example` 相邻的真实 `.env`,只需在部署机器上填密码即可。

## 测试策略

**手工测试 checklist**(项目现状是没有自动化测试,本次也不引入):

1. 本地启动前,设好 3 个密码环境变量(比如 `sec1pwd` / `sec2pwd` / `sec3pwd`)和一个 `HUADENG_SECRET_KEY`
2. `curl -i http://127.0.0.1:7000/section/1` → 应返回 302,Location 指向 `/section/1/login`
3. 浏览器打开 `/section/1/login`,输错密码 → 看到"密码错误"提示,仍在 login 页
4. 输对密码 → 跳到 `/section/1`,能看内容,能录入一条记录,能导出 Excel
5. 同一浏览器打开 `/section/2` → 再次 302 到 `/section/2/login`(**独立性验证**)
6. `/reports` 直接能打开,`/` 首页直接能打开(公开路由)
7. 点"退出该板块"(section 1 上) → 回到首页,再访问 `/section/1` 要重登;访问 `/section/2`(若已登)仍可直接进
8. 临时把 `permanent_session_lifetime` 改成 `seconds=10`,验证过期后被踢出
9. 回归现有功能:录入、编辑、删除、月统计、月更新、三角债查询、报表 —— 全跑一遍确认装饰器没误伤

**边界 case:**

- 未配置 `HUADENG_SEC1_PASSWORD`(空字符串):任何输入都不能登入 section 1,日志有 WARN
- 直接 POST `/channel/1/add`(跳过 UI):装饰器同样拦截,302 到 login

## 改动文件清单

| 文件 | 改动 | 估计行数 |
|---|---|---|
| `apps/PMC跟仓管/华登包材管理/app.py` | 新增配置/装饰器/helper/3 个新路由,给 11 个现有路由加装饰器 | +60 ~ +80 |
| `apps/PMC跟仓管/华登包材管理/templates/section_login.html` | **新建** | ~30 |
| `apps/PMC跟仓管/华登包材管理/templates/section.html` | 右上角加"退出该板块" | +2 |
| `apps/PMC跟仓管/华登包材管理/.env.example` | 新增 4 个变量 | +4 |
| `apps/PMC跟仓管/华登包材管理/README.md` | 说明 3 个密码的配置方式 | +10 |
| `docker-compose.yml` (根目录) | 确认 huadeng service 的 env_file/environment 含新变量 | 视现状,0~4 行 |

**不改动:**

- 数据库 schema(`init_db` 不动)
- `read_excel.py` / `Dockerfile` / `requirements.txt`
- 核心 RR-Portal 代码、plugin_sdk、core/auth/*

## 风险与权衡

- **单一共享密码 → 无审计**:查不出哪条记录是谁改的。用户明确选了方案 A,接受此权衡
- **密码明文存环境变量**:运维可见。用户选 B 方案(环境变量),接受此权衡;如需更强,可未来改 C(DB + bcrypt)
- **session cookie 被抓包可复用**:内网部署 + 未强制 HTTPS 场景下理论存在。部署环境是 nginx 反代后的内网工具,接受此权衡
- **8 小时太短或太长**:本版硬编码 8 小时。若用户反馈需要调整,后续可增加 `HUADENG_SESSION_HOURS` 环境变量,本版不做
