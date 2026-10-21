<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { usePatrolDialog } from '../composables/usePatrolDialog'
import type { DeliveryReminderItem } from '../utils/deliveryReminder'
defineProps<{ items: DeliveryReminderItem[]; today: string; hasMore: boolean }>()
const emit = defineEmits<{ later: []; register: [item: DeliveryReminderItem] }>()
const { setDialog, keydown } = usePatrolDialog(() => emit('later'))
</script>
<template>
  <div class="delivery-overlay"><section :ref="setDialog" class="delivery-dialog" role="dialog" aria-modal="true" aria-labelledby="delivery-reminder-title" tabindex="-1" @keydown="keydown">
    <header><h3 id="delivery-reminder-title">交期已到，请登记交付情况</h3><button @click="emit('later')">一小时后提醒</button></header>
    <p>以下订单已到约定交期，尚未登记交付。已交付的请补录实际交货时间；未交付的请在原订单更新延期原因和进度。</p>
    <p v-if="hasMore">待核实记录较多，先显示最近到期的500条，处理后会继续显示其余记录。</p>
    <div class="delivery-scroll"><table><thead><tr><th>工厂 / 订单</th><th>产品</th><th>约定交期</th><th>登记</th></tr></thead><tbody><tr v-for="item in items" :key="item.id">
      <td>{{ item.factoryName }}<small>{{ item.orderNo || item.id }}</small></td><td>{{ item.product }}</td><td>{{ item.dueDate }}<small>{{ item.dueDate === today ? '今天到期' : '已过交期，待核实' }}</small></td>
      <td><RouterLink :to="{ path: `/orders/dept/${item.craft}/${item.id}`, query: { region: item.region, reminder: 'delivery' } }" @click="emit('register', item)">去登记交付情况</RouterLink></td>
    </tr></tbody></table></div>
    <p class="hint">逾期不等于未交付，请核实实际情况。登记实际交货时间或订单标记已交付后，将停止提醒。</p>
  </section></div>
</template>
<style scoped>
.delivery-overlay { position: fixed; inset: 0; z-index: 1100; background: #17203380; display: grid; place-items: center; padding: 16px; }
.delivery-dialog { width: min(1000px, 100%); max-height: 90vh; overflow: auto; padding: 24px; border-radius: 14px; background: #fff; }
header { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; } h3 { margin: 0; }
p { margin: 14px 0; line-height: 1.6; } .delivery-scroll { max-height: 55vh; overflow: auto; } table { min-width: 640px; width: 100%; } th, td { padding: 12px; text-align: left; } small { display: block; color: #667085; margin-top: 6px; } .hint { color: #667085; }
button { background: white; color: #202635; border: 1px solid #cbd0dc; padding: 10px 14px; border-radius: 6px; }
@media (max-width: 650px) {
  .delivery-dialog { padding: 18px; }
  .delivery-scroll table, .delivery-scroll tbody, .delivery-scroll tr, .delivery-scroll td { display: block; width: 100%; min-width: 0; }
  .delivery-scroll thead { display: none; }
  .delivery-scroll tr { padding: 10px 0; border-bottom: 1px solid #e4e7ec; }
  .delivery-scroll td { padding: 5px 10px; }
  .delivery-scroll td:nth-child(2)::before { content: '产品：'; }
  .delivery-scroll td:nth-child(3)::before { content: '约定交期：'; }
  .delivery-scroll td a { display: inline-block; padding: 8px 0; }
}
</style>
