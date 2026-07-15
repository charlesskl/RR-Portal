import type { Craft, Region } from '../constants/roles'
export type FactoryStatus = 'active' | 'limited' | 'suspended' | 'eliminated'
export interface Factory {
  id: string
  name: string
  craft: Craft
  region?: Region
  contact_person?: string
  contact_phone?: string
  address?: string
  workshop_area?: number
  workshop_info?: string
  staff_count?: number
  equipment_type?: string
  equipment_qty?: number
  processable_types?: string
  production_lines?: string
  cooperative_workshops?: string
  ip_control?: string
  annual_revenue?: number
  monthly_capacity?: number
  cooperation_period?: string
  site_mgmt_rate?: number
  workshop_photos?: string[]
  // 设备清单：每种设备类型 + 对应数量
  equipment_list?: { type: string; qty: number | null }[]
  qualification_files?: string[]
  qualification_expiry?: string
  has_certs?: boolean
  cert_status?: string
  status: FactoryStatus
  status_pending?: FactoryStatus | ''
  status_updated_by?: string
  status_updated_at?: string
  created_by?: string
}
