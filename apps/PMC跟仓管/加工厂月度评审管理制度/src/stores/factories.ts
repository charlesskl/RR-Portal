import { defineStore } from 'pinia'
import { ref } from 'vue'
import { pb } from '../pb'
import type { Factory } from '../types/factory'
import type { Craft } from '../constants/roles'
import { canViewCraft } from '../utils/permissions'

export function filterByCraft(list: Factory[], craft: Craft | null): Factory[] {
  if (!craft) return list
  return list.filter((f) => f.craft === craft)
}

export const useFactoriesStore = defineStore('factories', () => {
  const items = ref<Factory[]>([])
  const loading = ref(false)

  async function fetchAll() {
    loading.value = true
    try {
      const records = await pb.collection('factories').getFullList<Factory>({ sort: 'name' })
      items.value = records.filter((factory) => canViewCraft(factory.craft))
    } finally {
      loading.value = false
    }
  }
  async function get(id: string) {
    const factory = await pb.collection('factories').getOne<Factory>(id)
    if (!canViewCraft(factory.craft)) throw new Error('无权访问该部门')
    return factory
  }
  async function create(data: Partial<Factory> | FormData) {
    return pb.collection('factories').create<Factory>(data)
  }
  async function update(id: string, data: Partial<Factory> | FormData) {
    return pb.collection('factories').update<Factory>(id, data)
  }
  async function remove(id: string) {
    return pb.collection('factories').delete(id)
  }
  return { items, loading, fetchAll, get, create, update, remove }
})
