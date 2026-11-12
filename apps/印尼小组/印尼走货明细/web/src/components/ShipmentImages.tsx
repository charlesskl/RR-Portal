import { useLayoutEffect, useRef, useState } from 'react'
import { App, Button, Image, Modal, Space, Upload } from 'antd'
import { compressShipmentImage } from '../utils/shipmentImages'

export default function ShipmentImages({ images, onChange }: {
  images: string[]; onChange?: (images: string[]) => void | boolean
}) {
  const { message } = App.useApp()
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false)
  const active = useRef<object | null>(null)
  const pending = useRef(false)
  const signature = JSON.stringify(images)
  useLayoutEffect(() => {
    const context = {}; active.current = context
    return () => { if (active.current === context) active.current = null }
  }, [signature, onChange])
  return <>
    <Button type="text" size="small" onClick={() => setOpen(true)} style={{ padding: 0, height: 'auto' }} aria-label={`查看图片（${images.length}张）`}>
      {images.length ? <span><img src={images[0]} style={{ width: 36, height: 36, objectFit: 'contain' }} /><small style={{ display: 'block' }}>{images.length} 张</small></span> : onChange ? '添加图片' : '无图片'}
    </Button>
    <Modal title={`本行图片（${images.length} 张）`} open={open} footer={null} onCancel={() => { if (!busy) setOpen(false) }}
      closable={!busy} maskClosable={!busy} keyboard={!busy} destroyOnHidden>
      <Space direction="vertical" style={{ width: '100%' }}>
        {onChange && <Upload multiple accept="image/png,image/jpeg,image/webp,image/bmp,image/gif" showUploadList={false} disabled={busy}
          beforeUpload={async (file, list) => {
            if (file !== list[0] || pending.current) return false
            pending.current = true; setBusy(true)
            const context = active.current
            try {
              const added: string[] = []
              for (const image of list) added.push(await compressShipmentImage(image))
              if (!context || active.current !== context) { message.warning('明细已变化，请重新添加图片'); return false }
              const next = [...new Set([...images, ...added])]
              if (next.reduce((size, image) => size + image.length, 0) > 256 * 1024) throw new Error('本行图片较多，请减少图片后再添加')
              onChange(next)
            } catch (error) { message.error(error instanceof Error ? error.message : '图片读取失败') }
            finally { pending.current = false; if (active.current) setBusy(false) }
            return false
          }}><Button loading={busy}>添加图片（可多选）</Button></Upload>}
        <Image.PreviewGroup>{images.map((image, index) => <Space key={index} direction="vertical" style={{ margin: 8 }}>
          <Image width={120} height={100} style={{ objectFit: 'contain' }} src={image} />
          {onChange && <Button size="small" disabled={busy} onClick={() => onChange(images.filter((_, i) => i !== index))}>移除第 {index + 1} 张</Button>}
        </Space>)}</Image.PreviewGroup>
      </Space>
    </Modal>
  </>
}
