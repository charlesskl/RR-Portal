import { useAuth } from '@/lib/auth'
import { APPS } from '@/config'
import type { PermissionLevel, PortalApp } from '@/config'
import PermissionManager from '@/sections/PermissionManager'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  ClipboardCheck,
  Puzzle,
  ShieldCheck,
  Factory,
  Ship,
  LayoutGrid,
  LogOut,
  ExternalLink,
  Wrench,
  Eye,
} from 'lucide-react'

const ICONS: Record<string, typeof ClipboardCheck> = {
  'clipboard-check': ClipboardCheck,
  puzzle: Puzzle,
  'shield-check': ShieldCheck,
  factory: Factory,
  ship: Ship,
}

function AppCard({ app, level }: { app: PortalApp; level: PermissionLevel }) {
  const { enterApp } = useAuth()
  const Icon = ICONS[app.icon] ?? LayoutGrid
  const online = app.status === 'online'
  const canEnter = online && level === 'enter'

  return (
    <Card className="group flex flex-col transition-shadow hover:shadow-lg">
      <CardHeader className="flex-row items-start gap-4 space-y-0">
        <div
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${app.color} text-white`}
        >
          <Icon className="h-6 w-6" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <CardTitle className="truncate text-base">{app.name}</CardTitle>
            <Badge variant={online ? 'default' : 'secondary'} className={online ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100' : ''}>
              {online ? '运行中' : '维护中'}
            </Badge>
          </div>
          <CardDescription className="mt-1">{app.description}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="mt-auto pt-0">
        <Button
          className="w-full"
          variant={canEnter ? 'default' : 'outline'}
          disabled={!canEnter}
          onClick={() => enterApp(app.id, app.name, app.url)}
        >
          {!online ? (
            <>
              <Wrench className="mr-2 h-4 w-4" /> 系统维护中
            </>
          ) : level === 'view' ? (
            <>
              <Eye className="mr-2 h-4 w-4" /> 仅可见（无进入权限）
            </>
          ) : (
            <>
              <ExternalLink className="mr-2 h-4 w-4" /> 进入系统（免登录）
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  )
}

const ACTION_LABEL: Record<string, string> = {
  login: '登录门户',
  logout: '退出门户',
  enter_app: '进入系统',
}

function AuditLog() {
  const { auditLog } = useAuth()
  return (
    <Card className="mt-10">
      <CardHeader>
        <CardTitle className="text-base">访问审计日志</CardTitle>
        <CardDescription>记录登录与系统跳转行为，仅管理员可见</CardDescription>
      </CardHeader>
      <CardContent>
        {auditLog.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">暂无记录</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-44">时间</TableHead>
                <TableHead>用户</TableHead>
                <TableHead>操作</TableHead>
                <TableHead>详情</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {auditLog.slice(0, 20).map((e, i) => (
                <TableRow key={i}>
                  <TableCell className="text-slate-500">{e.time}</TableCell>
                  <TableCell>{e.user}</TableCell>
                  <TableCell>
                    {ACTION_LABEL[e.action] ?? e.action}
                    {e.target ? ` · ${e.target}` : ''}
                  </TableCell>
                  <TableCell className="text-slate-500">{e.detail ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

export default function Home() {
  const { user, logout, effectiveLevel } = useAuth()
  if (!user) return null

  // 按有效权限过滤：hidden 不出现，view/enter 显示卡片
  const visible = APPS.map((app) => ({ app, level: effectiveLevel(user, app) })).filter(
    (x) => x.level !== 'hidden',
  )

  const appGrid = (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {visible.map(({ app, level }) => (
        <AppCard key={app.id} app={app} level={level} />
      ))}
      {visible.length === 0 && (
        <p className="col-span-full py-10 text-center text-slate-400">
          你暂无可访问的系统，请联系管理员开通权限。
        </p>
      )}
    </div>
  )

  return (
    <div className="min-h-screen bg-slate-50">
      {/* 顶部导航 */}
      <header className="sticky top-0 z-10 border-b bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white">
              <LayoutGrid className="h-4 w-4" />
            </div>
            <span className="text-lg font-semibold">员工门户</span>
            <Badge variant="outline" className="ml-2 hidden sm:inline">内网集中器</Badge>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 rounded-full py-1 pl-1 pr-3 hover:bg-slate-100">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="bg-blue-100 text-blue-700">
                    {user.displayName.slice(0, 1)}
                  </AvatarFallback>
                </Avatar>
                <span className="text-sm font-medium">{user.displayName}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>
                <div>{user.displayName}</div>
                <div className="text-xs font-normal text-slate-500">
                  {user.department} · {user.role === 'admin' ? '管理员' : '员工'}
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={logout} className="text-red-600">
                <LogOut className="mr-2 h-4 w-4" /> 退出登录
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        {/* 欢迎区 */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold">{user.displayName}，欢迎回来</h1>
          <p className="mt-1 text-slate-500">
            你可以访问 {visible.length} 个业务系统，点击进入即可免登录跳转。
          </p>
        </div>

        {user.role === 'admin' ? (
          <Tabs defaultValue="apps">
            <TabsList>
              <TabsTrigger value="apps">
                <LayoutGrid className="mr-1.5 h-4 w-4" /> 应用入口
              </TabsTrigger>
              <TabsTrigger value="perms">
                <ShieldCheck className="mr-1.5 h-4 w-4" /> 权限管理
              </TabsTrigger>
            </TabsList>
            <TabsContent value="apps" className="mt-6">
              {appGrid}
              <AuditLog />
            </TabsContent>
            <TabsContent value="perms" className="mt-6">
              <PermissionManager />
            </TabsContent>
          </Tabs>
        ) : (
          appGrid
        )}
      </main>
    </div>
  )
}
