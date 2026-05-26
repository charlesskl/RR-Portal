# 模具手办采购订单系统 — 手办厂 / 模厂 / 客户 管理界面

**日期**: 2026-05-26
**App**: `figure-mold-cost-system`（路径 [apps/工程部/模具手办采购订单系统/](../../../apps/工程部/模具手办采购订单系统/)）
**作者**: 胡帆 + Claude
**状态**: Design

## 背景

`figure-mold-cost-system` 用三张 SQLite 表存基础数据：

- `figure_factories(name)` — 手办厂名单
- `mold_factories(name)` — 模厂名单
- `customers(name)` — 客户名单

订单表 `figure_orders.figure_factory` / `mold_orders.mold_factory` / `*.customer` 都是 **TEXT 字段（非外键）**，存的是名字字符串。

当前问题：

1. **下拉选项不对**：云端 `figure_factories` 表里塞的是「东莞兴信手办厂」（错误数据，应当是 力图/海洋/广祥/伟盟）；`mold_factories` 表里塞的是「兴信/华登」之类车间名（应当是 力众/亚细亚/龙之联/亿隆泰/范仕达）。
2. **没有维护入口**：app 只提供只读的 `GET /api/factories` 一个 endpoint，没有任何前端 UI 能改这三张表，新增/改名/删除都要 SSH 进容器手敲 SQL。
3. **附带 bug**：API 响应缺 `Cache-Control` header，导致浏览器对 `GET /api/figure-orders` 做启发式缓存，新建/删除订单后页面要等较长时间才刷新。

## 目标

- **Step 0（运维）**: 立即修云端 `figure_factories` 和 `mold_factories` 表的数据。
- **Step 1（功能）**: 给手办厂、模厂、客户三张表加完整 CRUD 管理 UI，从下拉旁的齿轮按钮进入。改名级联同步订单表；删除有引用时给出二次确认 + 强删选项。
- **Step 2（附带 bugfix）**: 给所有 `/api/*` 响应加 `Cache-Control: no-store`，根治 CRUD 操作后页面延迟刷新的问题。

## 非目标

- 不引入新的权限模型——沿用现有"loose auth"（任何登录用户都能操作）。
- 不重构 `figure_factory` / `mold_factory` / `customer` 字段为外键引用——保持现状（TEXT 字符串 + 级联 update）。
- 不动现有 `GET /api/factories`——保留向后兼容。
- 不引入自动化测试——这个 app 一直靠手测，本次保持。

---

## §1 架构概览

**改动文件清单（共 4 个）**

| 文件 | 改动 |
|---|---|
| [db.js](../../../apps/工程部/模具手办采购订单系统/db.js) | +9 个 CRUD 函数：`add` / `rename` / `delete` × 3 个表。`rename` 和 `delete` 内部用 `db.transaction(...)` 保证 factories 表和 orders 表同步 |
| [server.js](../../../apps/工程部/模具手办采购订单系统/server.js) | +12 个 endpoint（每张表 GET/POST/PUT/DELETE 各一）+ 1 行 `Cache-Control: no-store` 中间件 |
| [public/figure.html](../../../apps/工程部/模具手办采购订单系统/public/figure.html) | 手办厂下拉、客户下拉各加 ⚙ 按钮；+1 个共享管理 modal；+1 个 JS 函数 `openListManager(type)` |
| [public/mold.html](../../../apps/工程部/模具手办采购订单系统/public/mold.html) | 模厂下拉、客户下拉各加 ⚙ 按钮；同样的 modal + JS 函数 |

**数据流**

```
[用户点 ⚙] → openListManager('figure-factory')
            ↓
        GET /api/figure-factories?with_count=1  (新)
            ↓
        渲染 modal 列表（含每个厂被引用次数）
            ↓
[用户加 / 改名 / 删除]
            ↓
        POST/PUT/DELETE /api/figure-factories
            ↓
        后端事务：改 factories 表 + 级联 UPDATE figure_orders
            ↓
        关 modal，主页面 loadOrders() + loadFactories()
```

**关键设计点**

- 改名和强删都走 `db.transaction(...)`，保证 factories 表与 orders 表同步成功或同步回滚
- 三个列表共用同一份 modal HTML（用 `data-type` 区分），共用 `openListManager(type)` JS 函数
- 现有 `GET /api/factories` 不动
- 新增 `GET /api/figure-factories` / `/api/mold-factories` / `/api/customers` 各自的明细接口，支持 `?with_count=1` 返回每个名字被多少订单引用

---

## §2 API 端点

新增 12 个 endpoint，对称设计（每张表 GET/POST/PUT/DELETE 各一份）：

### 手办厂

| 方法 | 路径 | 行为 |
|---|---|---|
| `GET` | `/api/figure-factories?with_count=1` | 返回 `[{name, ref_count}]`；不带 `with_count` 时只返回 `[{name}]` |
| `POST` | `/api/figure-factories` | body `{name}` → 加一条；trim 后空字符串返回 400；name 已存在返回 409 |
| `PUT` | `/api/figure-factories/:oldName` | body `{name}` → 改名 + 级联 UPDATE `figure_orders.figure_factory`；新名重复返回 409；新旧同名直接返回 200 |
| `DELETE` | `/api/figure-factories/:name` | 默认：若有订单引用返回 409 `{ref_count, error}`；`?force=1` 强删，同时把那些订单的 `figure_factory` 字段清空 |

### 模厂 / 客户

`/api/mold-factories/*` 和 `/api/customers/*` 同形态，只是表名和级联字段不同：

| 表 | 级联字段 |
|---|---|
| `figure_factories` | `figure_orders.figure_factory` |
| `mold_factories` | `mold_orders.mold_factory` |
| `customers` | `figure_orders.customer` + `mold_orders.customer`（**两张表都要级联**） |

**事务示例**（db.js 内）：

```js
renameFigureFactory: db.transaction((oldName, newName) => {
  const exists = db.prepare('SELECT 1 FROM figure_factories WHERE name = ?').get(newName);
  if (exists && oldName !== newName) throw new Error('CONFLICT');
  db.prepare('UPDATE figure_factories SET name = ? WHERE name = ?').run(newName, oldName);
  db.prepare('UPDATE figure_orders SET figure_factory = ? WHERE figure_factory = ?').run(newName, oldName);
}),

deleteFigureFactory: db.transaction((name, force) => {
  const refCount = db.prepare('SELECT COUNT(*) c FROM figure_orders WHERE figure_factory = ?').get(name).c;
  if (refCount > 0 && !force) throw Object.assign(new Error('IN_USE'), { ref_count: refCount });
  if (force) db.prepare('UPDATE figure_orders SET figure_factory = ? WHERE figure_factory = ?').run('', name);
  db.prepare('DELETE FROM figure_factories WHERE name = ?').run(name);
}),
```

---

## §3 前端 UI

### 入口（齿轮按钮）

把现有 `<select>` 包进 `input-group`，右侧加齿轮：

```html
<div class="input-group">
  <select class="form-select" id="m-figure_factory"><option value="">请选择</option></select>
  <button class="btn btn-outline-secondary" type="button"
          onclick="openListManager('figure-factory')" title="管理手办厂">
    <i class="bi bi-gear"></i>
  </button>
</div>
```

**位置**：

- [figure.html](../../../apps/工程部/模具手办采购订单系统/public/figure.html) — 手办厂下拉 + 客户下拉
- [mold.html](../../../apps/工程部/模具手办采购订单系统/public/mold.html) — 模厂下拉 + 客户下拉

### 共享 Modal

每个页面在底部加一份相同的 modal HTML（一份就够，三种类型动态填）：

```
┌──────────────────────────────┐
│ 管理手办厂                ✕  │
├──────────────────────────────┤
│ [______新名称_______] [+ 添加]│
│                              │
│ ┌────────────────────────┐  │
│ │ 力图        (12 引用)  │  │
│ │   [改名] [删除]        │  │
│ ├────────────────────────┤  │
│ │ 海洋        (0 引用)   │  │
│ │   [改名] [删除]        │  │
│ └────────────────────────┘  │
└──────────────────────────────┘
```

**行为**：

- 点 **添加**：trim + 校验非空 → POST → 列表重新加载
- 点 **改名**：行内变 `<input>` + 确认/取消 → PUT → 列表重新加载
- 点 **删除**：
  - 无引用 → 二次 `confirm('确定删除？')` → DELETE
  - 有引用 → 弹"已有 X 条订单引用，确定要把这些订单的厂名清空并删除吗？" → DELETE `?force=1`
- modal 关闭时 → 主页面执行 `loadFactories()` + `loadOrders()` 刷新

### `openListManager(type)` 函数

```js
const LIST_MGR_CONFIG = {
  'figure-factory': { title: '管理手办厂', api: 'api/figure-factories' },
  'mold-factory':   { title: '管理模厂',   api: 'api/mold-factories'   },
  'customer':       { title: '管理客户',   api: 'api/customers'        }
};

function openListManager(type) {
  const cfg = LIST_MGR_CONFIG[type];
  // 1. 设置 modal 标题、当前 type
  // 2. fetch cfg.api + '?with_count=1' → 渲染列表
  // 3. 显示 modal
}
```

绑定到全局，两个页面共用。每个页面引用 `utils.js` 时新增包含 `list-manager.js` —— **不抽公共文件，直接在两个 html 里各贴一份**（按方案 A 决议）。

---

## §4 立即生效：云端数据修复

管理 UI 编码+部署要时间，但下拉选项要今天就对。分两步：

### Step 0（操作，今天就做）

SSH 到 ECS，备份 + 改云端 SQLite：

```bash
ssh rr-portal

# 备份
cp '/opt/rr-portal/apps/工程部/模具手办采购订单系统/data/app.db' \
   ~/rr-backups/figure-mold-app.db.$(date +%Y%m%d-%H%M%S)

# 先看现状
sqlite3 '/opt/rr-portal/apps/工程部/模具手办采购订单系统/data/app.db' <<EOF
SELECT name FROM figure_factories ORDER BY name;
SELECT '---';
SELECT name FROM mold_factories ORDER BY name;
EOF

# 改（在用户确认现状后再执行）
sqlite3 '/opt/rr-portal/apps/工程部/模具手办采购订单系统/data/app.db' <<EOF
BEGIN;
DELETE FROM figure_factories;
INSERT INTO figure_factories(name) VALUES ('力图'),('海洋'),('广祥'),('伟盟');

DELETE FROM mold_factories;
INSERT INTO mold_factories(name) VALUES ('力众'),('亚细亚'),('龙之联'),('亿隆泰'),('范仕达');
COMMIT;
EOF
```

**注意**：不动 `figure_orders` / `mold_orders` 表里历史订单的厂名字符串。历史订单的 `figure_factory` 字段若是 "东莞兴信手办厂"，会照原样保留，前端按"未匹配的厂"显示。

**回滚**：把备份 `cp` 回去即可。

### Step 1（功能开发，后续 PR）

§1–§3 的完整管理 UI，附带 §7 的 cache-control 中间件。

---

## §5 边界 & 错误

| 场景 | 行为 |
|---|---|
| 加重名 | 后端返回 409 `{error: '名称已存在'}`；前端 toast 提示 |
| 改名后新名重复 | 同上 |
| 删除有引用 | 默认 409 `{ref_count: N, error: '...'}`；前端弹二次确认问是否 `?force=1` |
| 强删 | 事务里同时把对应 orders 的 factory/customer 字段清空（这些订单变成"未分配"组，**不删订单本身**） |
| 空名 / 纯空格 | 前端 trim，空就 disable 添加按钮；后端再 trim 校验返回 400 |
| 含特殊字符 | 后端不限制（厂名可含中文、数字、符号），仅 trim |
| 改名时新旧同名 | 返回 200 不动 |
| 并发改名 / 删除 | better-sqlite3 是同步阻塞的，事务级保证，不存在 race |

---

## §6 测试 / 验收

无自动化测试框架，上线前手动跑：

**功能**：

1. ⚙ 进入管理 modal 能加载列表 + 显示引用数
2. 添加新厂 → 关 modal → 主页下拉立即出现新选项
3. 改名 → 关 modal → 主页订单列表里旧名分组的标题变成新名
4. 删除无引用厂 → 直接删除
5. 删除有引用厂 → 弹二次确认 → 强删后那些订单归"未分配"组（订单本身还在）
6. 三种 type（手办厂、模厂、客户）都验一遍
7. 客户级联：在 figure 订单页改某客户名，去 mold 订单页验证那个客户的订单也更新了

**回归**：

8. 新建订单/编辑订单的下拉、统计页的分组、Excel 导入的厂名匹配 都还正常
9. `GET /api/factories`（老接口）仍然返回完整列表

**§7 验收**：

10. DevTools Network 看 `/api/figure-orders` 响应头有 `Cache-Control: no-store`
11. 新建一张订单 → 列表立即刷新（不再"过好久"）
12. 删除一张订单 → 列表立即刷新

---

## §7 附带 bugfix — API Cache-Control

**根因**：API 响应没有显式 `Cache-Control` header，浏览器对 `GET /api/figure-orders` 等做了启发式缓存，CRUD 后立即触发的 `loadOrders()` 收到的是 cache 而不是最新数据。

**修复**：[server.js](../../../apps/工程部/模具手办采购订单系统/server.js) 的 `/api` 中间件加一行：

```js
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');  // 新增
  if (req.path === '/login') return next();
  const payload = verifyToken(req);
  req.user = payload ? payload.name : '管理员';
  next();
});
```

**为什么用 `no-store` 不用 `no-cache`**：

- `no-cache` 允许缓存但每次必须 304 校验，仍有延迟
- `no-store` 直接禁止缓存，API 动态数据更合适

**回退方案**：如果上线后发现 CRUD 仍延迟刷新，说明 bug 不在缓存。继续调时检查：

- saveOrder/deleteOrder 的 `.then()` 链是否走完
- Network 面板看 POST 后是否真发出 GET
- GET 响应 body 是否包含最新记录

---

## 实现顺序

1. **Step 0（立即）**：SSH 改云端 DB（先备份 + 看现状 + 用户确认 + 改 + 验证）
2. **Step 1 + 2 一起做**：开新分支 `feat/factory-customer-mgmt`，按此 spec 实现 §1–§3 + §7，本地手测 → safe-redeploy 上云端 → 按 §6 全量验收
