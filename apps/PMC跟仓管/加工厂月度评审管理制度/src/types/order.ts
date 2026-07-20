export type OrderStatus = 'placed' | 'producing' | 'delivered' | 'cancelled' | 'returned'
export interface Order {
  id: string
  factory: string
  process?: string
  workshop?: string
  item_no?: string
  mold_no?: string
  product: string
  quantity?: number
  supplier_price?: number
  process_category?: string
  quote_labor_price?: number
  unit_price?: number
  unit_price_cny_tax?: number
  exchange_rate?: number
  amount?: number
  defect_rate?: number
  pmc?: string
  order_no?: string
  order_date?: string
  delivery_date?: string
  actual_delivery_date?: string
  return_count?: number
  status?: OrderStatus
  current_product?: string
  progress?: number
  is_delayed?: boolean
  delay_days?: number
  delay_reason?: string
  inspect_count?: number
  defect_count?: number
  is_resolved?: boolean
  quality_issues?: string
  manager_rating?: number
  notes?: string
  created_by?: string
  expand?: { factory?: { name: string; craft: string } }
}
