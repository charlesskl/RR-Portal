import { useState } from 'react'
import { Alert, Button, Checkbox, Modal, Table, Typography } from 'antd'
import type { ShipmentImportSource as Source, ShipmentSourceCell } from '../api/client'

/** Original cached values are evidence, not live formulas or current editor values. */
export default function ShipmentImportSource({ source }: { source?: Source }) {
  const [open, setOpen] = useState(false)
  const [showEmpty, setShowEmpty] = useState(false)
  if (!source) return null
  const populated = (cell: ShipmentSourceCell) => cell.value != null && cell.value !== '' || !!cell.formula || !!cell.error
  const cells = showEmpty ? source.cells : source.cells.filter(populated)
  return <>
    <Button type="link" size="small" onClick={() => setOpen(true)}>原表资料</Button>
    <Modal title={`原表资料 — ${source.sheet} 第 ${source.row} 行`} open={open} width={980}
      onCancel={() => setOpen(false)} footer={<Button onClick={() => setOpen(false)}>关闭</Button>}>
      <Alert type="info" showIcon message="保存导入时的原始资料供核对，空白、零值、文本编号和公式缓存值分别保留；不执行公式。这不是当前编辑值，发票金额仍按系统规则计算，原表柜号、运费等不会覆盖整柜设置。" />
      <Typography.Paragraph>{source.file || 'Excel'} · 已识别 {source.cells.length} 列，其中 {source.cells.filter(populated).length} 列有内容</Typography.Paragraph>
      <Checkbox checked={showEmpty} onChange={e => setShowEmpty(e.target.checked)}>显示空白列</Checkbox>
      <Table<ShipmentSourceCell> rowKey={cell => `${cell.address}:${cell.label}`} size="small" pagination={false}
        dataSource={cells} scroll={{ y: 420 }} columns={[
          { title: '位置', dataIndex: 'address', width: 80 },
          { title: '原表字段', dataIndex: 'label', width: 220, render: value => <span style={{ whiteSpace: 'pre-wrap' }}>{value}</span> },
          { title: '原表内容', render: (_, cell) => <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {cell.error ? '公式无有效结果（未作为业务数值导入）' : cell.display || (cell.value == null ? '—' : String(cell.value))}
            {cell.formula && <div style={{ color: '#888', fontSize: 12 }}>源公式：{cell.formula}</div>}
          </span> },
        ]} />
      {source.context.length > 0 && <details><summary>表头备注及设置（仅留存，不自动覆盖整柜）</summary>
        {source.context.map(cell => <div key={cell.address}>{cell.address}：{cell.error ? '公式无有效结果' : cell.display}</div>)}
      </details>}
    </Modal>
  </>
}
