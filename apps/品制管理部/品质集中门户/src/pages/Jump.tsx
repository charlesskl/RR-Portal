// 系统内「切换系统」中转页：/#/jump?app=<系统id>
// 在门户当前会话下签发票据并跳转到目标系统，实现系统间免登直达
import { useEffect, useState } from 'react'
import { useSearchParams, Navigate, Link } from 'react-router'
import { useAuth } from '@/lib/auth'
import { Loader2 } from 'lucide-react'

export default function JumpPage() {
  const [params] = useSearchParams()
  const appId = params.get('app') ?? ''
  const { user, jumpApp } = useAuth()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    if (!appId) {
      setError('缺少目标系统参数')
      return
    }
    void jumpApp(appId).then((err) => {
      if (err) setError(err)
    })
  }, [user, appId, jumpApp])

  if (!user) return <Navigate to="/login" replace />

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 text-slate-700">
      {error ? (
        <>
          <p className="text-base font-medium text-red-600">{error}</p>
          <Link to="/" className="text-sm text-blue-600 underline">
            返回门户首页
          </Link>
        </>
      ) : (
        <>
          <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
          <p className="text-sm">正在跳转到目标系统…</p>
        </>
      )}
    </div>
  )
}
