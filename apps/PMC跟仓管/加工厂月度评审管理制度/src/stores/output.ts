import { defineStore } from 'pinia'
import { ref } from 'vue'
import { pb } from '../pb'
import type { MonthlyOutput } from '../types/output'
import { canViewCraft } from '../utils/permissions'
import type { Craft } from '../constants/roles'

export const useOutputStore = defineStore('output', () => {
  const items = ref<MonthlyOutput[]>([])

  async function fetchByMonth(yearMonth: string) {
    const records = await pb.collection('monthly_output').getFullList<MonthlyOutput>({
      filter: `year_month = "${yearMonth}"`,
      expand: 'factory',
      sort: 'factory',
    })
    items.value = records.filter((item) => {
      const craft = (item as any).expand?.factory?.craft as Craft | undefined
      return !craft || canViewCraft(craft)
    })
  }
  async function upsert(data: Partial<MonthlyOutput>) {
    // 依赖唯一索引 (factory, year_month)：存在则更新，否则创建
    const existing = data.factory && data.year_month
      ? await pb.collection('monthly_output').getFullList<MonthlyOutput>({
          filter: `factory = "${data.factory}" && year_month = "${data.year_month}"`,
        })
      : []
    if (existing.length) return pb.collection('monthly_output').update(existing[0].id, data)
    return pb.collection('monthly_output').create(data)
  }
  return { items, fetchByMonth, upsert }
})
