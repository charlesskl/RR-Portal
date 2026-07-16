import { defineStore } from 'pinia'
import { ref } from 'vue'
import { pb } from '../pb'
import type { ReviewMeeting } from '../types/review'

export const useReviewsStore = defineStore('reviews', () => {
  const current = ref<ReviewMeeting | null>(null)

  async function fetchByMonth(yearMonth: string) {
    const r = await pb.collection('review_meetings').getFullList<ReviewMeeting>({
      filter: `year_month = "${yearMonth}"`,
    })
    current.value = r[0] ?? null
    return current.value
  }
  async function save(yearMonth: string, data: Partial<ReviewMeeting>) {
    const existing = await fetchByMonth(yearMonth)
    if (existing) return pb.collection('review_meetings').update(existing.id, data)
    return pb.collection('review_meetings').create({ year_month: yearMonth, status: 'draft', ...data })
  }
  return { current, fetchByMonth, save }
})
