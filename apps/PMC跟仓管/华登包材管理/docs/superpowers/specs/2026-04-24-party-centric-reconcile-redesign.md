# 华登包材系统 · Party-Centric 重构设计

**日期**：2026-04-24
**取代**：`2026-04-24-import-reconciliation-design.md`（Scheme B，已推翻）
**分支策略**：`feat/huadeng-reconcile` 分支丢弃（24 commits 回到 main），基于 main 新开分支重做

---

## 1. 背景 & 动机

### 业务本质

华登包材系统追踪的是**三方工厂之间的周转包材**（胶箱/钙塑箱等可重复使用容器）的**借-还流转**：

- 华登（清溪华登，主厂）
- 邵阳（邵阳华登，分厂）
- 兴信（外协供应商）

每次物理发货 `from → to` 实际上是一次"借出"或"归还"，最终期望借还相抵。周期性做对账确认各方挂账余额。

### Scheme B 的问题（被推翻的原设计）

原 Scheme B 让**两方在同一个 channel 里各自录记录**，用 `source_party` 区分，核对时按 `order_no` 逐条配对。问题：

1. **UI 混乱**：登录一方看到"自己录的 + 对方录的（只读）"，两份数据混在同 channel 的同一张表里，信息密度太高
2. **order_no 配对脆弱**：两方订单号系统不同步，大量"匹配失败"条目
3. **C2 跳过规则等特殊补丁**暴露了核对算法的复杂度和脆弱性
4. **借还语义不对等**：逐条配对适合"同一事件两边各记一份"的模型，但不适合"A 发 B 100、B 还 A 50 分批"的累计借还

### 新设计的核心改变

**UI 结构**：section-based（3 板块，每板块 2 方向）→ **party-based**（3 party 模块，每个模块 2 对方 × 2 方向=4 张表）

**数据语义**：同 channel 混录 + source_party → **每笔物理发货两份记录**（发方一份 + 收方一份），字段 `recorded_by` / `from_party` / `to_party` 明确

**核对算法**：按 order_no 逐条配对 → **按日期范围汇总比总量**

**状态归属**：每条 record 带 status → 状态归于**核对批次**（reconciliations），record 只有 `locked` 布尔标志

---

## 2. 架构与路由

```
/                              首页：3 个 party 卡片 + 汇总报表入口
  ├─ 华登  → /party/hd
  ├─ 邵阳  → /party/sy
  └─ 兴信  → /party/xx
/party/<party>/login           登录（账号/密码）
/party/<party>                 party 主页
/party/<party>/logout
/reports                       汇总报表（三角债、两两净额、月度明细）
/reconcile                     核对中心（待处理 + 历史）
/reconcile/<id>                单次核对详情
/import                        Excel 批量导入
```

### Party 主页布局（以华登登录为例）

```
┌────────────────────────────────────────────────────────────┐
│ 当前：华登          [核对中心(3)]  [退出]                     │
├────────────────────────────────────────────────────────────┤
│ 📋 对邵阳                     [发起对账]  [导出]                │
│    Tab: [发→邵阳] [收自邵阳]                                    │
│    (筛选 / 新增 / 表格 / 分页 / 合计)                            │
├────────────────────────────────────────────────────────────┤
│ 📋 对兴信                     [发起对账]  [导出]                │
│    Tab: [发→兴信] [收自兴信]                                    │
└────────────────────────────────────────────────────────────┘
```

每个 party 登录后看到 **2 个对方区 × 2 个方向 tab = 4 张流水表**。对账按对方区发起。

**对 X 区内部布局**（顺序自上而下）：
1. [发起对账] / [导出流水] / [导出月份统计] / [导入 Excel] 按钮栏
2. [发→X] / [收自X] tab
3. 当前 tab 下：筛选栏（日期、核对状态）+ 新增表单（折叠）+ 流水表 + 分页 + 合计行
4. 投资记录列表（本 party 对 X 的投资记录）
5. 月份包材数量统计（本 party 对 X 的月度实存 + 投入）

### 登录模型

沿用现有 party 账号（hd / sy / xx），密码从环境变量读取：
- `HUADENG_SEC1_PASSWORD` → hd
- `HUADENG_SEC2_PASSWORD` → xx
- `HUADENG_SEC3_PASSWORD` → sy

（保持兼容，但 URL 路径重命名为 `/party/<party>/login` 而不再是 `/section/<n>/login`）

---

## 3. 数据模型

### 3.1 `flow_records` — 流水总表

```sql
CREATE TABLE flow_records (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    recorded_by     TEXT NOT NULL,            -- 'hd' | 'sy' | 'xx'
    from_party      TEXT NOT NULL,            -- 物理发货方
    to_party        TEXT NOT NULL,            -- 物理收货方
    date            TEXT NOT NULL,            -- YYYY-MM-DD
    order_no        TEXT,
    remark          TEXT,
    -- 17 种包材数量（REAL DEFAULT 0）
    jx_qty REAL DEFAULT 0, gx_qty REAL DEFAULT 0, zx_qty REAL DEFAULT 0,
    jkb_qty REAL DEFAULT 0, mkb_qty REAL DEFAULT 0, xb_qty REAL DEFAULT 0,
    dz_qty REAL DEFAULT 0, wb_qty REAL DEFAULT 0, pk_qty REAL DEFAULT 0,
    xzx_qty REAL DEFAULT 0, dgb_qty REAL DEFAULT 0, xjp_qty REAL DEFAULT 0,
    dk_qty REAL DEFAULT 0,
    xs_qty REAL DEFAULT 0, gsb_qty REAL DEFAULT 0,
    djx_qty REAL DEFAULT 0, zb_qty REAL DEFAULT 0,
    reconciliation_id INTEGER,                 -- FK to reconciliations.id; NULL = 未核对
    locked            INTEGER DEFAULT 0,       -- 1 = 不允许 edit/delete
    created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (reconciliation_id) REFERENCES reconciliations(id)
);
CREATE INDEX idx_flow_recorded_by ON flow_records(recorded_by, from_party, to_party);
CREATE INDEX idx_flow_pair_date   ON flow_records(from_party, to_party, date);
CREATE INDEX idx_flow_reconc      ON flow_records(reconciliation_id);
```

**方向推导**：
- `recorded_by == from_party` → 这是**发**记录
- `recorded_by == to_party` → 这是**收**记录

不单独存 direction 字段。合法组合只有这两种。

**发/收记录不做 FK 关联**。核对时按 (from, to) + 日期范围做汇总，不逐条匹配。

### 3.2 `reconciliations` — 核对批次

```sql
CREATE TABLE reconciliations (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    initiator_party  TEXT NOT NULL,           -- 谁发起
    approver_party   TEXT NOT NULL,           -- 对方
    pair_low         TEXT NOT NULL,           -- 字母序两方，唯一性约束用
    pair_high        TEXT NOT NULL,           -- pair_low < pair_high
    date_from        TEXT NOT NULL,
    date_to          TEXT NOT NULL,
    status           TEXT NOT NULL,           -- 'pending_approval'|'confirmed'|'disputed'|'withdrawn'
    snapshot_json    TEXT,                    -- 发起时两方各方向各包材的汇总快照
    notes            TEXT,
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    approved_at      TIMESTAMP
);
CREATE INDEX idx_reconc_approver ON reconciliations(approver_party, status);
CREATE INDEX idx_reconc_pair     ON reconciliations(pair_low, pair_high, status);
```

**snapshot_json 结构**（以 hd-sy 对为例）：
```json
{
  "hd_to_sy": {
    "sender_recorded":   {"jx": 100, "gx": 50, ...},
    "receiver_recorded": {"jx": 100, "gx": 50, ...}
  },
  "sy_to_hd": {
    "sender_recorded":   {"jx": 20, ...},
    "receiver_recorded": {"jx": 20, ...}
  }
}
```

### 3.3 `investment_records` — 投资记录（按 pair）

```sql
CREATE TABLE investment_records (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    recorded_by  TEXT NOT NULL,
    counterparty TEXT NOT NULL,
    year_month   TEXT NOT NULL,               -- 'YYYY-MM'
    mkb_qty REAL DEFAULT 0, jkb_qty REAL DEFAULT 0,
    jx_qty REAL DEFAULT 0,  gx_qty REAL DEFAULT 0,
    remark       TEXT,
    created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 3.4 `monthly_inventory` — 月份实存数（按 pair）

```sql
CREATE TABLE monthly_inventory (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    recorded_by  TEXT NOT NULL,
    counterparty TEXT NOT NULL,
    year_month   TEXT NOT NULL,
    mkb_qty REAL, jkb_qty REAL, jx_qty REAL, gx_qty REAL,
    UNIQUE (recorded_by, counterparty, year_month)
);
```

### 3.5 `default_prices` — 单价（原样保留）

```sql
CREATE TABLE default_prices (
    item_key TEXT PRIMARY KEY,
    price    REAL DEFAULT 0
);
```

### 3.6 丢弃的旧字段 / 旧表

| 旧字段/表 | 为何丢弃 |
|-----------|----------|
| `records.status` | 状态语义迁到 `reconciliations`；单条不带状态 |
| `records.channel` | 拆成 `from_party` + `to_party` |
| `records.source_party` | 改名 `recorded_by`（更准） |
| `records` 整表 | 重建为 `flow_records` |
| `reconciliation_items` | 按 order_no 配对废弃，不再需要 |
| `reconciliations`（旧版） | 字段结构不一样，重建 |

---

## 4. 录入与核对流程

### 4.1 录入

在 party 主页的任一 tab（如"发→邵阳"）点"新增"：
- 填 date / order_no / 17 包材数量 / 备注
- 后端 INSERT `flow_records`：根据当前 tab 推导 `recorded_by / from_party / to_party`，`locked=0, reconciliation_id=NULL`
- 已锁定记录无 edit / delete 按钮

### 4.2 核对流程（状态机）

```
                    发起对账
  [nothing]  ──────────────────▶  pending_approval
                                       │
                           同意 ────────┼──▶  confirmed   (records locked=1)
                                       │                       │
                           打回 ────────┼──▶  disputed  ───▶  (从头再发起)
                                       │
                           撤回 ────────┼──▶  withdrawn ───▶  (从头再发起)
                                       │
                                       └──▶  (超时忽略：永久 pending)

  confirmed ─────撤销对账（双方任一发起）─────▶  withdrawn  (records unlock)
```

### 4.3 发起核对（步骤）

1. party 主页 "对邵阳" 区点 **[发起对账]**
2. 弹出 modal，选 `date_from` / `date_to`
3. 系统预览两个物理方向的汇总差异：
   - hd→sy: hd 发方汇总 vs sy 收方汇总（17 包材各一列，差异高亮）
   - sy→hd: sy 发方汇总 vs hd 收方汇总
4. 发起方点"确认发起"：
   - INSERT `reconciliations` 行，status=`pending_approval`，snapshot_json 落库
   - UPDATE `flow_records` SET reconciliation_id=<id>（范围内所有相关记录）
   - **范围内 records 不 lock**（要让对方审批前还能改）

### 4.4 对方确认（审批方）

核对中心点开 pending 项：
- 显示同一预览表 + snapshot + 发起方 notes
- 三个操作：
  - **同意** → `confirmed` + records locked=1
  - **打回** → `disputed`，`reconciliation_id` 清空，填 notes
  - **不做** → 保持 pending

### 4.5 发起方撤回

`pending_approval` 状态，发起方可 **[撤回]** → `withdrawn` + records 解绑。

### 4.6 撤销对账（对已 confirmed 的）

进核对详情，任一方可点 **[撤销对账]** → `withdrawn` + records unlock + 清空 reconciliation_id。

### 4.7 核对算法（核心代码草图）

```python
ITEM_KEYS = ['jx','gx','zx','jkb','mkb','xb','dz','wb','pk','xzx','dgb','xjp','dk','xs','gsb','djx','zb']

def compare_pair(party_a, party_b, date_from, date_to):
    result = {}
    for sender, receiver in [(party_a, party_b), (party_b, party_a)]:
        sender_sum   = sum_items(recorded_by=sender,   from_party=sender, to_party=receiver,
                                 date_from=date_from, date_to=date_to)
        receiver_sum = sum_items(recorded_by=receiver, from_party=sender, to_party=receiver,
                                 date_from=date_from, date_to=date_to)
        diffs = {k: sender_sum[k] - receiver_sum[k]
                 for k in ITEM_KEYS if sender_sum[k] != receiver_sum[k]}
        result[f"{sender}_to_{receiver}"] = {
            'sender_recorded':   sender_sum,
            'receiver_recorded': receiver_sum,
            'diffs':             diffs,
        }
    return result
```

### 4.8 范围冲突

- 同 pair + 日期范围重叠 + 存在 `pending_approval` 的 reconciliation：禁止再次发起（前端提示，后端 409）
- 同 pair + 日期范围完全覆盖已 `confirmed` 的范围：禁止再次发起（需先撤销对账）
- 日期范围部分重叠 confirmed：允许发起，但发起的预览里会显示"X 条记录已被锁定"，不纳入本次核对

---

## 5. 汇总报表

### 5.1 数据源规则

**权威数据 = 发方记录**（`recorded_by == from_party`）。收方记录不入汇总，只用于核对验证。

**发方漏录时**：不自动回退到收方。汇总就少那条，由核对流程暴露差异后 sender 补录。

### 5.2 报表筛选

顶部加开关 `[全部 | 仅已核对]`（默认全部）：
- 全部：所有 flow_records（发方）
- 仅已核对：`reconciliation_id IS NOT NULL AND locked=1`

### 5.3 各模块数据源映射

| 模块 | 旧逻辑 | 新逻辑 |
|------|--------|--------|
| 各 channel 汇总 | `records` by channel | `flow_records` by (from, to)，filter `recorded_by=from_party` |
| 三角债净欠表 | qty diff 两方向 | 同上 |
| 两两净额 / 债务往来总结 | 同上 | 同上 |
| 月度明细（A发/B发/净欠） | `records` aggregate by month | `flow_records` group by month + (from, to) |
| 三角债数量统计 (TRIANGLE_ITEMS 5 种) | 同 | 同上 |
| 三角债金额（qty × price） | 同 | 同上 |

### 5.4 三角债语义

三方两两净额规则不变：
- 华登-邵阳：`Σ(from=hd,to=sy)` − `Σ(from=sy,to=hd)`
- 华登-兴信：`Σ(from=hd,to=xx)` − `Σ(from=xx,to=hd)`
- 邵阳-兴信：`Σ(from=sy,to=xx)` − `Σ(from=xx,to=sy)`

"X 欠 Y Z 个" 显示公式不变。

---

## 6. 数据迁移

### 6.1 范围

只迁 `records WHERE status IN ('legacy','confirmed')`。本地 db 有约 640 条符合，生产库估计 ~几千条。

**draft / pending_approval 记录全部丢弃**（用户会用 Excel 重新导入）。

### 6.2 字段映射（records → flow_records）

| 旧 | 新 | 规则 |
|----|----|----|
| `channel` | `from_party`, `to_party` | 1=hd→sy, 2=sy→hd, 3=hd→xx, 4=xx→hd, 5=sy→xx, 6=xx→sy |
| `source_party` | `recorded_by` | NULL → 取 channel 的 sender（发方默认录） |
| `status='legacy'` 或 `'confirmed'` | `locked=1`, `reconciliation_id=NULL` | 视为历史已锁，不参与新核对 |
| `date / order_no / remark / *_qty` | 同名 | 直接 copy |
| `created_at` | 同 | 直接 copy |

### 6.3 迁移脚本

`scripts/migrate_to_v2.py`（独立脚本，手动跑，不掺到 app 启动逻辑）：

```
1. 备份: cp huadeng.db huadeng.db.bak-YYYYMMDD-HHMMSS
2. 建新表 (CREATE TABLE IF NOT EXISTS ...)
3. INSERT INTO flow_records SELECT ... FROM records WHERE status IN (...)
4. INSERT INTO investment_records SELECT ... FROM investment_records_old
5. INSERT INTO monthly_inventory SELECT ... FROM (原月度表)
6. DROP TABLE records, reconciliations, reconciliation_items, ... (旧表)
7. 打印统计 + 断言: 新 flow_records 数量 == 旧 records WHERE status IN (...) 数量
8. 断言失败 → 保留旧表，flow_records 清空，退出非 0
```

### 6.4 部署顺序

1. 本地：跑迁移 → 起服务验证
2. 服务器：停服务 → scp 脚本 → 跑迁移 → 部署新代码 → 起服务
3. 若有问题：还原 bak.db + 回滚代码 main

### 6.5 Reconciliations 旧表

旧 `reconciliations` + `reconciliation_items` **全部 drop，不迁移**。Scheme B 的核对批次都是测试数据，无生产价值。

---

## 7. Excel 导入（按新 schema 重写）

### 7.1 数据源文件（用户提供）

- `华登/26年清三与清二包材对数表.xlsx` — HD 方视角的 HD↔XX 对数
- `华登/26年清溪华登与邵阳华登包材对数表.xlsx` — HD 方视角的 HD↔SY 对数
- `邵阳/东莞26-4份包材明细表.xlsx` — SY 方视角的 SY↔HD 记录
- `兴信/2026年邵阳华登送兴信包装成品明细表.xlsx` — XX 方视角的 SY→XX 记录
- `兴信/2026年兴信送邵阳华登包装物料明细表.xlsx` — XX 方视角的 XX→SY 记录

### 7.2 导入模板

每个 Excel 文件：
- 多 sheet（按月或按项目）
- 列基本统一：日期 / 订单号 / 17 包材数量 / 备注

导入时需指定：
- **recorded_by**：哪方录的（由上传者当前登录身份决定）
- **from_party / to_party**：每个 sheet 对应的方向（由导入配置决定）

### 7.3 导入 UI

`/import` 页面：
1. 上传 xlsx
2. 预览前 10 行 + sheet 选择器
3. 选 sheet + 选 (from, to) 方向
4. 点"导入" → batch INSERT flow_records

重复 sheet 用户手动处理（多次上传，每次选不同 sheet 和方向）。

### 7.4 列映射配置

`IMPORT_COLUMN_MAPPINGS`（Python dict），按 sheet 标题模式识别列顺序。无法识别的列跳过（带警告）。具体映射在实施阶段按实际文件调校。

---

## 8. 测试策略

### 8.1 单元测试（pytest，目标 ≥50）

| 文件 | 重点 |
|------|------|
| `test_flow_records.py` | CRUD、锁定校验、方向推导 |
| `test_entry_validation.py` | party 权限、锁定记录不许改 |
| `test_reconcile_algo.py` | `compare_pair()` 各场景 |
| `test_reconcile_flow.py` | 状态机迁移（发起/同意/打回/撤回/撤销）|
| `test_reconcile_overlap.py` | 范围冲突校验 |
| `test_reports.py` | 三角债计算正确性 |
| `test_migration.py` | 构造旧 schema → 跑迁移 → 断言 |
| `test_excel_import.py` | 每种 Excel 模板 → 解析 → 入库断言 |

### 8.2 集成测试

`test_end_to_end.py`：模拟 HD↔SY 一轮完整周期（录入→发起→打回→改→再发起→同意→锁定→报表数字）。

### 8.3 手工 E2E

- 三账号轮换登录
- 各自录若干条
- 发起跨方核对，走完同意 / 打回 / 撤销
- 报表数字对
- Excel 导入（每种模板各试一次）

### 8.4 不覆盖（YAGNI）

- 并发（两人同时发起同范围）— 乐观锁 + DB 唯一约束兜底
- 浏览器兼容 / 移动端
- 性能测试

---

## 9. 实施阶段

| Phase | 内容 | 预估 tasks |
|-------|------|------------|
| P0 | 分支回到 main → 新建 feature 分支 + pytest 基础 | 1 |
| P1 | 新 schema 建表 + 迁移脚本 + 迁移测试 | 3 |
| P2 | party session/登录/首页 3 卡/顶部导航 | 3 |
| P3 | party 主页：对 X 区 + 发/收 tab + 录入 + 编辑 + 分页筛选 | 5 |
| P4 | 核对：发起/预览/同意/打回/撤回/撤销 + 核对中心 UI | 6 |
| P5 | 汇总报表：数据源切到 flow_records（发方为准）+ 筛选 | 3 |
| P6 | Excel 导入：新 schema 重写 + 3 方 × 多模板 | 4 |

**总 ~25 个 task**。

**依赖**：P1 完成 → 其余可部分并行；P4 依赖 P3；P5 P6 依赖 P1。

---

## 10. 保留 / 抛弃清单

### 保留
- `base.html` 顶部导航骨架
- `default_prices` 表
- `reports.html` UI 骨架（三角债视觉不变，内部数据源换）
- 核对中心页 UI 骨架（列表/详情模板改内部）
- 自动刷新、单价显示切换等小功能

### 彻底抛弃
- `feat/huadeng-reconcile` 分支的 24 commits
- Scheme B 的 models / routes / templates（`section.html`, `reconcile_list.html`, `reconcile_detail.html` 的当前实现）
- `records` / `reconciliations` / `reconciliation_items` 旧表
- C2 跳过规则
- section-based URL 路径（`/section/<n>/...`）
- `SECTIONS` / `CHANNELS` / `SECTION_ACCOUNTS` / `_PARTY_BY_DEFAULT_USERNAME` 等 section-导向的常量（重命名或重建）

---

## 11. 后续 / Out of Scope

- 多工厂（>3 方）扩展：当前硬编码 hd/sy/xx，未来若加 4 方再说
- Redis 缓存：报表实时计算够用，不优化
- RBAC 细粒度：3 个 party 账号够用，不做 admin/operator 分层
- 移动端适配
- 并发冲突的乐观锁实现（用 DB 唯一约束 + 重试兜底）

---

## 12. 成功判据

实施完成的验收标准：

- [ ] 本地迁移脚本成功执行，旧数据 legacy/confirmed 全部进 flow_records
- [ ] 三账号登录各自能看到 4 张表（对两个对方 × 发/收）
- [ ] 能跑完一轮完整核对：HD 发起 → SY 同意 → records locked=1 → 报表数字正确
- [ ] 撤销对账能把 records 解锁
- [ ] 三角债净欠计算结果和新数据一致
- [ ] 5 个 Excel 模板都能导入成功
- [ ] pytest 全绿（≥50 个用例）
- [ ] 手工 E2E 无明显 bug

---

## 附录 A：Party 权限表

| party | 可访问模块 | 可对的账本 |
|-------|-----------|-----------|
| hd | 对邵阳、对兴信 | HD↔SY、HD↔XX |
| sy | 对华登、对兴信 | SY↔HD、SY↔XX |
| xx | 对华登、对邵阳 | XX↔HD、XX↔SY |

（三方两两互通，每方参与 2 对。）

## 附录 B：17 种包材 item_key

```
jx 胶箱 / gx 钙塑箱 / zx 纸箱 / jkb 胶卡板 / mkb 木卡板 / xb 小板
dz 胶袋 / wb 围布 / pk 平卡 / xzx 小纸箱 / dgb 大盖板 / xjp 小胶盆
dk 刀卡 / xs 吸塑 / gsb 钙塑板 / djx 大胶箱 / zb 纸板
```

## 附录 C：4 种月度统计项（STAT_ITEMS）

```
mkb 木卡板 / jkb 胶卡板 / jx 胶箱 / gx 钙塑箱
```

## 附录 D：5 种三角债统计项（TRIANGLE_ITEMS）

```
mkb 木卡板 / jkb 胶卡板 / jx 胶箱 / gx 钙塑箱 / zx 纸箱
```
