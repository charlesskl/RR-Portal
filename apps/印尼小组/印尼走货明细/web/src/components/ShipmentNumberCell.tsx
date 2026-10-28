import { useEffect, useState } from 'react'
import { InputNumber } from 'antd'

// Commit an entered total only once, not every intermediate digit/empty value.
export default function ShipmentNumberCell({ value, onCommit, title, integer = false }: {
  value?: number; onCommit: (value: number) => void | boolean | Promise<boolean>; title?: string; integer?: boolean
}) {
  const [draft, setDraft] = useState<number | null>(value ?? null)
  useEffect(() => { setDraft(value ?? null) }, [value])
  return <InputNumber size="small" controls={false} min={0} step={integer ? 1 : .0001}
    precision={integer ? 0 : undefined} value={draft} title={title} style={{ width: '100%' }}
    onChange={setDraft} onBlur={async () => {
      if (draft == null) { setDraft(value ?? null); return }
      if (draft !== (value ?? 0) && await onCommit(draft) === false) setDraft(value ?? null)
    }} onKeyDown={event => {
      if (event.key === 'Escape') setDraft(value ?? null)
    }} />
}
