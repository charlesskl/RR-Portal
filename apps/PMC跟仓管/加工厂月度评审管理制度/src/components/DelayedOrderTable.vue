<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { buildDelayedSections } from '../utils/delayedOrders'
import { paginateDeliveryReport } from '../utils/deliveryReportPagination'
const props = defineProps<{ section: ReturnType<typeof buildDelayedSections>[number]; regionName: string }>()
const page = ref(1)
watch(() => props.section, () => { page.value = 1 })
const paged = computed(() => paginateDeliveryReport(props.section.rows, page.value, 100))
const currency = computed(() => props.section.pricingMode === 'hunan-rmb-tax' ? '人民币含税' : props.section.pricingMode === 'rmb-tax' ? '不含税RMB' : '港币不含税$')
const headers = computed(() => ['范围', '下单PMC', '加工厂', '货号', '订单号', '加工类别', '物料名称', '数量', '下单时间', '下单交货时间', '实际交货时间', '延迟时间', '订单总单数', '延期单数', '占比', '延期平均天数', `核价工价(${currency.value})`, `外发工价(${currency.value})`, '占比', '备注'])
const subtotalQuantities = computed(() => {
  const map = new Map<string, number | null | undefined>()
  let last = ''
  props.section.rows.forEach((r, i) => { if (r.kind === 'detail') last = r.id; else map.set(`subtotal:${last}`, props.section.quantities[i]) })
  return map
})
const date = (value: string) => value.replaceAll('-', '/')
const price = (value: number) => value ? value.toFixed(props.section.pricingMode !== 'hkd' && props.section.pricingMode !== 'hkd-tax' ? 2 : 3) : ''
</script>
<template>
  <section class="department-report">
    <h3>{{ regionName }}厂区 · {{ section.name }}</h3>
    <p v-if="!section.count" class="empty">该部门暂无延期订单</p>
    <template v-else>
      <div class="table-scroll" tabindex="0" :aria-label="`${section.name}延期订单表格，可横向滚动`">
        <table class="delay-report">
          <caption>{{ regionName }}厂区—{{ section.name }}—外发加工厂交货及价格统计表（延期订单）</caption>
          <thead><tr><th v-for="(h, i) in headers" :key="i" :class="{ yellow: ![0, 1, 4, 8, 19].includes(i), ratio: i === 14 || i === 18 }">{{ h }}</th></tr></thead>
          <tbody>
            <template v-for="r in paged.rows" :key="r.pageKey">
              <tr v-if="r.kind === 'detail'">
                <td v-if="r.rangeSpan" :rowspan="r.rangeSpan">{{ r.range }}</td>
                <td v-if="r.pmcSpan" :rowspan="r.pmcSpan">{{ r.pmc }}</td>
                <td v-if="r.factorySpan" :rowspan="r.factorySpan">{{ r.factory }}</td>
                <td>{{ r.item_no }}</td><td>{{ r.order_no }}</td><td>{{ r.category }}</td><td>{{ r.product }}</td><td>{{ r.quantity }}</td>
                <td>{{ date(r.order_date) }}</td><td>{{ date(r.delivery_date) }}</td><td>{{ date(r.actual_delivery_date) || '—' }}</td><td>{{ r.delay_days }}</td>
                <td class="stat">{{ r.orderCount }}</td><td class="stat">{{ r.delayedCount }}</td><td class="stat ratio">{{ r.delayRatio }}</td><td class="stat">{{ r.delayAvg }}</td>
                <td class="price">{{ price(r.quote) }}</td><td class="price">{{ price(section.pricingMode === 'hunan-rmb-tax' ? r.outPriceCnyTax : r.outPrice) }}</td><td class="price ratio">{{ r.priceRatio }}</td><td class="notes">{{ r.notes }}</td>
              </tr>
              <tr v-else class="subtotal">
                <td>{{ r.factory }}</td><td>小计：</td><td colspan="3"></td><td>{{ subtotalQuantities.get(r.pageKey) }}</td><td colspan="4"></td>
                <td>{{ r.orderCount }}</td><td>{{ r.delayedCount }}</td><td>{{ r.delayRatio }}</td><td class="stat">{{ r.delayAvg }}</td>
                <td class="price">{{ price(r.quote) }}</td><td class="price">{{ price(section.pricingMode === 'hunan-rmb-tax' ? r.outPriceCnyTax : r.outPrice) }}</td><td class="price">{{ r.priceRatio }}</td><td></td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
      <div class="pagination"><span>共 {{ paged.total }} 条延期明细 · {{ paged.page }} / {{ paged.pageCount }} 页</span><button class="ghost mini" :disabled="paged.page <= 1" @click="page--">上一页</button><button class="ghost mini" :disabled="paged.page >= paged.pageCount" @click="page++">下一页</button></div>
    </template>
  </section>
</template>
<style scoped>
.department-report { margin-top: 24px; }
h3 { font-size: 16px; margin-bottom: 12px; }
.empty { padding: 24px; background: white; border: 1px solid #e2e5eb; color: #737b8c; }
.table-scroll { overflow: auto; max-height: 70vh; background: white; border: 1px solid #a5a5a5; }
.delay-report { border-collapse: separate; border-spacing: 0; width: 100%; min-width: 2200px; color: #111; font-size: 13px; }
caption { font-size: 20px; font-weight: 700; padding: 12px; color: #111; background: #fff; }
.delay-report th, .delay-report td { border-right: 1px solid #999; border-bottom: 1px solid #999; padding: 6px 8px; text-align: center; white-space: nowrap; }
.delay-report th { position: sticky; top: 0; z-index: 1; background: white; color: #111; font-weight: 700; }
.delay-report th.yellow { background: #ffff00; }
.delay-report .stat { background: #e2efd9; }
.delay-report .price { background: #fff2cc; }
.delay-report .ratio, .delay-report .subtotal { color: #ff2020; font-weight: 700; }
.delay-report .notes { white-space: normal; min-width: 320px; text-align: left; }
.pagination { display: flex; align-items: center; justify-content: flex-end; gap: 12px; padding: 12px 0; font-size: 13px; }
</style>
