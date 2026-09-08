import type { ListResult, RecordListOptions } from 'pocketbase'
import { CRAFTS, REGIONS, type Craft, type Region } from '../constants/roles'

export interface OrderScope { craft?: Craft; region?: Region | null; status?: string }

const quote = (value: string) => JSON.stringify(value)

// An order's management region takes precedence over its factory's location.
export function orderScopeFilter(scope: OrderScope, crafts: Craft[], regions: Region[]): string {
  const selectedCrafts = scope.craft ? crafts.filter((craft) => craft === scope.craft) : crafts
  const selectedRegions = scope.region ? regions.filter((region) => region === scope.region) : regions
  if (!selectedCrafts.length || !selectedRegions.length) return 'id = ""'
  const clauses: string[] = []
  if (scope.status) clauses.push(`status = ${quote(scope.status)}`)
  if (scope.craft || selectedCrafts.length !== CRAFTS.length) {
    clauses.push(`(${selectedCrafts.map((craft) => `factory.craft = ${quote(craft)}`).join(' || ')})`)
  }
  if (scope.region || selectedRegions.length !== REGIONS.length) {
    clauses.push(`(${selectedRegions.map((region) => {
      const factoryRegion = region === 'dongguan'
        ? '(factory.region = "dongguan" || factory.region = "")'
        : `factory.region = ${quote(region)}`
      return `(region = ${quote(region)} || (region = "" && ${factoryRegion}))`
    }).join(' || ')})`)
  }
  return clauses.join(' && ')
}

export const ORDER_SUMMARY_FIELDS = 'id,factory,region,status,expand.factory.name,expand.factory.craft,expand.factory.region'
// Keep every Order field, but avoid repeating complete factory records on each row.
export const ORDER_DETAIL_FIELDS = [
  'id', 'factory', 'region', 'process', 'workshop', 'item_no', 'mold_no', 'product', 'quantity',
  'supplier_price', 'process_category', 'quote_labor_price', 'unit_price', 'unit_price_cny_tax',
  'exchange_rate', 'amount', 'defect_rate', 'pmc', 'order_no', 'order_date', 'delivery_date',
  'actual_delivery_date', 'return_count', 'status', 'current_product', 'progress', 'is_delayed',
  'delay_days', 'delay_reason', 'inspect_count', 'defect_count', 'is_resolved', 'quality_issues',
  'manager_rating', 'notes', 'created_by', 'created', 'updated',
  'expand.factory.name', 'expand.factory.craft', 'expand.factory.region',
].join(',')

/** First page supplies the count; at most three additional pages run concurrently. */
export async function loadOrderPages<T>(
  getPage: (page: number, perPage: number, options: RecordListOptions) => Promise<ListResult<T>>,
  options: RecordListOptions,
  progress: (loaded: number, total: number) => void = () => {},
): Promise<T[]> {
  const pageSize = 1000
  const first = await getPage(1, pageSize, { ...options, skipTotal: false })
  const pages: T[][] = [first.items]
  let loaded = first.items.length
  progress(loaded, first.totalItems)
  let nextPage = 2
  let failed = false
  async function worker() {
    while (!failed && nextPage <= first.totalPages) {
      const page = nextPage++
      try {
        const result = await getPage(page, pageSize, { ...options, skipTotal: true })
        pages[page - 1] = result.items
        loaded += result.items.length
        if (!failed) progress(loaded, first.totalItems)
      } catch (error) {
        failed = true
        throw error
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, Math.max(0, first.totalPages - 1)) }, worker))
  return pages.flat()
}
