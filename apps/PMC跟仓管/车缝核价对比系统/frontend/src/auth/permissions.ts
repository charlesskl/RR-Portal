/** 集中权限配置：角色 → 可见菜单 + 可编辑能力。整个前端的访问控制以此为单一来源。 */

export type Role = '业务' | '外发' | '跟单' | '品质' | '管理层' | '管理员';
export const ALL_ROLES: Role[] = ['业务', '外发', '跟单', '品质', '管理层', '管理员'];

export interface MenuDef {
  key: string; // 路由 path
  label: string; // 菜单文字
  roles: Role[]; // 哪些角色能看到此菜单
}

/** 顶部菜单定义（顺序即展示顺序）。注意：核价相关菜单不含 跟单/品质（全程不见价）。 */
export const MENUS: MenuDef[] = [
  { key: '/orders', label: '外发订单', roles: ['业务', '外发', '跟单', '品质', '管理层', '管理员'] },
  { key: '/price-board', label: '核价对比', roles: ['业务', '外发', '管理层', '管理员'] },
  { key: '/quality', label: '品质管理', roles: ['业务', '外发', '跟单', '品质', '管理层', '管理员'] },
  { key: '/dashboard', label: '综合评价', roles: ['管理层', '管理员'] },
  { key: '/suppliers', label: '加工厂管理', roles: ['业务', '外发', '跟单', '品质', '管理层', '管理员'] },
  { key: '/products', label: '产品核价库', roles: ['业务', '外发', '跟单', '管理层', '管理员'] },
  { key: '/users', label: '用户管理', roles: ['管理员'] },
];

const isRole = (v: unknown): v is Role => ALL_ROLES.includes(v as Role);
export const toRole = (v?: string | null): Role | null => (isRole(v) ? v : null);

/** 当前角色能看到的菜单。 */
export const visibleMenus = (role: Role | null): MenuDef[] =>
  role ? MENUS.filter((m) => m.roles.includes(role)) : [];

/** 该角色是否有权访问某路由。 */
export const canSeeRoute = (role: Role | null, path: string): boolean =>
  !!role && MENUS.some((m) => (m.key === path || path.startsWith(`${m.key}/`)) && m.roles.includes(role));

/** 登录后落地页 = 该角色第一个可见菜单。 */
export const homePathFor = (role: Role | null): string => visibleMenus(role)[0]?.key ?? '/orders';

/** 细粒度能力（页面内的"可编辑"判断）。✅可改的写 true。 */
export const can = {
  viewPrices: (r: Role | null) => r === '业务' || r === '外发' || r === '管理层' || r === '管理员',
  // 核价录入两列
  editSelfCost: (r: Role | null) => r === '业务' || r === '管理员', // 本厂自制成本列
  editOutPrice: (r: Role | null) => r === '外发' || r === '管理员', // 外发加工成本列
  // 外发订单
  viewOrderDetail: (r: Role | null) => r !== '跟单' && r !== '品质' && r !== null, // 含价明细弹窗
  editOrderDetail: (r: Role | null) => r === '业务' || r === '外发' || r === '管理员',
  editOrderTracking: (r: Role | null) => r === '业务' || r === '外发' || r === '跟单' || r === '管理员',
  // 其他模块
  editSuppliers: (r: Role | null) => r === '外发' || r === '跟单' || r === '管理员',
  editProducts: (r: Role | null) => r === '业务' || r === '管理员',
  editQuality: (r: Role | null) => r === '跟单' || r === '品质' || r === '管理员',
  manageUsers: (r: Role | null) => r === '管理员',
};
