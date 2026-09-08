import { defineStore } from 'pinia'
import { ref, shallowRef, onScopeDispose } from 'vue'
import { pb } from '../pb'
import type { Order } from '../types/order'
import { allowedCrafts, allowedRegions } from '../utils/permissions'
import { REGIONS, type Craft, type Region, type Role } from '../constants/roles'
import { orderRegion } from '../utils/orderRegion'
import { loadOrderPages, orderScopeFilter, ORDER_DETAIL_FIELDS, ORDER_SUMMARY_FIELDS, type OrderScope } from '../utils/orderLoading'

export type OrderSummary = Pick<Order, 'id' | 'factory' | 'region' | 'status' | 'expand'>
type LoadOptions = { force?: boolean }
const CACHE_MS = 30_000

export const useOrdersStore = defineStore('orders', () => {
  // Records are replaced after loading/saving; thousands of read-only rows need no deep proxy.
  const items = shallowRef<Order[]>([])
  const summaryItems = shallowRef<OrderSummary[]>([])
  const loading = ref(false)
  const error = ref('')
  const loadedCount = ref(0)
  const totalCount = ref(0)
  const summaryLoading = ref(false)
  const summaryError = ref('')
  let owner = ''
  let revision = 0
  let detailRequest = 0
  let summaryRequest = 0
  let detailKey = ''
  let detailAt = 0
  let summaryKey = ''
  let summaryAt = 0
  const pending = new Map<string, Promise<Order[]>>()

  function context() {
    const record = pb.authStore.record
    const crafts = allowedCrafts()
    const regions = record?.role ? allowedRegions(record.role as Role) : REGIONS
    const key = JSON.stringify([record?.id ?? '', record?.role, record?.permissions, crafts, regions])
    if (owner !== key) {
      reset()
      owner = key
    }
    return { key, crafts, regions }
  }
  function reset() {
    revision++
    detailRequest++
    summaryRequest++
    detailAt = summaryAt = 0
    detailKey = summaryKey = ''
    items.value = []
    summaryItems.value = []
    loadedCount.value = totalCount.value = 0
    loading.value = summaryLoading.value = false
    error.value = summaryError.value = ''
    pending.clear()
  }
  // Do not keep data from a previous account after logout or permission refresh.
  const unsubscribe = pb.authStore.onChange(() => { owner = ''; reset() })
  onScopeDispose(unsubscribe)

  function invalidate() {
    revision++
    detailRequest++
    summaryRequest++
    loading.value = summaryLoading.value = false
    detailAt = summaryAt = 0
    pending.clear()
  }

  async function load(scope: OrderScope, summary: boolean, options: LoadOptions = {}) {
    const ctx = context()
    const filter = orderScopeFilter(scope, ctx.crafts, ctx.regions)
    const generation = revision
    const key = JSON.stringify([ctx.key, filter, summary, generation])
    const now = Date.now()
    if (!options.force && (summary ? summaryKey === key && now - summaryAt < CACHE_MS : detailKey === key && now - detailAt < CACHE_MS)) {
      return summary ? summaryItems.value as Order[] : items.value
    }
    const request = summary ? ++summaryRequest : ++detailRequest
    if (summary) {
      if (summaryKey !== key) summaryItems.value = []
      summaryKey = key
      summaryAt = 0
      summaryLoading.value = true
      summaryError.value = ''
    } else {
      if (detailKey !== key) items.value = []
      detailKey = key
      detailAt = 0
      loading.value = true
      error.value = ''
      loadedCount.value = totalCount.value = 0
    }
    const current = () => revision === generation && owner === ctx.key && context().key === ctx.key && request === (summary ? summaryRequest : detailRequest)
    try {
      let task = options.force ? undefined : pending.get(key)
      if (!task) {
        task = loadOrderPages<Order>(
          (page, size, query) => pb.collection('orders').getList<Order>(page, size, query),
          { filter, expand: 'factory', sort: summary ? 'id' : '-order_date,-id', fields: summary ? ORDER_SUMMARY_FIELDS : ORDER_DETAIL_FIELDS },
          (count, total) => {
            if (!summary && current()) { loadedCount.value = count; totalCount.value = total }
          },
        )
        pending.set(key, task)
        const cleanup = () => { if (pending.get(key) === task) pending.delete(key) }
        void task.then(cleanup, cleanup)
      }
      const records = (await task).filter((order) => {
        const craft = order.expand?.factory?.craft as Craft | undefined
        return (craft ? ctx.crafts.includes(craft) : ctx.crafts.length === 5) && (!scope.craft || craft === scope.craft)
          && ctx.regions.includes(orderRegion(order)) && (!scope.region || orderRegion(order) === scope.region)
      })
      if (revision !== generation || context().key !== ctx.key) throw new Error('账号或订单数据已变更，请重新读取')
      // Each caller gets its own complete result even when another page has become active.
      if (!current()) return records
      if (summary) {
        summaryItems.value = records
        summaryKey = key
        summaryAt = Date.now()
      } else {
        items.value = records
        loadedCount.value = records.length
        detailKey = key
        detailAt = Date.now()
      }
      return records
    } catch (cause) {
      if (current()) {
        const message = cause instanceof Error ? cause.message : '订单读取失败，请重试'
        if (summary) summaryError.value = message
        else error.value = message
      }
      throw cause
    } finally {
      if (current()) {
        if (summary) summaryLoading.value = false
        else loading.value = false
      }
    }
  }

  const fetchAll = (status?: string, options?: LoadOptions) => load({ status }, false, options)
  const fetchForScope = (craft: Craft, region: Region | null = null, options?: LoadOptions) => load({ craft, region }, false, options)
  const fetchSummary = (options?: LoadOptions) => load({}, true, options)

  async function create(data: Partial<Order>) {
    const result = await pb.collection('orders').create<Order>(data)
    invalidate()
    return result
  }
  async function update(id: string, data: Partial<Order>) {
    const result = await pb.collection('orders').update<Order>(id, data)
    invalidate()
    return result
  }
  async function remove(id: string) {
    const result = await pb.collection('orders').delete(id)
    invalidate()
    return result
  }
  return { items, summaryItems, loading, error, loadedCount, totalCount, summaryLoading, summaryError,
    fetchAll, fetchForScope, fetchSummary, create, update, remove }
})
