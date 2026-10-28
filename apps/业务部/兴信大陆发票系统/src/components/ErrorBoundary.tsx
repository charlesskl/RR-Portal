import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { error: Error | null }

/**
 * 顶层错误边界：任何 render 期异常不再整页白屏，而是显示错误内容，
 * 方便文员截图反馈（2026-10-19 兴信选日期白屏问题定位用）。
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div style={{ maxWidth: 720, margin: '80px auto', padding: 24, fontFamily: 'sans-serif' }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12 }}>页面出错了（请截图发给维护人）</h1>
        <p style={{ color: '#666', marginBottom: 12 }}>
          操作到这一步时页面崩溃。下面这段错误信息就是定位线索，截图时请完整带上。
        </p>
        <pre style={{
          background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8,
          padding: 16, fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: '#991b1b',
        }}>
          {String(error && error.stack ? error.stack : error)}
        </pre>
        <button
          onClick={() => window.location.reload()}
          style={{
            marginTop: 16, padding: '8px 20px', borderRadius: 8, border: '1px solid #0f766e',
            background: '#0f766e', color: '#fff', cursor: 'pointer',
          }}
        >
          刷新重试
        </button>
      </div>
    )
  }
}
