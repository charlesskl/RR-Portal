import { useEffect, useRef, useState } from 'react'
import { InputNumber } from 'antd'
import { useShipmentSheetDraft } from './ShipmentSheetDraft'

// Commit an entered total only once, not every intermediate digit/empty value.
export default function ShipmentNumberCell({ value, onCommit, title, integer = false, precision }: {
  value?: number; onCommit: (value: number) => void | boolean | Promise<boolean>; title?: string; integer?: boolean; precision?: number
}) {
  const [draft, setDraft] = useState<number | null>(value ?? null)
  const pending = useRef<Promise<boolean> | null>(null)
  useEffect(() => { setDraft(value ?? null) }, [value])
  const commit = (): Promise<boolean> => {
    if (pending.current) return pending.current
    if (draft == null) { setDraft(value ?? null); return Promise.resolve(true) }
    if (draft === (value ?? 0)) return Promise.resolve(true)
    const task = Promise.resolve(onCommit(draft)).then(result => {
      const accepted = result !== false
      if (!accepted) setDraft(value ?? null)
      return accepted
    })
    pending.current = task
    const clear = () => { if (pending.current === task) pending.current = null }
    void task.then(clear, clear)
    return task
  }
  useShipmentSheetDraft(commit, () => pending.current)
  return <InputNumber size="small" controls={false} min={0} step={integer ? 1 : precision == null ? .0001 : 10 ** -precision}
    precision={integer ? 0 : precision} value={draft} title={title} style={{ width: '100%' }}
    onChange={setDraft} onBlur={commit} onKeyDown={event => {
      if (event.key === 'Escape') setDraft(value ?? null)
    }} />
}
