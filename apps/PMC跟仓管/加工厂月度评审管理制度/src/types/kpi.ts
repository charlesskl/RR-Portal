export type KpiAction =
  | 'output_entered' | 'output_reviewed' | 'score_submitted'
  | 'summary_done' | 'correction_closed'
export interface KpiLog {
  id: string
  user: string
  action_type: KpiAction
  target_month: string
  deadline?: string
  completed_at?: string
  is_on_time?: boolean
  notes?: string
}
