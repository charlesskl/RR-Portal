import { defineStore } from 'pinia'
import { ref } from 'vue'
import { pb } from '../pb'
import type { KpiLog } from '../types/kpi'

export const useKpiStore = defineStore('kpi', () => {
  const items = ref<KpiLog[]>([])
  async function fetchByMonth(targetMonth: string) {
    items.value = await pb.collection('kpi_logs').getFullList<KpiLog>({
      filter: `target_month = "${targetMonth}"`,
      expand: 'user',
      sort: 'user',
    })
  }
  return { items, fetchByMonth }
})
