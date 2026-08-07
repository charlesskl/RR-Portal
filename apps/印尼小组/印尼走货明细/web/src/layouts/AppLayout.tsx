import { useEffect, useRef, useState } from 'react'
import { ProLayout } from '@ant-design/pro-components'
import { Alert, App, Badge, Button, Space, Tag, Typography } from 'antd'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { BellOutlined } from '@ant-design/icons'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { moduleForPath, PERMISSION_MODULES } from '../auth/permissions'

const names: Record<string, string> = { products: '货号库', customers: '客户管理', schedules: '排期', purchase: '采购订单', quotes: '报价', molding: '生产单', outbound: '出库', shipments: '走货明细' }

interface AlertStats {
  pending_critical: number
  pending_warning: number
  pending_normal: number
  pending_total: number
}

export default function AppLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const auth = useAuth()
  const { message } = App.useApp()
  const currentModule = moduleForPath(location.pathname)
  const readOnly = !!currentModule && !auth.canEdit(currentModule.key)
  const routes = PERMISSION_MODULES.filter(m => auth.canAccess(m.key)).map(m => ({ path: m.path, name: names[m.key] }))
  if (auth.canAccess('products')) routes.splice(2, 0, { path: '/dictionaries', name: '字典库' })
  if (auth.canAccess('purchase')) routes.splice(5, 0, { path: '/material-alerts', name: '物料追踪' })
  if (auth.isAdmin) routes.push({ path: '/users', name: '账户管理' })

  // ── 物料提醒桌面通知状态 ──
  const [alertStats, setAlertStats] = useState<AlertStats | null>(null)
  const notifiedRef = useRef<string>('')  // 记录上次已通知的内容摘要，避免重复弹窗
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const canCheckAlerts = auth.canAccess('purchase')

  // 请求浏览器通知权限
  useEffect(() => {
    if (!canCheckAlerts) return
    if ('Notification' in window && Notification.permission === 'default') {
      // 延迟3秒再请求，避免刚打开页面就弹权限框影响体验
      const t = setTimeout(() => {
        Notification.requestPermission().then(perm => {
          console.log('[MaterialAlerts] Notification permission:', perm)
        })
      }, 3000)
      return () => clearTimeout(t)
    }
  }, [canCheckAlerts])

  // 定时轮询提醒统计
  useEffect(() => {
    if (!canCheckAlerts) return

    const checkAlerts = async () => {
      try {
        const resp = await api.get('/material-alerts/stats')
        const stats: AlertStats = resp.data
        setAlertStats(stats)

        // 决定是否弹出桌面通知
        const critical = stats.pending_critical || 0
        const warning = stats.pending_warning || 0
        const totalUrgent = critical + warning

        if (totalUrgent === 0) return
        if (!('Notification' in window) || Notification.permission !== 'granted') return

        // 生成本次内容摘要，与上次比较避免重复弹窗
        const digest = `${critical}|${warning}|${stats.pending_total}`
        if (digest === notifiedRef.current) return
        notifiedRef.current = digest

        // 构建通知内容
        const title = critical > 0
          ? `🔴 物料追踪：${critical} 项超急提醒`
          : `🟡 物料追踪：${warning} 项紧急提醒`

        const bodyLines: string[] = []
        if (critical > 0) bodyLines.push(`超急 ${critical} 项`)
        if (warning > 0) bodyLines.push(`紧急 ${warning} 项`)
        bodyLines.push('点击查看详情并处理')

        const n = new Notification(title, {
          body: bodyLines.join('，'),
          icon: '/favicon.svg',
          tag: 'material-alerts-' + Date.now(),
          requireInteraction: critical > 0, // 超急时通知不自动消失
        })

        n.onclick = () => {
          window.focus()
          navigate('/material-alerts')
          n.close()
        }
      } catch (err) {
        // 静默失败，不打扰用户
        console.warn('[MaterialAlerts] check failed:', err)
      }
    }

    // 首次立即检查
    checkAlerts()

    // 每 5 分钟检查一次
    timerRef.current = setInterval(checkAlerts, 5 * 60 * 1000)

    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [canCheckAlerts, navigate])

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
      title="印尼物料管理系统"
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
        canCheckAlerts ? (
          <Badge key="alerts" count={alertStats?.pending_total || 0} size="small" overflowCount={99}>
            <Button type="text" icon={<BellOutlined />} onClick={() => navigate('/material-alerts')}>物料提醒</Button>
          </Badge>
        ) : null,
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
