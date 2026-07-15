export interface Quality5sCheck {
  id: string
  check_date?: string
  factory?: string
  check_type?: string
  project?: string
  customer?: string
  inspector?: string
  s_area?: number
  s_material?: number
  s_hygiene?: number
  s_sharp?: number
  s_nonconform?: number
  s_standard?: number
  s_qc_staff?: number
  s_correction?: number
  ip_control?: string
  notes?: string
  created_by?: string
  expand?: { factory?: { name: string; craft?: string; region?: string } }
}
