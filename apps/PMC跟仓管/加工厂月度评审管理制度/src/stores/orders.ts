import { defineStore } from 'pinia'
import { ref } from 'vue'
import { pb } from '../pb'
import type { Order } from '../types/order'
import { canViewCraft } from '../utils/permissions'
import type { Craft } from '../constants/roles'

export const useOrdersStore = defineStore('orders', () => {
  const items = ref<Order[]>([])

  async function fetchAll(status?: string) {
    const filter = status ? `status = "${status}"` : ''
    const records = await pb.collection('orders').getFullList<Order>({
      filter,
      expand: 'factory',
      sort: '-order_date',
    })
    items.value = records.filter((order) => {
      const craft = order.expand?.factory?.craft as Craft | undefined
      return !craft || canViewCraft(craft)
    })
  }
  async function create(data: Partial<Order>) {
    return pb.collection('orders').create<Order>(data)
  }
  async function update(id: string, data: Partial<Order>) {
    return pb.collection('orders').update<Order>(id, data)
  }
  async function remove(id: string) {
    return pb.collection('orders').delete(id)
  }
  return { items, fetchAll, create, update, remove }
})
