export interface MonthlyOutput {
  id: string
  factory: string
  year_month: string
  monthly_amount?: number
  ytd_amount?: number
  source_doc?: string
  entered_by?: string
  reviewed_by?: string
  entered_at?: string
  reviewed_at?: string
}
