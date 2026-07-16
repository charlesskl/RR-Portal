import type { Craft } from '../constants/roles'
export interface CraftSummary {
  factory_count: number
  grade_dist: { A: number; B: number; C: number; D: number }
  avg_score: number
  total_output: number
}
export interface ReviewMeeting {
  id: string
  year_month: string
  summary_by_craft: Partial<Record<Craft, CraftSummary>>
  optimization_suggestions?: string
  participants?: string[]
  meeting_date?: string
  approved_by?: string
  summary_by?: string
  status: 'draft' | 'approved'
}
