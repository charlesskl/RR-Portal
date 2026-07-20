import { ProLayout } from '@ant-design/pro-components'
import { Alert, App, Button, Space, Tag, Typography } from 'antd'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { moduleForPath, PERMISSION_MODULES } from '../auth/permissions'

const names: Record<string, string> = { products: '货号库', customers: '客户管理', schedules: '排期', purchase: '采购订单', quotes: '报价', molding: '生产单', outbound: '出库', shipments: '走货明细' }

export default function AppLayout() {
  const location = useLocation()
  const auth = useAuth()
  const { message } = App.useApp()
  const currentModule = moduleForPath(location.pathname)
  const readOnly = !!currentModule && !auth.canEdit(currentModule.key)
  const routes = PERMISSION_MODULES.filter(m => auth.canAccess(m.key)).map(m => ({ path: m.path, name: names[m.key] }))
  if (auth.canAccess('products')) routes.splice(2, 0, { path: '/dictionaries', name: '字典库' })
  if (auth.isAdmin) routes.push({ path: '/users', name: '账户管理' })
  function blockReadOnlyAction(e: React.MouseEvent<HTMLDivElement>) {
    if (!readOnly) return
    const el = (e.target as HTMLElement).closest('button,a,[role="button"]') as HTMLElement | null
    const text = (el?.innerText || el?.getAttribute('aria-label') || '').trim()
    if (el && /新增|添加|编辑|删除|保存|上传|导入|生成|合并|清空|停用|启用|标记|取消|套用|回填|重编号/.test(text)) {
      e.preventDefault(); e.stopPropagation()
      message.warning('当前账户在此模块为只读权限')
    }
  }
  return (
    <ProLayout
      title="印尼走货明细"
      logo={false}
      layout="mix"
      location={{ pathname: location.pathname }}
      route={{ path: '/', routes }}
      menuItemRender={(item, dom) => <Link to={item.path ?? '/'}>{dom}</Link>}
      headerContentRender={() => (
        <Space>
          {readOnly && <Tag color="orange">当前模块只读</Tag>}
        </Space>
      )}
      actionsRender={() => [
        <Typography.Text key="user">{auth.session?.displayName}</Typography.Text>,
        auth.isAdmin ? <Link key="users" to="/users">账户管理</Link> : null,
        <Button key="logout" size="small" onClick={auth.logout}>退出登录</Button>,
      ]}
    >
      {readOnly && <Alert type="warning" showIcon message="只读权限：可以查看和搜索，但不能新增、修改或删除数据。" style={{ marginBottom: 12 }} />}
      <div onClickCapture={blockReadOnlyAction}><Outlet /></div>
    </ProLayout>
  )
}
