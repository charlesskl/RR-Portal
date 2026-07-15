import type { Role, Craft, Region } from '../constants/roles'
import { CRAFTS, isBuyer, REGIONS } from '../constants/roles'

// —— 可逐项勾选的模块（用户管理里设置）——
export interface PermModule { key: string; label: string; edit: boolean }
export const PERM_MODULES: PermModule[] = [
  { key: 'factories', label: '工厂信息管理', edit: true },
  { key: 'factory_admin', label: '加工厂管理（只读总览）', edit: false },
  { key: 'orders', label: '货期管理', edit: true },
  { key: 'quality', label: '品质管理', edit: true },
  { key: 'output', label: '产值管理', edit: true },
  { key: 'scoring', label: '工厂月度评分', edit: false },
  { key: 'templates', label: '评分模板', edit: false },
  { key: 'price_stats', label: '单价统计', edit: false },
  { key: 'summary', label: '汇总表', edit: false },
  { key: 'users', label: '用户管理', edit: false },
]

// 角色默认权限（与原有规则保持一致）
export function roleDefault(role: Role): Record<string, boolean> {
  const buyer = isBuyer(role)
  return {
    'factories.view': true,
    'factories.edit': true,
    'factory_admin.view': role === 'gm' || role === 'admin',
    'orders.view': true,
    'orders.edit': role !== 'quality_qc',
    'quality.view': true,
    'quality.edit': !buyer,
    'output.view': role === 'finance_cost' || role === 'admin' || role === 'gm' || buyer || role === 'quality_qc',
    'output.edit': role === 'finance_cost' || role === 'admin',
    'scoring.view': role !== 'gm' && !buyer && role !== 'quality_qc',
    'templates.view': role === 'admin',
    'price_stats.view': true,
    'summary.view': true,
    'users.view': role === 'admin',
    // 厂区访问：默认全部可见
    'region.dongguan': true,
    'region.hunan': true,
    'region.heyuan': true,
  }
}

// 当前登录用户的覆盖项（auth store 在登录/初始化时注入）
let _ov: Record<string, boolean> = {}
let _crafts: Craft[] | null = null
export function setPermissionOverrides(o: Record<string, boolean> | null | undefined) {
  _ov = o && typeof o === 'object' ? o : {}
}
export function setAuthorizedCrafts(crafts: Craft[] | null | undefined) {
  const valid = (Array.isArray(crafts) ? crafts : []).filter((craft): craft is Craft => CRAFTS.includes(craft))
  _crafts = valid.length ? [...new Set(valid)] : null
}
export const allowedCrafts = (): Craft[] => (_crafts ? [..._crafts] : [...CRAFTS])
export const canViewCraft = (craft: Craft): boolean => !_crafts || _crafts.includes(craft)
function cap(role: Role, key: string): boolean {
  if (key in _ov) return !!_ov[key]
  return !!roleDefault(role)[key]
}

// —— 视图权限（菜单 / 路由）——
export const canViewFactories = (r: Role) => cap(r, 'factories.view')
export const canViewFactoryAdmin = (r: Role) => cap(r, 'factory_admin.view')
export const canViewOrders = (r: Role) => cap(r, 'orders.view')
export const canViewQuality = (r: Role) => cap(r, 'quality.view')
export const canViewOutput = (r: Role) => cap(r, 'output.view')
export const canViewScoring = (r: Role) => cap(r, 'scoring.view')
export const canViewTemplates = (r: Role) => cap(r, 'templates.view')
export const canViewPriceStats = (r: Role) => cap(r, 'price_stats.view')
export const canViewSummary = (r: Role) => cap(r, 'summary.view')
export const canViewUsers = (r: Role) => cap(r, 'users.view')

// —— 厂区访问 ——
export const canViewRegion = (r: Role, region: Region) => cap(r, `region.${region}`)
export const allowedRegions = (r: Role): Region[] => REGIONS.filter((rg) => cap(r, `region.${rg}`))

// —— 编辑权限 ——
export const canEditFactories = (r: Role) => cap(r, 'factories.edit')
export const canEditOrders = (r: Role) => cap(r, 'orders.edit')
export const canEditQuality = (r: Role) => cap(r, 'quality.edit')
export const canEditOutput = (r: Role) => cap(r, 'output.edit')

// —— 其它（不参与逐项勾选，保持原状）——
export const canApproveStatus = (role: Role) => role === 'sc_manager' || role === 'admin'
export const canApproveScore = (role: Role) => role === 'sc_manager' || role === 'admin'
export const canEditTemplates = (role: Role) => role === 'admin'
export const canViewKpi = (role: Role) => role !== 'gm'

// 路由守卫：路径前缀 → 所需视图权限
const PATH_CAPS: [string, (r: Role) => boolean][] = [
  ['/factory-view', canViewFactoryAdmin],
  ['/factories', canViewFactories],
  ['/orders', canViewOrders],
  ['/order-tracking', canViewOrders],
  ['/quality', canViewQuality],
  ['/monthly-output', canViewOutput],
  ['/scoring', canViewScoring],
  ['/kpi', canViewScoring],
  ['/price-stats', canViewPriceStats],
  ['/summary', canViewSummary],
  ['/admin/score-templates', canViewTemplates],
  ['/admin/users', canViewUsers],
]
export function canAccessPath(role: Role, path: string): boolean {
  for (const [pre, fn] of PATH_CAPS) if (path.startsWith(pre)) return fn(role)
  return true
}

// 兼容旧页面：仅授权一个部门时返回该部门；多部门或全部部门时返回 null。
export function visibleCraft(_role: Role): Craft | null {
  return _crafts?.length === 1 ? _crafts[0] : null
}
