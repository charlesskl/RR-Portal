// ============================================================
// 门户集中配置：接入的系统、演示账号、权限
// 正式环境把 users 换成后端认证接口，apps 换成数据库配置即可
// ============================================================

export interface PortalApp {
  id: string
  name: string
  description: string
  url: string // 目标系统地址，跳转时附带 sso_ticket
  icon: string // lucide 图标名（在 AppCard 中映射）
  color: string // 卡片主题色
  allowedRoles: string[] // 哪些角色可见
  status: 'online' | 'maintenance'
}

export interface PortalUser {
  username: string
  password: string
  displayName: string
  role: 'admin' | 'employee'
  department: string
}

// 运行环境判断：本机开发用 localhost 端口；部署到服务器后走 nginx 子路径
const IS_LOCAL =
  typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname)

// 4 个真实业务系统（本地 = localhost 端口；服务器 = 同源子路径，由 nginx 反代）
export const APPS: PortalApp[] = [
  {
    id: 'qc-report',
    name: 'QC成品报告系统',
    description: '上传 PO、AI 辅助验货、按 AQL 生成英文正式报告',
    url: IS_LOCAL ? 'http://localhost:8000' : '/qc-report/',
    icon: 'clipboard-check',
    color: 'from-emerald-500 to-emerald-600',
    allowedRoles: ['admin', 'employee'],
    status: 'online',
  },
  {
    id: 'toyqms',
    name: '玩具质量管理系统',
    description: '客诉处理、CAP 纠正措施、系列分析与质量情报',
    url: IS_LOCAL ? 'http://localhost:3200' : '/toyqms/',
    icon: 'puzzle',
    color: 'from-blue-500 to-blue-600',
    allowedRoles: ['admin', 'employee'],
    status: 'online',
  },
  {
    id: 'xingxin-qms',
    name: '品质管理系统',
    description: '兴信 QMS：多厂区多子公司品质数据与 AI-OCR 报告导出',
    url: IS_LOCAL ? 'http://localhost:8765' : '/qc/',
    icon: 'shield-check',
    color: 'from-violet-500 to-violet-600',
    allowedRoles: ['admin', 'employee'],
    status: 'online',
  },
  {
    id: 'voyageplex',
    name: 'VoyagePlex船务协同',
    description: '走柜任务、验货结果补录、订单信息库与船务协同',
    url: IS_LOCAL ? 'http://localhost:3400' : '/voyageplex/',
    icon: 'ship',
    color: 'from-cyan-500 to-blue-600',
    allowedRoles: ['admin', 'employee'],
    status: 'online',
  },
]

// 演示账号（正式环境删除，改走后端认证）
export const USERS: PortalUser[] = [
  { username: 'admin', password: 'admin123', displayName: '系统管理员', role: 'admin', department: '信息中心' },
  { username: 'zhangsan', password: '123456', displayName: '张三', role: 'employee', department: '质量部' },
  { username: 'lisi', password: '123456', displayName: '李四', role: 'employee', department: '生产部' },
]

// ============================================================
// SSO 配置：门户与各系统共享同一个密钥
// 服务器部署：Docker 构建时通过 VITE_SSO_SECRET 注入（与后端 SSO_SECRET 一致）
// 票据格式：JWT（HS256），payload 带该账号对目标系统的功能权限
// ============================================================
export const SSO_SECRET: string = import.meta.env.VITE_SSO_SECRET || 'dev-sso-secret-change-me'

// 功能级权限档位：none 无权限 / view 仅查看 / full 全部操作
export type FeatureLevel = 'none' | 'view' | 'full'

export const FEATURE_LEVEL_LABEL: Record<FeatureLevel, string> = {
  none: '无权限',
  view: '仅查看',
  full: '全部操作',
}

export interface AppFeature {
  key: string
  label: string
  group: string
}

// 品质管理系统的厂区/子公司清单（与兴信 QMS 内部清单一一对应）
export const QMS_SITES = [
  { id: 'dongguan', label: '东莞厂区' },
  { id: 'heyuan', label: '河源厂区' },
  { id: 'hunan', label: '湖南厂区' },
]

export const QMS_COMPANIES = [
  { id: 'dg-xingxin', site: 'dongguan', name: '东莞兴信' },
  { id: 'dg-huadeng-a', site: 'dongguan', name: '东莞华登A' },
  { id: 'dg-huadeng-b', site: 'dongguan', name: '东莞华登B' },
  { id: 'dg-huajia', site: 'dongguan', name: '东莞华嘉' },
  { id: 'hy-huakang-a', site: 'heyuan', name: '华康A' },
  { id: 'hy-huakang-b', site: 'heyuan', name: '华康B' },
  { id: 'hy-huakang-c', site: 'heyuan', name: '华康C' },
  { id: 'hy-huakang-d', site: 'heyuan', name: '华康D' },
  { id: 'hy-huadeng', site: 'heyuan', name: '河源华登' },
  { id: 'hy-huaxing', site: 'heyuan', name: '河源华兴' },
  { id: 'sy-huadeng', site: 'hunan', name: '邵阳华登' },
  { id: 'sy-xingxin', site: 'hunan', name: '邵阳兴信' },
  { id: 'xs-huadeng', site: 'hunan', name: '新邵华登' },
]

// 每个系统的功能清单（与各系统内部权限模型的功能键一一对应）
export const APP_FEATURES: Record<string, AppFeature[]> = {
  'xingxin-qms': [
    { key: 'dashboard', label: '质量仪表板', group: '检验' },
    { key: 'records', label: '验货明细', group: '检验' },
    { key: 'review', label: '审核中心', group: '检验' },
    { key: 'analysis', label: '统计分析', group: '检验' },
    { key: 'suppliers', label: '供应商管理', group: '检验' },
    { key: 'daily', label: '品质日报', group: '报告' },
    { key: 'weekly', label: '品质周报', group: '报告' },
    { key: 'monthly', label: '品质月报', group: '报告' },
    { key: 'yearly', label: '品质年报', group: '报告' },
    { key: 'supplier-report', label: '供应商质量报告', group: '报告' },
    { key: 'defectlib', label: '不良描述库', group: '系统' },
    { key: 'import', label: '数据导入', group: '系统' },
    { key: 'users', label: '账号管理', group: '系统' },
  ],
  'qc-report': [
    { key: 'upload', label: '上传 PO', group: '验货流程' },
    { key: 'proofread', label: '校对货号', group: '验货流程' },
    { key: 'inspect', label: '拍照与测试', group: '验货流程' },
    { key: 'ai-draft', label: 'AI 草稿', group: '验货流程' },
    { key: 'finalize', label: '签字出报告', group: '验货流程' },
    { key: 'admin', label: '系统管理', group: '系统' },
  ],
  toyqms: [
    { key: 'dashboard', label: '工作台', group: '质量' },
    { key: 'complaints', label: '客诉管理', group: '质量' },
    { key: 'cap', label: 'CAP 纠正措施', group: '质量' },
    { key: 'reports', label: '报告中心', group: '质量' },
    { key: 'series-analysis', label: '系列分析', group: '质量' },
    { key: 'quality-intelligence', label: '质量情报', group: '质量' },
    { key: 'import', label: '数据导入', group: '系统' },
    { key: 'issue-types', label: '问题类型', group: '系统' },
    { key: 'users', label: '用户管理', group: '系统' },
    { key: 'settings', label: '系统设置', group: '系统' },
  ],
}

// ============================================================
// 权限模型：每个账号对每个系统有三档权限
//   enter  可进入（可见且可免登跳转）
//   view   仅可见（看得到卡片，但按钮禁用）
//   hidden 不可见（卡片不出现）
// 未单独设置时按角色默认值：角色在 allowedRoles 里 → enter，否则 → hidden
// ============================================================
export type PermissionLevel = 'enter' | 'view' | 'hidden'

export const LEVEL_LABEL: Record<PermissionLevel, string> = {
  enter: '可进入',
  view: '仅可见',
  hidden: '不可见',
}

export function defaultLevel(role: string, app: PortalApp): PermissionLevel {
  return app.allowedRoles.includes(role) ? 'enter' : 'hidden'
}
