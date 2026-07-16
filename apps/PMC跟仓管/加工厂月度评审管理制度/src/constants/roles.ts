export type Role =
  | 'admin' | 'gm' | 'sc_manager'
  | 'buyer_injection' | 'buyer_painting' | 'buyer_assembly' | 'buyer_sewing'
  | 'finance_cost' | 'finance_mgr' | 'quality_qc' | 'sc_clerk'

export type Craft = 'injection' | 'painting' | 'assembly' | 'sewing'

// 厂区（东莞为现有默认；湖南、河源为新增）
export type Region = 'dongguan' | 'hunan' | 'heyuan'
export const REGION_LABELS: Record<Region, string> = {
  dongguan: '东莞', hunan: '湖南', heyuan: '河源',
}
export const REGIONS: Region[] = ['dongguan', 'hunan', 'heyuan']
// 工厂的厂区（旧数据无 region 字段，一律归东莞）
export function regionOf(f?: { region?: string | null; [k: string]: any } | null): Region {
  return ((f?.region as Region) || 'dongguan')
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: '管理员', gm: '总经理', sc_manager: '供应链经理',
  buyer_injection: '注塑部采购', buyer_painting: '喷油部采购',
  buyer_assembly: '装配部采购', buyer_sewing: '车缝部采购',
  finance_cost: '财务成本会计', finance_mgr: '财务主管',
  quality_qc: '品质QC', sc_clerk: '供应链文员',
}

// 部门标签（底层值仍是 craft，UI 统一以「部门」口径展示）
export const CRAFT_LABELS: Record<Craft, string> = {
  injection: '注塑部', painting: '喷油部', assembly: '装配部', sewing: '车缝部',
}
export const CRAFTS = Object.keys(CRAFT_LABELS) as Craft[]

// 采购角色 → 其负责的工艺
export const BUYER_CRAFT: Partial<Record<Role, Craft>> = {
  buyer_injection: 'injection', buyer_painting: 'painting',
  buyer_assembly: 'assembly', buyer_sewing: 'sewing',
}

export function isBuyer(role: Role): boolean {
  return role.startsWith('buyer_')
}
