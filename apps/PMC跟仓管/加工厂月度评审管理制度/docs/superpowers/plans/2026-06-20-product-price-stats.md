# 产品单价统计表 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增「产品单价统计表」板块——按部门、按 车间→加工厂→加工类别 分组展示订单价格数据,并导出与参考文件 `啤机部-外发产品单价统计表.xlsx` 同格式的 Excel。

**Architecture:** 复用现有 orders 数据,给 orders 补 2 个字段(供应商外发价、加工类别)。纯计算/分组逻辑抽到 `src/utils/priceStats.ts` 并单测;新增两个视图(部门卡片页 + 部门统计表页),统计表页同时负责屏幕展示与 Excel 导出(沿用 `SummaryView.vue` 的 `aoa_to_sheet` + `!merges` 模式)。新字段在「新增下单」与「订单详情页」录入。

**Tech Stack:** Vue 3 (`<script setup lang="ts">`)、Pinia、vue-router、PocketBase(JSVM 迁移)、xlsx(SheetJS)、vitest。

## Global Constraints

- PocketBase 版本 0.23.0;迁移用 `migrate((app)=>{...},(app)=>{...})`,字段类 `NumberField`/`TextField`。
- 迁移编号紧接现有最后一个 `1700000032`,本计划用 `1700000033`。
- 每个 Vue 改动后必须通过 `npx vue-tsc -b --force`(期望 `EXIT_CODE=0`)。
- 计算口径:扣税点1.13后单价 = 外发单价 ÷ 1.13(保留 4 位小数);占比 = 扣税点1.13后单价 ÷ 核价生产工价 ×100%(保留 1 位小数),导出显示为 `"97.8%"` 字符串。
- 部门枚举(craft → 名称):`injection 注塑部 / painting 喷油部 / assembly 装配部 / sewing 车缝部`。
- 文件引用用法:Excel 用 `XLSX.utils.aoa_to_sheet` 写二维数组,合并用 `ws['!merges']`,列宽用 `ws['!cols']`。
- 提交信息结尾加:`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。

---

## File Structure

| 文件 | 职责 |
|------|------|
| `pb_migrations/1700000033_add_order_pricing_fields.js`(建) | orders 新增 `supplier_price`(number)、`process_category`(text) |
| `src/types/order.ts`(改) | Order 接口补 2 字段 |
| `src/utils/priceStats.ts`(建) | 纯函数:`afterTax`、`ratioPct`、`buildPriceStatsRows`(分组+排序+合并跨度) |
| `tests/priceStats.spec.ts`(建) | 上述纯函数单测 |
| `src/views/PriceStatsView.vue`(建) | 某部门统计表展示 + 导出 Excel(`/price-stats/dept/:craft`) |
| `src/views/PriceStatsDeptsView.vue`(建) | 部门卡片页(`/price-stats`) |
| `src/router/index.ts`(改) | 加 2 条路由 |
| `src/components/AppLayout.vue`(改) | 侧边栏加「产品单价统计」菜单 |
| `src/views/OrderFormView.vue`(改) | 新增下单加 供应商外发价 / 加工类别 |
| `src/views/OrderDetailView.vue`(改) | 加可编辑「价格信息」区 |

---

## Task 1: orders 新增价格字段(迁移 + 类型)

**Files:**
- Create: `pb_migrations/1700000033_add_order_pricing_fields.js`
- Modify: `src/types/order.ts`

**Interfaces:**
- Produces: orders 集合多出字段 `supplier_price: number`、`process_category: string`;`Order` 接口新增 `supplier_price?: number`、`process_category?: string`。

- [ ] **Step 1: 写迁移文件**

`pb_migrations/1700000033_add_order_pricing_fields.js`:

```js
// pb_migrations/1700000033_add_order_pricing_fields.js
// 产品单价统计表所需:orders 新增「供应商外发价」「加工类别」。
migrate((app) => {
  const c = app.findCollectionByNameOrId('orders')
  c.fields.add(new NumberField({ name: 'supplier_price' }))   // 供应商外发价￥
  c.fields.add(new TextField({ name: 'process_category' }))   // 加工类别
  app.save(c)
}, (app) => {
  const c = app.findCollectionByNameOrId('orders')
  for (const name of ['supplier_price', 'process_category']) {
    const f = c.fields.find((x) => x.name === name)
    if (f) c.fields.removeById(f.id)
  }
  app.save(c)
})
```

- [ ] **Step 2: 改类型**

在 `src/types/order.ts` 的 `quantity?: number` 行之后插入:

```ts
  quantity?: number
  supplier_price?: number
  process_category?: string
```

(若 `unit_price?` 等已在其后,保持原顺序,仅新增这两行。)

- [ ] **Step 3: 应用迁移并验证**

Run:
```bash
cd "/Users/wendy/Desktop/加工厂月度评审管理制度"
pkill -f "pocketbase serve"; sleep 1.5
cp pb_data/data.db pb_data/data.db.bak-20260620-pricing-fields
ROOT="$(pwd)"
"$ROOT/bin/pocketbase" serve --http=127.0.0.1:8091 --dir="$ROOT/pb_data" --migrationsDir="$ROOT/pb_migrations" --hooksDir="$ROOT/pb_hooks" > /tmp/factory-pb.log 2>&1 &
sleep 2.5
sqlite3 pb_data/data.db "SELECT file FROM _migrations WHERE file LIKE '%pricing_fields%';"
sqlite3 pb_data/data.db "SELECT fields FROM _collections WHERE name='orders';" | grep -o "supplier_price\|process_category"
```
Expected: 迁移文件名出现;`grep` 输出 `supplier_price` 与 `process_category`。

- [ ] **Step 4: 类型检查**

Run: `npx vue-tsc -b --force; echo "EXIT_CODE=$?"`
Expected: `EXIT_CODE=0`

- [ ] **Step 5: Commit**

```bash
git add pb_migrations/1700000033_add_order_pricing_fields.js src/types/order.ts
git commit -m "feat(orders): add supplier_price and process_category fields

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: 价格统计纯函数 + 单测(TDD)

**Files:**
- Create: `src/utils/priceStats.ts`
- Test: `tests/priceStats.spec.ts`

**Interfaces:**
- Consumes: `Order` from `../src/types/order`(本任务测试用 `as any[]` 构造,无需真实 PB)。
- Produces:
  - `afterTax(unitPrice?: number | null): number | null`
  - `ratioPct(unitPrice?: number | null, quoteLaborPrice?: number | null): number | null`(返回百分比数值,如 `97.8`)
  - `interface PriceStatsRow { workshop:string; factory:string; category:string; item_no:string; product:string; quote_labor_price:number|null; supplier_price:number|null; unit_price:number|null; after_tax:number|null; ratio_pct:number|null; manager_rating:number|null; notes:string; workshopSpan:number; factorySpan:number; categorySpan:number }`
  - `buildPriceStatsRows(orders: Order[], factoryName: (o: Order) => string): PriceStatsRow[]`(已按 车间→加工厂→加工类别 排序,`*Span` 字段:分组首行=该组行数,其余行=0)

- [ ] **Step 1: 写失败测试**

`tests/priceStats.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { afterTax, ratioPct, buildPriceStatsRows } from '../src/utils/priceStats'

describe('afterTax', () => {
  it('外发单价 ÷ 1.13，保留4位小数', () => {
    expect(afterTax(0.58)).toBe(0.5133)
  })
  it('空值返回 null', () => {
    expect(afterTax(null)).toBeNull()
    expect(afterTax(undefined)).toBeNull()
  })
})

describe('ratioPct', () => {
  it('扣税点后单价 ÷ 核价 ×100，保留1位小数', () => {
    expect(ratioPct(0.58, 0.525)).toBe(97.8)
  })
  it('核价为 0/空 或外发为空 → null', () => {
    expect(ratioPct(0.58, 0)).toBeNull()
    expect(ratioPct(0.58, null)).toBeNull()
    expect(ratioPct(null, 0.5)).toBeNull()
  })
})

describe('buildPriceStatsRows', () => {
  const factoryName = (o: any) => o.expand?.factory?.name ?? ''
  const orders = [
    { workshop: '兴信A', process_category: '塑胶半成品', item_no: '9565', product: '松鼠',
      quote_labor_price: 0.595, supplier_price: 0.6, unit_price: 0.682, manager_rating: 0, notes: '',
      expand: { factory: { name: '俊豪塑胶' } } },
    { workshop: '兴信A', process_category: '塑胶半成品', item_no: '9548', product: '鸭妈妈',
      quote_labor_price: 0.525, supplier_price: 0.51, unit_price: 0.58, manager_rating: 0, notes: '',
      expand: { factory: { name: '俊豪塑胶' } } },
    { workshop: '兴信A', process_category: '塑胶半成品', item_no: '71172', product: '大脑',
      quote_labor_price: 0.703, supplier_price: 0.7, unit_price: 0.795, manager_rating: 0, notes: '',
      expand: { factory: { name: '鸿徽塑胶' } } },
  ] as any[]

  it('按 车间→加工厂→加工类别 排序', () => {
    const rows = buildPriceStatsRows(orders, factoryName)
    expect(rows.map((r) => r.factory)).toEqual(['俊豪塑胶', '俊豪塑胶', '鸿徽塑胶'])
  })

  it('车间合并跨 3 行（首行 span=3，其余=0）', () => {
    const rows = buildPriceStatsRows(orders, factoryName)
    expect(rows[0].workshopSpan).toBe(3)
    expect(rows[1].workshopSpan).toBe(0)
    expect(rows[2].workshopSpan).toBe(0)
  })

  it('加工厂在车间内分别合并（俊豪 2 行、鸿徽 1 行）', () => {
    const rows = buildPriceStatsRows(orders, factoryName)
    expect(rows[0].factorySpan).toBe(2)
    expect(rows[1].factorySpan).toBe(0)
    expect(rows[2].factorySpan).toBe(1)
  })

  it('带出计算列 after_tax / ratio_pct', () => {
    const rows = buildPriceStatsRows(orders, factoryName)
    const duck = rows.find((r) => r.product === '鸭妈妈')!
    expect(duck.after_tax).toBe(0.5133)
    expect(duck.ratio_pct).toBe(97.8)
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run tests/priceStats.spec.ts`
Expected: FAIL(`Cannot find module '../src/utils/priceStats'` 或函数未定义)。

- [ ] **Step 3: 写实现**

`src/utils/priceStats.ts`:

```ts
import type { Order } from '../types/order'

export interface PriceStatsRow {
  workshop: string
  factory: string
  category: string
  item_no: string
  product: string
  quote_labor_price: number | null
  supplier_price: number | null
  unit_price: number | null
  after_tax: number | null
  ratio_pct: number | null
  manager_rating: number | null
  notes: string
  // 分组合并跨度：首行=该组连续行数；被合并的后续行=0（渲染/导出时省略该单元格）
  workshopSpan: number
  factorySpan: number
  categorySpan: number
}

// 扣税点1.13后单价 = 外发单价 ÷ 1.13（保留4位小数）
export function afterTax(unitPrice?: number | null): number | null {
  if (unitPrice == null) return null
  return Math.round((unitPrice / 1.13) * 10000) / 10000
}

// 占比 = 扣税点1.13后单价 ÷ 核价生产工价 ×100（百分比，保留1位小数）
export function ratioPct(unitPrice?: number | null, quoteLaborPrice?: number | null): number | null {
  const at = afterTax(unitPrice)
  if (at == null || !quoteLaborPrice) return null
  return Math.round((at / quoteLaborPrice) * 1000) / 10
}

const SEP = ' '
function computeSpan(
  rows: PriceStatsRow[],
  key: (r: PriceStatsRow) => string,
  field: 'workshopSpan' | 'factorySpan' | 'categorySpan',
) {
  let i = 0
  while (i < rows.length) {
    let j = i + 1
    while (j < rows.length && key(rows[j]) === key(rows[i])) j++
    rows[i][field] = j - i
    for (let k = i + 1; k < j; k++) rows[k][field] = 0
    i = j
  }
}

export function buildPriceStatsRows(
  orders: Order[],
  factoryName: (o: Order) => string,
): PriceStatsRow[] {
  const rows: PriceStatsRow[] = orders.map((o) => ({
    workshop: o.workshop ?? '',
    factory: factoryName(o),
    category: o.process_category ?? '',
    item_no: o.item_no ?? '',
    product: o.product ?? '',
    quote_labor_price: o.quote_labor_price ?? null,
    supplier_price: o.supplier_price ?? null,
    unit_price: o.unit_price ?? null,
    after_tax: afterTax(o.unit_price),
    ratio_pct: ratioPct(o.unit_price, o.quote_labor_price),
    manager_rating: o.manager_rating ?? null,
    notes: o.notes ?? '',
    workshopSpan: 0,
    factorySpan: 0,
    categorySpan: 0,
  }))
  // 排序保证同组相邻：车间 → 加工厂 → 加工类别
  rows.sort((a, b) =>
    a.workshop.localeCompare(b.workshop) ||
    a.factory.localeCompare(b.factory) ||
    a.category.localeCompare(b.category))
  computeSpan(rows, (r) => r.workshop, 'workshopSpan')
  computeSpan(rows, (r) => r.workshop + SEP + r.factory, 'factorySpan')
  computeSpan(rows, (r) => r.workshop + SEP + r.factory + SEP + r.category, 'categorySpan')
  return rows
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run tests/priceStats.spec.ts`
Expected: PASS(全部用例绿色)。

- [ ] **Step 5: Commit**

```bash
git add src/utils/priceStats.ts tests/priceStats.spec.ts
git commit -m "feat(price-stats): add grouping + price calc utils with tests

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: 部门统计表页 + 导出 Excel

**Files:**
- Create: `src/views/PriceStatsView.vue`

**Interfaces:**
- Consumes: `buildPriceStatsRows`, `type PriceStatsRow` from `../utils/priceStats`;`useOrdersStore`;`CRAFT_LABELS, type Craft` from `../constants/roles`;`XLSX` from `xlsx`;`AppLayout`。
- Produces: 路由组件 `PriceStatsView`(供 Task 4 路由引用,路径 `/price-stats/dept/:craft`)。

- [ ] **Step 1: 写视图(展示 + 导出)**

`src/views/PriceStatsView.vue`:

```vue
<script setup lang="ts">
import { onMounted, computed } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import * as XLSX from 'xlsx'
import AppLayout from '../components/AppLayout.vue'
import { useOrdersStore } from '../stores/orders'
import { CRAFT_LABELS, type Craft } from '../constants/roles'
import { buildPriceStatsRows, type PriceStatsRow } from '../utils/priceStats'

const route = useRoute()
const orders = useOrdersStore()

const craft = computed(() => route.params.craft as Craft)
const deptName = computed(() => CRAFT_LABELS[craft.value] ?? '部门')

onMounted(() => orders.fetchAll())

const rows = computed<PriceStatsRow[]>(() => {
  const list = orders.items.filter((o) => o.expand?.factory?.craft === craft.value)
  return buildPriceStatsRows(list, (o) => o.expand?.factory?.name ?? '')
})

const pct = (v: number | null) => (v == null ? '-' : v + '%')
const num = (v: number | null) => (v == null ? '-' : v)

function exportExcel() {
  const title = `${deptName.value}-外发产品单价统计表`
  // 三行表头
  const titleRow = [title, '', '', '', '', '', '', '', '', '', '', '']
  const groupRow = ['车间', '加工厂名称', '加工类别', '货号', '配件名称/模号', '价格管理', '', '', '', '', '综合评价', '备注']
  const subRow = ['', '', '', '', '', '核价生产工价$', '供应商外发价￥', '外发单价$', '扣税点1.13后单价$', '占比', '经理评分(1-10分)', '']
  const body = rows.value.map((r) => [
    r.workshopSpan ? r.workshop : '',
    r.factorySpan ? r.factory : '',
    r.categorySpan ? r.category : '',
    r.item_no,
    r.product,
    r.quote_labor_price ?? '',
    r.supplier_price ?? '',
    r.unit_price ?? '',
    r.after_tax ?? '',
    r.ratio_pct == null ? '' : r.ratio_pct + '%',
    r.manager_rating ?? '',
    r.notes,
  ])
  const aoa = [titleRow, groupRow, subRow, ...body]
  const ws = XLSX.utils.aoa_to_sheet(aoa)

  // 合并：标题、表头分组、左侧三列纵向合并
  const merges = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 11 } },          // 标题横跨
    { s: { r: 1, c: 5 }, e: { r: 1, c: 9 } },           // 价格管理 横跨 5 列
  ]
  // 表头第 1、2 行：车间/加工厂/加工类别/货号/配件名称/综合评价/备注 纵向合并
  for (const c of [0, 1, 2, 3, 4, 10, 11]) merges.push({ s: { r: 1, c }, e: { r: 2, c } })
  // 数据区 车间/加工厂/加工类别 纵向合并（数据从第 3 行开始）
  rows.value.forEach((r, i) => {
    const rr = 3 + i
    if (r.workshopSpan > 1) merges.push({ s: { r: rr, c: 0 }, e: { r: rr + r.workshopSpan - 1, c: 0 } })
    if (r.factorySpan > 1) merges.push({ s: { r: rr, c: 1 }, e: { r: rr + r.factorySpan - 1, c: 1 } })
    if (r.categorySpan > 1) merges.push({ s: { r: rr, c: 2 }, e: { r: rr + r.categorySpan - 1, c: 2 } })
  })
  ws['!merges'] = merges

  // 列宽（中文按 2 字宽）
  const cw = (v: any) => {
    let w = 0
    for (const ch of String(v ?? '')) w += /[⺀-￿]/.test(ch) ? 2 : 1
    return w
  }
  ws['!cols'] = groupRow.map((_, c) => {
    let max = Math.max(cw(groupRow[c]), cw(subRow[c]))
    for (const row of body) max = Math.max(max, cw(row[c]))
    return { wch: Math.min(Math.max(max + 2, 6), 40) }
  })

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '外发-工价表')
  XLSX.writeFile(wb, `${title}.xlsx`)
}
</script>
<template>
  <AppLayout>
    <div class="page wide">
      <div class="toolbar">
        <RouterLink to="/price-stats" class="back">← 部门</RouterLink>
        <h2 style="margin:0">{{ deptName }} · 外发产品单价统计表</h2>
        <span class="muted">共 {{ rows.length }} 条</span>
        <span class="spacer"></span>
        <button @click="exportExcel">导出 Excel</button>
      </div>
      <div class="scroll">
        <table class="stats">
          <thead>
            <tr>
              <th rowspan="2">车间</th><th rowspan="2">加工厂名称</th><th rowspan="2">加工类别</th>
              <th rowspan="2">货号</th><th rowspan="2">配件名称/模号</th>
              <th colspan="5">价格管理</th>
              <th rowspan="2">经理评分</th><th rowspan="2">备注</th>
            </tr>
            <tr>
              <th>核价生产工价</th><th>供应商外发价</th><th>外发单价</th><th>扣税点1.13后单价</th><th>占比</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in rows" :key="i">
              <td v-if="r.workshopSpan" :rowspan="r.workshopSpan">{{ r.workshop || '-' }}</td>
              <td v-if="r.factorySpan" :rowspan="r.factorySpan">{{ r.factory || '-' }}</td>
              <td v-if="r.categorySpan" :rowspan="r.categorySpan">{{ r.category || '-' }}</td>
              <td>{{ r.item_no || '-' }}</td>
              <td>{{ r.product || '-' }}</td>
              <td>{{ num(r.quote_labor_price) }}</td>
              <td>{{ num(r.supplier_price) }}</td>
              <td>{{ num(r.unit_price) }}</td>
              <td>{{ num(r.after_tax) }}</td>
              <td>{{ pct(r.ratio_pct) }}</td>
              <td>{{ num(r.manager_rating) }}</td>
              <td>{{ r.notes || '-' }}</td>
            </tr>
            <tr v-if="!rows.length"><td colspan="12" class="hint" style="text-align:center">该部门暂无数据</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </AppLayout>
</template>
<style scoped>
.wide { max-width: none; }
.back { font-size: .9rem; }
.scroll { overflow-x: auto; }
.stats { min-width: 1100px; }
.stats th, .stats td { text-align: left; white-space: nowrap; }
</style>
```

- [ ] **Step 2: 类型检查**

Run: `npx vue-tsc -b --force; echo "EXIT_CODE=$?"`
Expected: `EXIT_CODE=0`

- [ ] **Step 3: Commit**

```bash
git add src/views/PriceStatsView.vue
git commit -m "feat(price-stats): per-dept stats table view with Excel export

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: 部门卡片页 + 路由 + 侧边栏菜单

**Files:**
- Create: `src/views/PriceStatsDeptsView.vue`
- Modify: `src/router/index.ts`
- Modify: `src/components/AppLayout.vue:29`(在「汇总表」菜单项后插入)

**Interfaces:**
- Consumes: `useOrdersStore`、`visibleCraft` from `../utils/permissions`、`type Craft`、`PriceStatsView`(Task 3)。
- Produces: 路由 `/price-stats`、`/price-stats/dept/:craft`;侧边栏入口。

- [ ] **Step 1: 写部门卡片页**

`src/views/PriceStatsDeptsView.vue`:

```vue
<script setup lang="ts">
import { onMounted, computed } from 'vue'
import { RouterLink } from 'vue-router'
import AppLayout from '../components/AppLayout.vue'
import { useOrdersStore } from '../stores/orders'
import { useAuthStore } from '../stores/auth'
import { visibleCraft } from '../utils/permissions'
import type { Craft } from '../constants/roles'

const orders = useOrdersStore()
const auth = useAuthStore()

onMounted(() => orders.fetchAll())

const DEPTS: { craft: Craft; name: string; icon: string }[] = [
  { craft: 'injection', name: '注塑部', icon: '🧩' },
  { craft: 'painting', name: '喷油部', icon: '🎨' },
  { craft: 'assembly', name: '装配部', icon: '🔧' },
  { craft: 'sewing', name: '车缝部', icon: '🧵' },
]
const mine = computed(() => (auth.role ? visibleCraft(auth.role) : null))
const cards = computed(() =>
  DEPTS.filter((d) => !mine.value || d.craft === mine.value).map((d) => ({
    ...d,
    count: orders.items.filter((o) => o.expand?.factory?.craft === d.craft).length,
  })),
)
</script>
<template>
  <AppLayout>
    <div class="page">
      <div class="toolbar">
        <h2 style="margin:0">产品单价统计</h2>
        <span class="muted">共 {{ cards.length }} 个部门</span>
      </div>
      <div class="dept-grid">
        <RouterLink v-for="c in cards" :key="c.craft" class="dept-card" :to="`/price-stats/dept/${c.craft}`">
          <span class="ico">{{ c.icon }}</span>
          <div class="info">
            <span class="name">{{ c.name }}</span>
            <span class="sub">{{ c.count }} 条产品</span>
          </div>
          <span class="arrow">→</span>
        </RouterLink>
      </div>
    </div>
  </AppLayout>
</template>
<style scoped>
.dept-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 1rem; }
.dept-card {
  display: flex; align-items: center; gap: 1rem; text-decoration: none; color: var(--text);
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
  padding: 1.25rem 1.4rem; box-shadow: var(--shadow); transition: all .15s ease;
}
.dept-card:hover { border-color: var(--primary-border); transform: translateY(-2px); box-shadow: 0 10px 24px -12px rgba(79,70,229,.45); }
.ico { width: 52px; height: 52px; display: grid; place-items: center; font-size: 1.6rem; background: var(--primary-soft); border-radius: 14px; }
.info { display: flex; flex-direction: column; flex: 1; }
.name { font-size: 1.1rem; font-weight: 600; }
.sub { font-size: .85rem; color: var(--text-soft); }
.arrow { color: var(--text-faint); font-size: 1.2rem; }
</style>
```

- [ ] **Step 2: 加路由**

在 `src/router/index.ts` 的 `{ path: '/summary', ... }` 行之前插入两行:

```ts
  { path: '/price-stats', component: () => import('../views/PriceStatsDeptsView.vue') },
  { path: '/price-stats/dept/:craft', component: () => import('../views/PriceStatsView.vue') },
```

- [ ] **Step 3: 加侧边栏菜单**

在 `src/components/AppLayout.vue` 的
`<RouterLink to="/summary">汇总表</RouterLink>` 行之前插入:

```html
          <RouterLink to="/price-stats">产品单价统计</RouterLink>
```

- [ ] **Step 4: 类型检查**

Run: `npx vue-tsc -b --force; echo "EXIT_CODE=$?"`
Expected: `EXIT_CODE=0`

- [ ] **Step 5: Commit**

```bash
git add src/views/PriceStatsDeptsView.vue src/router/index.ts src/components/AppLayout.vue
git commit -m "feat(price-stats): dept cards page, routes and sidebar menu

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: 新字段录入入口(新增下单 + 订单详情)

**Files:**
- Modify: `src/views/OrderFormView.vue`(数量字段附近)
- Modify: `src/views/OrderDetailView.vue`(加「价格信息」可编辑区)

**Interfaces:**
- Consumes: `draft: Partial<Order>`(已有)、`useOrdersStore().update`、详情页已有的 `order`、`id`、`pb`。
- Produces: 无对外接口,仅录入 `supplier_price`、`process_category`(及顺带可改 `quote_labor_price`、`unit_price`)。

- [ ] **Step 1: 新增下单表单加 2 字段**

在 `src/views/OrderFormView.vue` 中 `数量` 那一行之后插入(`draft` 已是 `Partial<Order>`):

```html
          <label>加工类别 <input v-model="draft.process_category" placeholder="如塑胶半成品" /></label>
          <label>供应商外发价 <input v-model.number="draft.supplier_price" type="number" min="0" step="0.01" /></label>
```

- [ ] **Step 2: 订单详情页加「价格信息」可编辑区**

在 `src/views/OrderDetailView.vue` 的 `<script setup>` 内,`form`(生产进度)定义之后新增价格表单与保存函数:

```ts
const price = reactive({
  quote_labor_price: null as number | null,
  unit_price: null as number | null,
  supplier_price: null as number | null,
  process_category: '',
})
const priceSaving = ref(false)
const priceSaved = ref(false)

function initPrice(o: Order) {
  price.quote_labor_price = o.quote_labor_price ?? null
  price.unit_price = o.unit_price ?? null
  price.supplier_price = o.supplier_price ?? null
  price.process_category = o.process_category ?? ''
}

async function savePrice() {
  priceSaving.value = true
  priceSaved.value = false
  await orders.update(id.value, {
    quote_labor_price: num(price.quote_labor_price),
    unit_price: num(price.unit_price),
    supplier_price: num(price.supplier_price),
    process_category: price.process_category,
  })
  priceSaving.value = false
  priceSaved.value = true
}
```

在 `onMounted` 内、设置生产进度 `form.*` 之后,追加一行 `initPrice(o)`:

```ts
  form.delay_reason = o.delay_reason ?? ''
  initPrice(o)
```

(`reactive`、`ref`、`num`、`orders`、`id`、`Order` 均已在该文件中导入/定义;`num` 为已存在的空值归一辅助函数。)

- [ ] **Step 3: 价格信息区模板**

在 `OrderDetailView.vue` 模板中,「订单信息」`<section>` 之后、「生产进度」`<section>` 之前插入:

```html
      <section class="card" v-if="order">
        <h3 class="sec-title">价格信息</h3>
        <form class="prog-form" @submit.prevent="savePrice">
          <label>加工类别 <input v-model="price.process_category" placeholder="如塑胶半成品" /></label>
          <label>核价生产工价 <input v-model.number="price.quote_labor_price" type="number" min="0" step="0.01" /></label>
          <label>供应商外发价 <input v-model.number="price.supplier_price" type="number" min="0" step="0.01" /></label>
          <label>外发单价 <input v-model.number="price.unit_price" type="number" min="0" step="0.01" /></label>
          <div class="actions">
            <button type="submit" :disabled="priceSaving">{{ priceSaving ? '保存中…' : '保存' }}</button>
            <span v-if="priceSaved" class="ok">已保存 ✓</span>
          </div>
        </form>
      </section>
```

(复用该文件已有的 `.prog-form` / `.actions` / `.ok` / `.sec-title` 样式,无需新增 CSS。)

- [ ] **Step 4: 类型检查**

Run: `npx vue-tsc -b --force; echo "EXIT_CODE=$?"`
Expected: `EXIT_CODE=0`

- [ ] **Step 5: 手动验证一遍数据流**

Run:(确保 PB 与 Vite 在跑)
```bash
lsof -iTCP:8091 -sTCP:LISTEN -n -P >/dev/null && echo "PB up"
lsof -iTCP:5173 -sTCP:LISTEN -n -P >/dev/null && echo "Vite up"
```
手动:订单详情页填「加工类别/供应商外发价」并保存 → 打开 `/price-stats/dept/:craft` → 该产品出现在对应车间/加工厂分组下 → 点「导出 Excel」检查表头分组与合并单元格。
Expected: 统计表与导出均显示新填的加工类别、供应商外发价,占比按 `xx.x%` 显示。

- [ ] **Step 6: Commit**

```bash
git add src/views/OrderFormView.vue src/views/OrderDetailView.vue
git commit -m "feat(orders): entry points for supplier_price and process_category

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- 数据源(orders 派生)→ Task 2/3 ✓
- 新字段 supplier_price/process_category → Task 1(库)、Task 5(录入)✓
- 计算口径(扣税点/占比)→ Task 2 函数 + 测试 ✓
- 按部门导航 → Task 4(卡片+路由+菜单)✓
- 统计表展示(分组合并)→ Task 3(rowspan)✓
- Excel 导出(标题/两级表头/价格管理组/纵向合并/文件名)→ Task 3 ✓
- 录入位置(新增下单 + 详情页,不进宽表)→ Task 5 ✓
- 占比百分比显示 → Task 3 `pct()` / 导出 `+ '%'` ✓

**类型一致性:** `afterTax`/`ratioPct`/`buildPriceStatsRows`/`PriceStatsRow` 在 Task 2 定义,Task 3 按同名同签名引用 ✓;`num()` 为 OrderDetailView 既有函数,Task 5 复用 ✓。

**占位扫描:** 无 TBD/TODO,代码步骤均为完整代码 ✓。
