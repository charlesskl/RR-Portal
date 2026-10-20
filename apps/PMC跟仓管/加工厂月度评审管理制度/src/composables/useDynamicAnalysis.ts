import { ref, computed, onMounted, onScopeDispose } from 'vue'
import { pb } from '../pb'
import type { Factory } from '../types/factory'
import type { Order } from '../types/order'
import type { Role } from '../constants/roles'
import { regionOf, CRAFTS, REGIONS } from '../constants/roles'
import { roleDefault } from '../utils/permissions'
import { orderScopeFilter } from '../utils/orderLoading'
import { orderRegion } from '../utils/orderRegion'
import { analyze, chinaToday, type PatrolFact } from '../utils/dynamicAnalysis'
export function useDynamicAnalysis() {
  const factories = ref<Factory[]>([]), patrols = ref<PatrolFact[]>([]), orders = ref<Order[]>([])
  const loading = ref(false), errors = ref<string[]>([]), updated = ref(''), today = ref(chinaToday())
  let revision = 0, disposed = false
  const result = computed(() => analyze(patrols.value, orders.value, today.value))
  function clear() { revision++; factories.value = []; patrols.value = []; orders.value = []; updated.value = ''; errors.value = []; loading.value = false }
  async function refresh() {
    if (loading.value || disposed) return
    const user = pb.authStore.record, role = user?.role as Role | undefined
    if (!user || !role) { clear(); return }
    const current = ++revision
    loading.value = true
    // Read this request's auth snapshot rather than stale global permission overrides.
    const defaults = roleDefault(role)
    const cap = (key: string) => {
      const overrides = user.permissions
      if (overrides == null) return !!defaults[key]
      if (typeof overrides !== 'object' || Array.isArray(overrides)) return false
      return key in overrides ? overrides[key] === true : !!defaults[key]
    }
    const assigned = user.crafts
    const crafts = assigned == null || (Array.isArray(assigned) && !assigned.length)
      ? CRAFTS.filter(c => !user.craft || c === user.craft)
      : Array.isArray(assigned) && assigned.every(c => CRAFTS.includes(c)) ? CRAFTS.filter(c => assigned.includes(c)) : []
    const regions = REGIONS.filter(r => cap(`region.${r}`))
    const quality = cap('quality.view'), delivery = cap('orders.view')
    const settled = await Promise.allSettled([
      pb.collection('factories').getFullList<Factory>({ fields: 'id,name,craft,region', sort: 'name' }),
      quality ? pb.collection('quality_patrols').getFullList<PatrolFact>({ fields: 'id,factory,check_date,grade,correction,planned_date,completed_date' }) : Promise.resolve([]),
      delivery ? pb.collection('orders').getFullList<Order>({ filter: orderScopeFilter({}, crafts, regions), fields: 'id,factory,region,product,order_no,status,delivery_date,actual_delivery_date,expand.factory.craft,expand.factory.region', expand: 'factory' }) : Promise.resolve([]),
    ])
    if (disposed || current !== revision) return
    errors.value = []
    const [fs, ps, os] = settled
    factories.value = fs.status === 'fulfilled' ? fs.value.filter(f => crafts.includes(f.craft)) : []
    if (fs.status === 'rejected') errors.value.push('工厂数据读取失败，无法完成分析，请重试。')
    const byId = new Map(factories.value.map(f => [f.id, f]))
    patrols.value = ps.status === 'fulfilled' ? ps.value.filter(p => { const f = byId.get(p.factory); return f && regions.includes(regionOf(f)) }) : []
    orders.value = os.status === 'fulfilled' ? os.value.filter(o => byId.has(o.factory) && regions.includes(orderRegion(o))) : []
    const orderFactories = new Set(orders.value.map(o => o.factory))
    factories.value = factories.value.filter(f => regions.includes(regionOf(f)) || orderFactories.has(f.id))
    if (ps.status === 'rejected') errors.value.push('巡查数据读取失败，巡查预警暂不可用。')
    if (os.status === 'rejected') errors.value.push('订单数据读取失败，交期预警暂不可用。')
    if (!quality) errors.value.push('当前账号无品质查看权限，未分析巡查数据。')
    if (!delivery) errors.value.push('当前账号无货期查看权限，未分析订单数据。')
    today.value = chinaToday(); updated.value = new Date().toLocaleString('zh-CN'); loading.value = false
  }
  const stopAuth = pb.authStore.onChange(() => { clear(); queueMicrotask(() => void refresh()) })
  const onFocus = () => { if (!document.hidden) void refresh() }
  let timer: ReturnType<typeof setInterval>
  onMounted(() => { void refresh(); timer = setInterval(onFocus, 60000); window.addEventListener('focus', onFocus) })
  onScopeDispose(() => { disposed = true; clear(); stopAuth(); clearInterval(timer); window.removeEventListener('focus', onFocus) })
  return { factories, result, loading, errors, updated, refresh }
}
