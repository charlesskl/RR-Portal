# 华登塑胶 · 库存管理系统(毛绒 + 戏服)

> 给 Claude Code:请按这个顺序阅读
> 1. **`IMPLEMENTATION_PLAN.md`** ⭐ — 你的工作手册,有 8 个明确任务和验证标准,按它走
> 2. 本文档(README.md)— 全局认知
> 3. REQUIREMENTS.md — 每个任务的代码参考
> 4. API_DESIGN.md — 接口约定
> 5. 先跑一次 `python test_logic.py` 确认基础环境无误,再开始改

## 项目背景

东莞华登塑胶制品有限公司(清溪镇)的库存管理系统,管理两类产品:

- **毛绒玩具**(主要业务):接收毛绒厂送来的成品玩具,按订单出货
- **戏服**(配套产品):跟毛绒配套的衣服(连衣裙、T恤、外套等),按尺码 / 类型管理

**核心痛点**:之前用 Excel 管理,容易出错、对账难、多人协作冲突。

**最终用户**:5 人以内,角色分主管 / 仓管员 / 游客。

## 技术栈

- **后端**:Python 3.10+ / Flask 3.0
- **数据库**:SQLite(单文件,零配置)
- **前端**:原生 HTML + JavaScript(无框架)
- **部署**:公司局域网内一台专用电脑,内网 IP 访问

**技术选型理由**:**简单可维护**。这是给一个小厂用的内部工具,过度工程是大忌。

## 数据模型(必须严格遵守)

### 双品类设计

出入库流水共用一套表,通过 `category` 字段区分品类:

| category 值 | 含义 | 货号示例 | 款式/类型字段 | 布标字段 |
|---|---|---|---|---|
| `plush` | 毛绒 | HD-T001、HD-T002... | 只能是 `normal`(普通款) 或 `rare`(稀有款) | **必填**(按国家命名) |
| `costume` | 戏服 | CS-001、CS-002... | 自由文本,如 "M码连衣裙"、"L码外套" | **没有此字段**(后端存空字符串 `''`,前端隐藏) |

**⚠ 重要规则**:
- 录入戏服时,前端不显示布标字段,后端自动把 `flag` 设为 `''`
- 戏服的库存维度是「品类 + 货号 + 类型」(三级);毛绒是「品类 + 货号 + 款式 + 布标」(四级)
- 数据库 schema 上 `flag` 字段对两类都保留(`NOT NULL DEFAULT ''`),只是戏服永远存空字符串

### 四级唯一性

**一个库存单元由四个维度唯一确定**:

```
category + sku + style + flag
```

例如:
- 毛绒 / HD-T001 / 普通款 / 美国 → 库存 X
- 毛绒 / HD-T001 / 普通款 / 德国 → 库存 Y(独立)
- 毛绒 / HD-T001 / 稀有款 / 日本 → 库存 Z(独立)
- 戏服 / CS-001 / M码连衣裙 / 美国 → 库存 W(完全独立)

### 库存计算公式(必须严格按这个实现)

```
库存数量 = SUM(入库.qty) - SUM(出库.qty)
WHERE category=? AND sku=? AND style=? AND flag=?
```

**注意**:库存数量不单独存字段,每次查询时从流水实时计算!这样不会出现"库存数据"和"流水数据"对不上的问题。

## 字段定义(客户已确认,不要随便改)

### 入库表 in_records

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| id | INTEGER | 自动 | 主键自增 |
| category | TEXT | 是 | 'plush' 或 'costume',默认 plush |
| date | TEXT | 是 | 'YYYY-MM-DD' |
| bill_no | TEXT | 是 | 单号(手动填) |
| sku | TEXT | 是 | 货号 |
| name | TEXT | 否 | 物料名称 |
| style | TEXT | 是 | 毛绒:normal/rare;戏服:自由文本 |
| flag | TEXT | 是 | 布标(国家) |
| qty | INTEGER | 是 | 数量,必须 > 0 |
| created_by | TEXT | 自动 | 创建人 |
| created_at | TEXT | 自动 | 创建时间 |

### 出库表 out_records

入库表所有字段 + 以下两个:

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| po | TEXT | 否 | PO 号(手动填,可空) |
| picker | TEXT | 否 | 领货人(可空) |

## 三种角色权限

| 角色 | 英文标识 | 权限范围 |
|---|---|---|
| 主管 | `admin` | 所有功能 + 用户管理 + 布标管理 + 删除记录 |
| 仓管员 | `operator` | 录入出入库 + 查看所有数据 + 导出 |
| 游客 | `viewer` | 只读所有数据 + 导出 |

**默认账号**(`init_db.py` 自动创建,首次启动后必须改密码):

| 用户名 | 密码 | 角色 |
|---|---|---|
| admin | 123456 | 主管 |
| warehouse | 123456 | 仓管员 |
| viewer | 123456 | 游客 |

## 防错指引(重要!给 Claude Code 看)

### 1. 写代码前先读 test_logic.py

`test_logic.py` 包含 29 个测试用例,覆盖核心计算逻辑。你写的任何代码不能让这些测试失败。

```bash
python test_logic.py
```

**通过标志**:看到 `✓ 全部测试通过!`

### 2. 不要存"库存数量"字段

库存永远是计算出来的,不能存。否则会出现入库流水和库存数据对不上的问题。

✅ 正确:`SELECT SUM(qty) FROM in_records WHERE ... - SELECT SUM(qty) FROM out_records WHERE ...`

❌ 错误:维护一个 `stock` 表/字段,出入库时手动加减

### 3. 严格区分品类的款式校验

毛绒款式必须严格校验为 `normal` 或 `rare`,戏服则不限。

```python
# 正确示例
if category == 'plush' and style not in ('normal', 'rare'):
    return error('毛绒款式必须是 normal 或 rare')
# 戏服 style 任意文本都接受
```

### 4. 删除流水后库存自动重算

不需要写额外代码,库存是实时计算的。删除一笔流水后,下一次查询自动得到新值。

### 5. 不要做的事

❌ 不要加 BOM / 配比 / 多仓联动这些复杂逻辑,华登业务不需要
❌ 不要自动生成单号(用户明确要求手动)
❌ 不要引入 React / Vue 等前端框架
❌ 不要把 SQLite 换成 MySQL,5 个人用 SQLite 完全够
❌ 不要做软删除,直接物理删除
❌ 不要把毛绒和戏服分成两套表,共用一套表 + category 字段是正确做法

## 项目结构

```
huadeng_inventory/
├── app.py              # Flask 主程序(骨架,含登录 + 入库 + 库存查询)
├── database.py         # 数据库操作模块(已完成核心计算函数)
├── auth.py             # 认证 / 权限装饰器(已完成)
├── init_db.py          # 数据库初始化脚本
├── test_logic.py       # ⭐ 自动化测试脚本(29 个用例,必须通过)
├── requirements.txt    # Python 依赖
├── start.bat            # Windows 启动脚本
├── start.sh             # Mac/Linux 启动
├── templates/
│   ├── login.html      # 登录页(已完成)
│   └── app.html        # 主应用(已完成,从 V3 改造,支持双品类切换)
├── data/
│   └── inventory.db    # SQLite 数据库(首次运行自动创建)
├── README.md                   # 本文档
├── IMPLEMENTATION_PLAN.md      # ⭐ Claude Code 工作手册(8 个任务,按顺序做)
├── REQUIREMENTS.md             # 详细需求 + 代码参考
├── API_DESIGN.md               # API 接口约定
└── DEPLOYMENT.md               # 部署文档
```

## 开发状态

### ✅ 已完成

- 数据库设计(双品类、四维度库存模型)
- 核心库存计算函数(`calculate_stock`, `get_stock_summary`)
- 用户认证(登录 / 登出 / 权限装饰器)
- 入库 API 完整实现(增 / 删 / 查,支持品类筛选)
- 库存查询 API
- 自动化测试脚本(29 个用例)
- 前端 UI(品类切换、货号细表、表单)

### ⏳ 待开发(按优先级)

详见 `REQUIREMENTS.md`,优先级:

1. **出库 API**(`/api/out` 的 GET / POST / DELETE)— 仿照 `/api/in`
2. **布标 API**(`/api/flags` 的 GET / POST / DELETE)
3. **用户管理 API**(列表 / 新增 / 删除 / 改密码)
4. **导出 CSV API**(可选,前端已有 JS 版本)
5. **数据备份脚本**(自动每天备份 SQLite)
6. **生产部署优化**(用 waitress 替代开发服务器)

## 启动方式

**首次启动**:
```bash
# 安装依赖
pip install -r requirements.txt

# 初始化数据库(创建表 + 默认账号 + 示例数据)
python init_db.py

# 运行测试(确认代码无误)
python test_logic.py

# 启动服务
python app.py
```

**之后启动**:双击 `start.bat`(Windows)或 `./start.sh`(Mac/Linux)

访问:`http://localhost:5000`

## 给 Claude Code 的协作建议

1. **每写完一个功能,都跑一遍 `python test_logic.py`**,确保没有破坏现有逻辑
2. **写新功能前,先查看 `API_DESIGN.md`** 看接口约定
3. **遇到不确定的设计,先查 `REQUIREMENTS.md` 和本 README,实在不清楚再问用户**
4. **保持代码风格和现有代码一致**(中文注释、简单清晰、不要过度抽象)
5. **不要引入新的 Python 库**(除非用户同意)
6. **每次提交前**:确保 `python test_logic.py` 全部通过 + `python app.py` 能正常启动
