import { defineStore } from 'pinia'
import { ref } from 'vue'
import { pb } from '../pb'
import type { ScoreTemplate } from '../types/score'

export const useScoreTemplatesStore = defineStore('scoreTemplates', () => {
  const items = ref<ScoreTemplate[]>([])

  async function fetchAll() {
    items.value = await pb.collection('score_templates').getFullList<ScoreTemplate>({
      sort: 'sort_order',
    })
  }
  // 取适用某工艺的启用项：通用项(craft_filter 空) + 该工艺专项
  function applicable(craft: string): ScoreTemplate[] {
    return items.value.filter(
      (t) => t.is_active && (!t.craft_filter || t.craft_filter === craft),
    )
  }
  async function create(data: Partial<ScoreTemplate>) {
    return pb.collection('score_templates').create(data)
  }
  async function update(id: string, data: Partial<ScoreTemplate>) {
    return pb.collection('score_templates').update(id, data)
  }
  async function remove(id: string) {
    return pb.collection('score_templates').delete(id)
  }
  return { items, fetchAll, applicable, create, update, remove }
})
