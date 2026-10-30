import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Input } from 'antd'
import { useShipmentSheetDraft } from './ShipmentSheetDraft'

/** Keep typing/IME local; validating the whole sheet on each letter resets the caret. */
export default function ShipmentTextCell({ value = '', onCommit, multiline = false, format, ...props }: {
  value?: string
  onCommit: (value: string) => void | boolean | Promise<boolean>
  multiline?: boolean
  format?: (value: string) => string
  placeholder?: string
  title?: string
  inputMode?: 'numeric'
  maxLength?: number
  'aria-label'?: string
  style?: CSSProperties
}) {
  const [draft, setDraft] = useState(value)
  const composing = useRef(false)
  const revision = useRef(0)
  const pending = useRef<Promise<boolean> | null>(null)
  const update = (text: string) => { revision.current++; setDraft(text) }
  useEffect(() => { update(value) }, [value])
  const commit = (text = draft): Promise<boolean> => {
    if (pending.current) return pending.current
    if (composing.current) return Promise.resolve(false)
    const formatted = format ? format(text) : text
    update(formatted)
    if (formatted === value) return Promise.resolve(true)
    const atCommit = revision.current
    const task = Promise.resolve(onCommit(formatted)).then(result => {
      const accepted = result !== false
      if (!accepted && revision.current === atCommit) update(value)
      return accepted
    })
    pending.current = task
    const clear = () => { if (pending.current === task) pending.current = null }
    void task.then(clear, clear)
    return task
  }
  useShipmentSheetDraft(() => commit(), () => pending.current)
  const editorProps = {
    ...props, size: 'small' as const, value: draft,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => update(event.target.value),
    onCompositionStart: () => { composing.current = true },
    onCompositionEnd: (event: React.CompositionEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      composing.current = false; update(event.currentTarget.value)
    },
    onBlur: async (event: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      composing.current = false
      await commit(event.currentTarget.value)
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
      if (event.key === 'Escape') update(value)
    },
  }
  return multiline ? <Input.TextArea {...editorProps} autoSize={{ minRows: 1, maxRows: 4 }} /> : <Input {...editorProps} />
}
