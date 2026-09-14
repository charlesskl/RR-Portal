<script setup lang="ts">
import { onMounted, computed, ref } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import * as XLSX from 'xlsx'
import AppLayout from '../components/AppLayout.vue'
import { useOrdersStore } from '../stores/orders'
import { useFactoriesStore } from '../stores/factories'
import { CRAFT_LABELS, REGION_LABELS, type Craft, type Region } from '../constants/roles'
import { allowedRegions } from '../utils/permissions'
import { useAuthStore } from '../stores/auth'
import { buildPriceStatsRows, type PriceStatsRow } from '../utils/priceStats'
import { isPercentOver100 } from '../utils/percentage'
import { canEditOrders } from '../utils/permissions'
import { matchPriceImportRows, parsePriceStatsExcel } from '../utils/priceStatsExcelImport'
import { factoryTaxPointFactors, taxPointFactor } from '../utils/taxPoint'
import { useTableColumnPreferences } from '../composables/useTableColumnPreferences'
import { orderRegion } from '../utils/orderRegion'

const route = useRoute()
const orders = useOrdersStore()
const factories = useFactoriesStore()
const auth = useAuthStore()
const myRegions = computed(() => (auth.role ? allowedRegions(auth.role) : null))
const fileInput = ref<HTMLInputElement | null>(null)
const importing = ref(false)
const canImport = computed(() => !!auth.role && canEditOrders(auth.role))
const searchKeyword = ref('')

const craft = computed(() => route.params.craft as Craft)
const region = computed(() => (route.query.region as Region) || null)
const deptName = computed(() =>
  (region.value ? REGION_LABELS[region.value] + '厂区 · ' : '') + (CRAFT_LABELS[craft.value] ?? '部门'))
const isSewing = computed(() => craft.value === 'sewing')
const isHunan = computed(() => region.value === 'hunan')
const showTaxPoint = computed(() => isHunan.value || isSewing.value)
const showMoldNumber = computed(() => craft.value === 'injection')

const priceHeaders = computed(() => isHunan.value
  ? [isSewing.value ? '核价工价(不含税RMB)' : '核价生产工价', isSewing.value ? '外发工价(人民币含税)' : '外发单价', '税点', '占比']
  : isSewing.value
  ? ['核价工价(不含税RMB)', '外发工价(人民币含税)', '税点', '扣税点后单价', '占比']
  : ['核价生产工价', '外发单价', '扣税点1.13后单价', '占比'])

const tableColumns = [
  { key: 'workshop', label: '车间', width: 100 },
  { key: 'factory', label: '加工厂名称', width: 190 },
  { key: 'category', label: '加工类别', width: 120 },
  { key: 'itemNo', label: '货号', width: 180, hideable: false },
  ...(showMoldNumber.value ? [{ key: 'moldNo', label: '模具编号', width: 180 }] : []),
  { key: 'product', label: '配件名称/模号', width: 220 },
  { key: 'quotePrice', label: isSewing.value ? '核价工价(不含税RMB)' : '核价生产工价', width: 180 },
  { key: 'unitPrice', label: isSewing.value ? '外发工价(人民币含税)' : '外发单价', width: 180 },
  ...(showTaxPoint.value ? [{ key: 'taxPoint', label: '税点', width: 100 }] : []),
  ...(!isHunan.value ? [{ key: 'afterTax', label: isSewing.value ? '扣税点后单价' : '扣税点1.13后单价', width: 180 }] : []),
  { key: 'ratio', label: '占比', width: 100 },
  { key: 'notes', label: '备注', width: 180 },
]
const { frozenThrough, columnPanelOpen, visibleColumns, isVisible, isFrozen, columnStyle, toggleColumn, showAllColumns } =
  useTableColumnPreferences(`price-stats-table-columns-${craft.value}${isHunan.value ? '-hunan' : ''}`, tableColumns)
const visibleColumnCount = computed(() => visibleColumns.value.length)

onMounted(() => Promise.all([orders.fetchAll(), factories.fetchAll()]))

function linkedFactoryTaxPoint(factoryId: string | null | undefined) {
  return taxPointFactor(factories.items.find((factory) => factory.id === factoryId)?.tax_point)
}
const deliveryTaxPoints = computed(() => factoryTaxPointFactors(factories.items))

const rows = computed<PriceStatsRow[]>(() => {
  const keyword = searchKeyword.value.trim().toLocaleLowerCase()
  const list = orders.items.filter((o) => {
    const matchesKeyword = !keyword || [
      o.expand?.factory?.name,
      o.item_no,
      o.mold_no,
      o.product,
    ].some((value) => String(value ?? '').toLocaleLowerCase().includes(keyword))
    return matchesKeyword
      &&
    o.expand?.factory?.craft === craft.value
    && (!region.value || orderRegion(o) === region.value)
    && (!myRegions.value || myRegions.value.includes(orderRegion(o)))
  })
  return buildPriceStatsRows(
    list,
    (o) => o.expand?.factory?.name ?? '',
    isSewing.value,
    (o) => linkedFactoryTaxPoint(o.factory),
    isHunan.value ? (o) => deliveryTaxPoints.value.get(o.factory) ?? o.exchange_rate ?? null : undefined,
  )
})

const pct = (v: number | null) => (v == null ? '-' : v + '%')
const num = (v: number | null) => (v == null ? '-' : v)

function exportExcel() {
  const title = `${deptName.value}-外发产品单价统计表`
  const detailHeaders = showMoldNumber.value
    ? ['车间', '加工厂名称', '加工类别', '货号', '模具编号', '配件名称/模号']
    : ['车间', '加工厂名称', '加工类别', '货号', '配件名称/模号']
  const priceColumn = detailHeaders.length
  const notesColumn = priceColumn + priceHeaders.value.length
  const columnCount = notesColumn + 1
  // 三行表头
  const titleRow = [title, ...Array(columnCount - 1).fill('')]
  const groupRow = [...detailHeaders, '价格管理',
    ...Array(priceHeaders.value.length - 1).fill(''), '备注']
  const subRow = [...Array(detailHeaders.length).fill(''), ...priceHeaders.value, '']

  const body = rows.value.map((r) => [
    r.workshopSpan ? r.workshop : '',
    r.factorySpan ? r.factory : '',
    r.categorySpan ? r.category : '',
    r.item_no,
    ...(showMoldNumber.value ? [r.mold_no] : []),
    r.product,
    r.quote_labor_price ?? '',
    r.unit_price ?? '',
    ...(showTaxPoint.value ? [r.tax_point ?? ''] : []),
    ...(!isHunan.value ? [r.after_tax ?? ''] : []),
    r.ratio_pct == null ? '' : r.ratio_pct + '%',
    r.notes,
  ])
  const aoa = [titleRow, groupRow, subRow, ...body]
  const ws = XLSX.utils.aoa_to_sheet(aoa)

  // 合并：标题、表头分组、左侧三列纵向合并
  const merges = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: columnCount - 1 } },
    { s: { r: 1, c: priceColumn }, e: { r: 1, c: notesColumn - 1 } },
  ]
  // 表头第 1、2 行：左侧明细列和备注纵向合并
  for (const c of [...detailHeaders.keys(), notesColumn]) merges.push({ s: { r: 1, c }, e: { r: 2, c } })

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

async function importExcel(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || importing.value) return
  importing.value = true
  try {
    const parsed = await parsePriceStatsExcel(file)
    if (!parsed.rows.length) {
      const detail = parsed.unrecognizedSheets.length ? '未识别到“核价工价”表头。' : '没有可导入的有效数据行。'
      alert(`导入失败：${detail}`)
      return
    }
    const visibleOrders = orders.items.filter((o) =>
      o.expand?.factory?.craft === craft.value
      && (!region.value || orderRegion(o) === region.value)
      && (!myRegions.value || myRegions.value.includes(orderRegion(o))))
    const matched = matchPriceImportRows(parsed.rows, visibleOrders)
    if (!matched.updates.length) {
      alert(`未匹配到可更新的记录。\n未匹配 ${matched.unmatchedRows.length} 行，冲突 ${matched.conflictingRows.length} 行，无效 ${parsed.invalidRows} 行。`)
      return
    }
    await Promise.all(matched.updates.map(({ order, quoteLaborPrice }) =>
      orders.update(order.id, { quote_labor_price: quoteLaborPrice })))
    await orders.fetchAll()
    alert(`导入完成：识别 ${parsed.rows.length} 行，成功匹配 ${matched.matchedRows} 行，更新 ${matched.updates.length} 条系统记录。\n未匹配 ${matched.unmatchedRows.length} 行，冲突 ${matched.conflictingRows.length} 行，无效 ${parsed.invalidRows} 行。`)
  } catch (error) {
    console.error('核价 Excel 导入失败', error)
    alert('导入失败：请确认文件是有效的 Excel，且包含货号、工序名称和核价生产工价（不含税￥）列。')
  } finally {
    importing.value = false
    input.value = ''
  }
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
        <input v-model="searchKeyword" class="price-search" type="search"
          placeholder="搜索加工厂/货号/模具编号/配件名称" aria-label="搜索加工厂、货号、模具编号或配件名称" />
        <label class="freeze-control">冻结至
          <select v-model="frozenThrough" class="column-select">
            <option value="">不冻结列</option>
            <option v-for="column in visibleColumns" :key="column.key" :value="column.key">{{ column.label }}</option>
          </select>
        </label>
        <div class="column-menu">
          <button class="ghost" @click="columnPanelOpen = !columnPanelOpen">栏目显示</button>
          <div v-if="columnPanelOpen" class="column-panel">
            <div class="column-panel-head"><b>显示/隐藏栏目</b><button class="link-btn" @click="showAllColumns">全部显示</button></div>
            <label v-for="column in tableColumns.filter(c => c.hideable !== false)" :key="column.key">
              <input type="checkbox" :checked="isVisible(column.key)" @change="toggleColumn(column.key)" /> {{ column.label }}
            </label>
          </div>
        </div>
        <button v-if="canImport" class="ghost" :disabled="importing" @click="fileInput?.click()">
          {{ importing ? '导入中…' : '导入 Excel' }}
        </button>
        <input ref="fileInput" type="file" accept=".xlsx,.xls,.csv" style="display:none" @change="importExcel" />
        <button @click="exportExcel">导出 Excel</button>
      </div>
      <div class="scroll" tabindex="0" aria-label="单价统计表格滚动区域">
        <table class="stats">
          <thead>
            <tr>
              <th v-for="column in visibleColumns" :key="column.key"
                :class="{
                  frozen: isFrozen(column.key),
                  'freeze-edge': frozenThrough === column.key,
                  'item-no-col': column.key === 'itemNo',
                  'wrap-col': column.key === 'product' || column.key === 'notes',
                }"
                :style="columnStyle(column.key)">{{ column.label }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in rows" :key="i">
              <td v-if="isVisible('workshop') && r.workshopSpan" :rowspan="r.workshopSpan" :class="{ frozen: isFrozen('workshop'), 'freeze-edge': frozenThrough === 'workshop' }" :style="columnStyle('workshop')">{{ r.workshop || '-' }}</td>
              <td v-if="isVisible('factory') && r.factorySpan" :rowspan="r.factorySpan" :class="{ frozen: isFrozen('factory'), 'freeze-edge': frozenThrough === 'factory' }" :style="columnStyle('factory')">{{ r.factory || '-' }}</td>
              <td v-if="isVisible('category') && r.categorySpan" :rowspan="r.categorySpan" :class="{ frozen: isFrozen('category'), 'freeze-edge': frozenThrough === 'category' }" :style="columnStyle('category')">{{ r.category || '-' }}</td>
              <td class="item-no-col" :class="{ frozen: isFrozen('itemNo'), 'freeze-edge': frozenThrough === 'itemNo' }" :style="columnStyle('itemNo')">{{ r.item_no || '-' }}</td>
              <td v-if="showMoldNumber && isVisible('moldNo')" :class="{ frozen: isFrozen('moldNo'), 'freeze-edge': frozenThrough === 'moldNo' }" :style="columnStyle('moldNo')">{{ r.mold_no || '-' }}</td>
              <td v-if="isVisible('product')" class="wrap-col" :class="{ frozen: isFrozen('product'), 'freeze-edge': frozenThrough === 'product' }" :style="columnStyle('product')">{{ r.product || '-' }}</td>
              <td v-if="isVisible('quotePrice')" :class="{ frozen: isFrozen('quotePrice'), 'freeze-edge': frozenThrough === 'quotePrice' }" :style="columnStyle('quotePrice')">{{ num(r.quote_labor_price) }}</td>
              <td v-if="isVisible('unitPrice')" :class="{ frozen: isFrozen('unitPrice'), 'freeze-edge': frozenThrough === 'unitPrice' }" :style="columnStyle('unitPrice')">{{ num(r.unit_price) }}</td>
              <td v-if="showTaxPoint && isVisible('taxPoint')" :class="{ frozen: isFrozen('taxPoint'), 'freeze-edge': frozenThrough === 'taxPoint' }" :style="columnStyle('taxPoint')">{{ num(r.tax_point) }}</td>
              <td v-if="!isHunan && isVisible('afterTax')" :class="{ frozen: isFrozen('afterTax'), 'freeze-edge': frozenThrough === 'afterTax' }" :style="columnStyle('afterTax')">{{ num(r.after_tax) }}</td>
              <td v-if="isVisible('ratio')" :class="{ 'over-limit': isPercentOver100(r.ratio_pct), frozen: isFrozen('ratio'), 'freeze-edge': frozenThrough === 'ratio' }" :style="columnStyle('ratio')">{{ pct(r.ratio_pct) }}</td>
              <td v-if="isVisible('notes')" class="wrap-col" :class="{ frozen: isFrozen('notes'), 'freeze-edge': frozenThrough === 'notes' }" :style="columnStyle('notes')">{{ r.notes || '-' }}</td>
            </tr>
            <tr v-if="!rows.length"><td :colspan="visibleColumnCount" class="hint" style="text-align:center">该部门暂无数据</td></tr>

          </tbody>
        </table>
      </div>
    </div>
  </AppLayout>
</template>
<style scoped>
.wide {
  width: 100%;
  min-width: 0;
  max-width: none;
  height: calc(100vh - 106px);
  height: calc(100dvh - 106px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.back { font-size: .9rem; }
.toolbar {
  position: relative;
  z-index: 9;
  flex: 0 0 auto;
  margin: -.35rem 0 1rem;
  padding: .35rem 0;
  background: var(--bg);
  flex-wrap: wrap;
}
.scroll {
  position: relative;
  flex: 1 1 auto;
  width: 100%;
  min-width: 0;
  min-height: 0;
  max-width: 100%;
  overflow: auto;
  overscroll-behavior: contain;
  isolation: isolate;
}
.stats {
  width: max-content;
  min-width: 100%;
  table-layout: fixed;
  /* 全局 table 的 overflow:hidden 会成为 sticky 的错误包含块，导致冻结列跟随滚动。 */
  overflow: visible;
}
.stats th, .stats td { text-align: left; white-space: nowrap; }
.stats thead th { position: sticky; top: 0; z-index: 3; background: #fafbfc; }
.stats .frozen { position: sticky; z-index: 2; background: var(--surface); }
.stats thead .frozen { z-index: 5; background: #fafbfc; }
.stats .freeze-edge { box-shadow: 5px 0 7px -7px rgba(31, 37, 51, .55); }
.stats .item-no-col {
  width: 180px;
  min-width: 180px;
  max-width: 180px;
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.stats .wrap-col {
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
  line-height: 1.45;
}

.stats .over-limit { color: #dc2626; font-weight: 600; }
.price-search { width: min(320px, 36vw); }
.freeze-control { display: flex; align-items: center; gap: .35rem; color: var(--text-soft); font-size: .85rem; white-space: nowrap; }
.column-select { height: 36px; max-width: 190px; padding: 0 .55rem; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); }
.column-menu { position: relative; }
.column-panel { position: absolute; top: calc(100% + .4rem); right: 0; z-index: 20; width: 310px; max-height: 430px; overflow: auto; padding: .75rem; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); box-shadow: var(--shadow); display: grid; gap: .45rem; }
.column-panel label { display: flex; align-items: flex-start; gap: .45rem; font-size: .84rem; }
.column-panel-head { display: flex; justify-content: space-between; align-items: center; padding-bottom: .35rem; border-bottom: 1px solid var(--border); }
.link-btn { padding: 0; border: 0; background: transparent; color: var(--primary); font-size: .82rem; }
</style>
