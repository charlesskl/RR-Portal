// 菜单目录 — 集中维护
// 任何新增功能/页面，对应权限菜单需在此登记
module.exports = {
  MENUS: [
    { key: '报价单列表', group: '报价' },
    { key: '报价单详情', group: '报价' },
    { key: '业务部', group: '部门' },
    { key: '工程部', group: '部门' },
    { key: '电子部', group: '部门' },
    { key: '啤机部', group: '部门' },
    { key: '喷油部', group: '部门' },
    { key: '搪胶', group: '部门' },
    { key: '车缝', group: '部门' },
    { key: '装配部', group: '部门' },
    { key: '汇总分析', group: '高级' },
    { key: '减税明细', group: '高级' },
    { key: '参考表', group: '维护' },
    { key: '出口', group: '维护' },
    { key: '账号管理', group: '系统' },
  ],
  // 部门 code → 部门菜单 key
  DEPT_TO_MENU: {
    sales: '业务部',
    engineering: '工程部',
    electronic: '电子部',
    molding: '啤机部',
    painting: '喷油部',
    slush: '搪胶',
    sewing: '车缝',
    assembly: '装配部',
  },
};
