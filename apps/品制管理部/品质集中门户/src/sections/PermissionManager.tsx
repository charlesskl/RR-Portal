// ============================================================
// 权限管理：账号 × 系统 的系统级权限矩阵 + 功能级权限弹窗 + 新增账号（仅管理员可见）
// 正式环境：账号与 overrides 存数据库，这里用 localStorage 模拟
// ============================================================
import { useState } from 'react'
import { useAuth } from '@/lib/auth'
import type { NewUserInput } from '@/lib/auth'
import { APPS, USERS, LEVEL_LABEL, defaultLevel, APP_FEATURES, FEATURE_LEVEL_LABEL, QMS_SITES, QMS_COMPANIES } from '@/config'
import type { FeatureLevel, PermissionLevel, PortalApp, PortalUser } from '@/config'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { ShieldCheck, SlidersHorizontal, UserPlus, Trash2 } from 'lucide-react'

const LEVELS: PermissionLevel[] = ['enter', 'view', 'hidden']
const FEATURE_LEVELS: FeatureLevel[] = ['none', 'view', 'full']

const EMPTY_FORM: NewUserInput = { username: '', password: '', displayName: '', department: '', role: 'employee' }

export default function PermissionManager() {
  const { user, allUsers, addUser, removeUser, overrides, setLevel, effectiveLevel, setFeatureLevel, effectiveFeatureLevel, effectiveCompanies, setCompanies } = useAuth()
  const [editing, setEditing] = useState<{ u: PortalUser; app: PortalApp } | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [form, setForm] = useState<NewUserInput>(EMPTY_FORM)
  const [formError, setFormError] = useState('')
  if (!user) return null

  const builtinUsernames = new Set(USERS.map((u) => u.username))

  const features = editing ? (APP_FEATURES[editing.app.id] ?? []) : []
  const groups = [...new Set(features.map((f) => f.group))]
  const isQms = editing?.app.id === 'xingxin-qms'
  const allowedCompanies = editing ? effectiveCompanies(editing.u.username, editing.app.id) : []

  const toggleCompany = (companyId: string, checked: boolean) => {
    if (!editing) return
    const next = checked
      ? [...allowedCompanies, companyId]
      : allowedCompanies.filter((c) => c !== companyId)
    if (next.length === 0) return // 至少保留一个厂区
    setCompanies(editing.u.username, editing.app.id, next)
  }

  const submitNewUser = () => {
    const err = addUser(form)
    if (err) {
      setFormError(err)
      return
    }
    setAddOpen(false)
    setForm(EMPTY_FORM)
    setFormError('')
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-blue-600" />
            <CardTitle className="text-base">权限管理</CardTitle>
          </div>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <UserPlus className="mr-1.5 h-4 w-4" /> 新增账号
          </Button>
        </div>
        <CardDescription>
          为每个账号设置对各系统的访问级别，点「功能权限」可细化到系统内的每个功能。未单独设置时按默认值生效。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-52">账号</TableHead>
              {APPS.map((app) => (
                <TableHead key={app.id}>{app.name}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {allUsers.map((u) => {
              const isSelf = u.username === user.username
              const isCustom = !builtinUsernames.has(u.username)
              return (
                <TableRow key={u.username}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback className="bg-slate-100 text-slate-600">
                          {u.displayName.slice(0, 1)}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="text-sm font-medium">
                          {u.displayName}
                          {isSelf && <span className="ml-1 text-xs text-slate-400">（我）</span>}
                          {isCustom && (
                            <Badge variant="outline" className="ml-1.5 text-emerald-600 border-emerald-200">
                              新增
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-slate-500">
                          {u.department} · {u.role === 'admin' ? '管理员' : '员工'}
                        </div>
                      </div>
                      {isCustom && !isSelf && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="ml-auto h-7 px-2 text-xs text-red-500 hover:text-red-600"
                          title="删除该账号"
                          onClick={() => {
                            if (window.confirm(`确定删除账号「${u.displayName}（${u.username}）」吗？其权限设置会一并清除。`)) {
                              removeUser(u.username)
                            }
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                  {APPS.map((app) => {
                    const current = effectiveLevel(u, app)
                    const isOverride = overrides[u.username]?.[app.id] !== undefined
                    return (
                      <TableCell key={app.id}>
                        <Select
                          value={current}
                          disabled={isSelf}
                          onValueChange={(v) => setLevel(u.username, app.id, v as PermissionLevel)}
                        >
                          <SelectTrigger className="w-32">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {LEVELS.map((lv) => (
                              <SelectItem key={lv} value={lv}>
                                {LEVEL_LABEL[lv]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <div className="mt-1 flex items-center gap-2">
                          {isOverride ? (
                            <Badge variant="outline" className="text-blue-600 border-blue-200">
                              单独设置
                            </Badge>
                          ) : (
                            <span className="text-xs text-slate-400">
                              默认：{LEVEL_LABEL[defaultLevel(u.role, app)]}
                            </span>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs"
                            disabled={isSelf || current === 'hidden'}
                            onClick={() => setEditing({ u, app })}
                          >
                            <SlidersHorizontal className="mr-1 h-3 w-3" />
                            功能权限
                          </Button>
                        </div>
                      </TableCell>
                    )
                  })}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
        <p className="mt-4 text-xs text-slate-400">
          说明：管理员不能修改自己的权限，防止把自己锁在门外。「仅可见」的账号能看到系统卡片但无法进入。带「新增」标记的账号可删除。
        </p>
      </CardContent>

      {/* 新增账号弹窗 */}
      <Dialog open={addOpen} onOpenChange={(open) => { setAddOpen(open); if (!open) { setForm(EMPTY_FORM); setFormError('') } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>新增账号</DialogTitle>
            <DialogDescription>
              创建后即可在门户登录；默认按角色获得各系统访问权限，保存后可在列表中单独调整。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="nu-name">姓名</Label>
              <Input
                id="nu-name"
                placeholder="例如：王五"
                value={form.displayName}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nu-username">登录账号</Label>
              <Input
                id="nu-username"
                placeholder="例如：wangwu"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nu-password">密码</Label>
              <Input
                id="nu-password"
                type="password"
                placeholder="至少 6 位"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="nu-dept">部门</Label>
                <Input
                  id="nu-dept"
                  placeholder="例如：船务部"
                  value={form.department}
                  onChange={(e) => setForm({ ...form, department: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>角色</Label>
                <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as 'admin' | 'employee' })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="employee">员工</SelectItem>
                    <SelectItem value="admin">管理员</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {formError && <p className="text-sm text-red-600">{formError}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setAddOpen(false)}>取消</Button>
              <Button onClick={submitNewUser}>创建账号</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 功能级权限弹窗 */}
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-lg">
          {editing && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {editing.u.displayName} · {editing.app.name}
                </DialogTitle>
                <DialogDescription>
                  细化该账号在此系统内每个功能的权限，下次从门户进入时生效。
                </DialogDescription>
              </DialogHeader>
              {features.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-400">该系统暂未配置功能清单</p>
              ) : (
                <div className="max-h-[55vh] space-y-4 overflow-y-auto pr-1">
                  {groups.map((g) => (
                    <div key={g}>
                      <div className="mb-2 text-xs font-semibold text-slate-400">{g}</div>
                      <div className="space-y-1.5">
                        {features
                          .filter((f) => f.group === g)
                          .map((f) => (
                            <div key={f.key} className="flex items-center justify-between rounded-md border px-3 py-2">
                              <span className="text-sm">{f.label}</span>
                              <Select
                                value={effectiveFeatureLevel(editing.u, editing.app, f.key)}
                                onValueChange={(v) =>
                                  setFeatureLevel(editing.u.username, editing.app.id, f.key, v as FeatureLevel)
                                }
                              >
                                <SelectTrigger className="w-28">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {FEATURE_LEVELS.map((lv) => (
                                    <SelectItem key={lv} value={lv}>
                                      {FEATURE_LEVEL_LABEL[lv]}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          ))}
                      </div>
                    </div>
                  ))}

                  {/* 多厂区系统：可访问厂区 */}
                  {isQms && (
                    <div>
                      <div className="mb-2 text-xs font-semibold text-slate-400">可访问厂区 / 子公司</div>
                      <div className="space-y-3">
                        {QMS_SITES.map((site) => (
                          <div key={site.id}>
                            <div className="mb-1.5 text-xs text-slate-500">{site.label}</div>
                            <div className="grid grid-cols-2 gap-1.5">
                              {QMS_COMPANIES.filter((c) => c.site === site.id).map((c) => (
                                <label
                                  key={c.id}
                                  className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer hover:bg-slate-50"
                                >
                                  <Checkbox
                                    checked={allowedCompanies.includes(c.id)}
                                    onCheckedChange={(v) => toggleCompany(c.id, v === true)}
                                  />
                                  {c.name}
                                </label>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                      <p className="mt-2 text-xs text-slate-400">至少保留一个厂区；未单独设置时默认全部可访问。</p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  )
}
