export type IncidentType = 'batch_defect' | 'env_violation' | 'shutdown' | 'other'
export interface Incident {
  id: string
  factory: string
  incident_date: string
  incident_type: IncidentType
  description?: string
  photos?: string[]
  docs?: string[]
  entered_by?: string
  reviewed_by?: string
  status: 'open' | 'closed'
  close_date?: string
}
