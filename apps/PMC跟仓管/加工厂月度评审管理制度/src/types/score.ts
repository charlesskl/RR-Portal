import type { Grade } from '../constants/grading'
import type { Craft } from '../constants/roles'

export type ScoreModule =
  | 'qualification' | 'delivery' | 'cooperation'
  | 'defect_rate' | 'process' | '5s' | 'craft_specific'

export interface ScoreTemplate {
  id: string
  name: string
  module: ScoreModule
  max_score: number
  scoring_role: 'buyer' | 'quality_qc'
  craft_filter?: Craft | ''
  is_active: boolean
  sort_order: number
  description?: string
}

export interface ScoreItem {
  template_id: string
  score: number
  notes?: string
}

export interface MonthlyScore {
  id: string
  factory: string
  year_month: string
  score_items: ScoreItem[]
  total_score?: number
  grade?: Grade
  flag: 'none' | 'yellow' | 'red'
  flag_reason?: string
  flag_issued_by?: string
  flag_approved_by?: string
  correction_plan?: string
  correction_due?: string
  correction_closed?: boolean
  status: 'draft' | 'submitted' | 'approved'
  submitted_by?: string
  approved_by?: string
}
