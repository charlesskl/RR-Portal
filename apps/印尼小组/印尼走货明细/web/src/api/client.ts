import axios from 'axios'
import { message } from 'antd'
import { getStoredSession, saveSession } from '../auth/permissions'
import { apiBase } from '../deployment'

export const api = axios.create({ baseURL: apiBase(import.meta.env.BASE_URL) })

api.interceptors.request.use((config) => {
  const token = getStoredSession()?.token
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (resp) => resp,
  (error) => {
    const data = error?.response?.data
    const status = error?.response?.status
    if (status === 401 && !String(error?.config?.url || '').includes('/auth/login')) {
      saveSession(null)
      if (window.location.pathname !== `${import.meta.env.BASE_URL}login`) {
        window.location.href = `${import.meta.env.BASE_URL}login`
      }
    }
    const text =
      (data && (data.error || data.message)) ||
      (status === 403 ? '没有执行此操作的权限' : null) ||
      (status === 409 ? '数据已被他人修改，请刷新后重试' : null) ||
      error?.message || '网络错误'
    message.error('操作失败：' + text)
    return Promise.reject(error)
  },
)

// Legacy-compat API entity shapes (snake_case, matches old Node backend exactly)

export interface Product {
  code: string
  name?: string
  hs_cn?: string
  hs_id?: string
  customer?: string
  updated_at?: string
  active_count?: number
  total_count?: number
  active?: boolean
}

export interface MoldingPart {
  category?: '塑胶' | '搪胶' | string
  partCode?: string
  partName?: string
  partNameEn?: string
  hsCN?: string
  hsID?: string
  ejections?: number
  usage?: number
  grossPerPc?: number
  netPerPc?: number
  image?: string
}
export interface Molding {
  moldId?: string
  moldName?: string
  materialName?: string
  colorCode?: string
  colorName?: string
  pigmentCode?: string
  netGramsPerShot?: number
  setsPerShot?: number
  workshop?: string
  notes?: string
  parts?: MoldingPart[]
}

export interface ProductDetail extends Product {
  moldings?: Molding[]
  materials?: Material[]
}

export interface Material {
  id?: number
  product_code?: string
  item_no?: string
  name_zh?: string
  name_en?: string
  spec?: string
  category?: string
  material_code?: string
  hs_cn?: string
  hs_id?: string
  supplier?: string
  customs_company?: string
  unit_kg?: string
  gross_per_pc?: number
  net_per_pc?: number
  length?: number
  width?: number
  height?: number
  qty_per_carton?: number
  weight_per_carton?: number
  image_id?: string
  active?: boolean
  sort_order?: number
  image?: string
  usage_qty?: number   // 每个成品需要多少个该物料 (默认 1)
}

export interface HsDict      { keyword: string; hsCN?: string; hsID?: string }
export interface SupplierDict{ keyword: string; full?: string; customs?: string }
export interface Dictionaries { hs: HsDict[]; suppliers: SupplierDict[] }
