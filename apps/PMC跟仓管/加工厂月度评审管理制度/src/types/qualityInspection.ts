export interface QualityInspection {
  id: string
  inspect_date?: string
  factory?: string
  process_type?: string
  customer?: string
  delivery_no?: string
  item_no?: string
  product?: string
  quantity?: number
  internal_result?: string
  internal_defect?: string
  internal_inspector?: string
  cust_inspect_date?: string
  cust_result?: string
  cust_defect?: string
  notes?: string
  created_by?: string
  expand?: { factory?: { name: string; craft?: string; region?: string } }
}
