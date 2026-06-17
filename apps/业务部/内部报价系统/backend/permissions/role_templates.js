// 角色 → 默认权限模板
// staff / supervisor / admin
// 4 位：view / edit / review / admin
const { MENUS, DEPT_TO_MENU } = require('./menu_catalog');

// 工具：生成一条权限
const perm = (view = 0, edit = 0, review = 0, admin = 0) => ({
  can_view: view, can_edit: edit, can_review: review, can_admin: admin,
});

// 给定 dept、role，返回 [{menu, can_view, can_edit, can_review, can_admin}, ...]
function templateFor(dept, role) {
  const myDeptMenu = DEPT_TO_MENU[dept];
  const out = [];
  for (const m of MENUS) {
    let p;
    if (role === 'admin') {
      // admin 全权
      p = perm(1, 1, 1, 1);
    } else if (m.key === '账号管理') {
      // 非 admin 不能进账号管理
      p = perm(0, 0, 0, 0);
    } else if (m.key === '报价单列表' || m.key === '报价单详情') {
      // 报价主页：业务/工程能 view+edit；其他部门 view+edit 自己 section
      p = perm(1, 1, 0, 0);
    } else if (m.key === '汇总分析' || m.key === '减税明细') {
      // 高级：只有业务/工程能看
      p = (dept === 'sales' || dept === 'engineering')
        ? perm(1, role === 'supervisor' ? 1 : 1, 0, 0)
        : perm(0, 0, 0, 0);
    } else if (m.key === '参考表') {
      // 参考表：业务/工程/啤机能 view+edit；其他只读
      const canEdit = ['sales', 'engineering', 'molding'].includes(dept);
      p = perm(1, canEdit ? 1 : 0, 0, 0);
    } else if (m.key === '出口') {
      // 出口（导出）：所有人 view（=能导出）
      p = perm(1, 0, 0, 0);
    } else if (m.group === '部门') {
      // 部门菜单：只本部门 view+edit；本部门主管多 review
      const isOwn = m.key === myDeptMenu;
      const isCrossDept = (dept === 'sales' || dept === 'engineering');
      if (isOwn) {
        p = perm(1, 1, role === 'supervisor' ? 1 : 0, 0);
      } else if (isCrossDept) {
        // 业务/工程能看全部门 + 编辑全部门 + 审核全部门（主管）
        p = perm(1, 1, role === 'supervisor' ? 1 : 0, 0);
      } else {
        p = perm(0, 0, 0, 0);
      }
    } else {
      p = perm(0, 0, 0, 0);
    }
    out.push({ menu: m.key, ...p });
  }
  return out;
}

module.exports = { templateFor };
