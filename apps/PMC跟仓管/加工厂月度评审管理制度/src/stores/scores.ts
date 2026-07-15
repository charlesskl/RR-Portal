import { defineStore } from 'pinia'
import { ref } from 'vue'
import { pb } from '../pb'
import type { MonthlyScore } from '../types/score'
import { canViewCraft } from '../utils/permissions'
import type { Craft } from '../constants/roles'

export const useScoresStore = defineStore('scores', () => {
  const items = ref<MonthlyScore[]>([])

  async function fetchByMonth(yearMonth: string) {
    const records = await pb.collection('monthly_scores').getFullList<MonthlyScore>({
      filter: `year_month = "${yearMonth}"`,
      expand: 'factory',
    })
    items.value = records.filter((item) => {
      const craft = (item as any).expand?.factory?.craft as Craft | undefined
      return !craft || canViewCraft(craft)
    })
  }
  async function getOne(factoryId: string, yearMonth: string): Promise<MonthlyScore | null> {
    const r = await pb.collection('monthly_scores').getFullList<MonthlyScore>({
      filter: `factory = "${factoryId}" && year_month = "${yearMonth}"`,
    })
    return r[0] ?? null
  }
  async function save(factoryId: string, yearMonth: string, data: Partial<MonthlyScore>) {
    const existing = await getOne(factoryId, yearMonth)
    if (existing) return pb.collection('monthly_scores').update(existing.id, data)
    return pb.collection('monthly_scores').create({
      factory: factoryId, year_month: yearMonth, status: 'draft', flag: 'none', ...data,
    })
  }
  return { items, fetchByMonth, getOne, save }
})
