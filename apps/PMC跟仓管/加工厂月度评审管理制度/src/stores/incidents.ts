import { defineStore } from 'pinia'
import { ref } from 'vue'
import { pb } from '../pb'
import type { Incident } from '../types/incident'

export const useIncidentsStore = defineStore('incidents', () => {
  const items = ref<Incident[]>([])

  async function fetchByFactory(factoryId: string) {
    items.value = await pb.collection('incidents').getFullList<Incident>({
      filter: `factory = "${factoryId}"`,
      sort: '-incident_date',
    })
  }
  // data 用 FormData 以支持文件上传
  async function create(data: FormData) {
    return pb.collection('incidents').create(data)
  }
  return { items, fetchByFactory, create }
})
