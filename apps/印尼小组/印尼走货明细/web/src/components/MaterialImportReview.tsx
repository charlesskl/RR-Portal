import { useState } from 'react'
import { Button, Select, Space, Table, Tag } from 'antd'
import type { Material } from '../api/client'
import type { ImportChoice } from '../utils/materialImportMerge'

export function MaterialImportReview({ rows, pending, recommended, onChange }: {
  rows: Material[]; pending: Material[]; recommended: ImportChoice[]; onChange: (choices: ImportChoice[]) => void
}) {
  const [choices, setChoices] = useState(recommended)
  const update = (next: ImportChoice[]) => { setChoices(next); onChange(next) }
  return <div>
    <p>已选好可推荐的旧物料，核对后直接确认。无法确定的默认跳过，不会新增重复记录。</p>
    <Space wrap style={{ marginBottom: 12 }}>
      <Tag color="blue">覆盖 {choices.filter(c => typeof c === 'number').length}</Tag>
      <Tag>新增 {choices.filter(c => c === 'add').length}</Tag>
      <Tag>跳过 {choices.filter(c => c === 'skip').length}</Tag>
      <Button size="small" onClick={() => update([...recommended])}>恢复推荐</Button>
      <Button size="small" onClick={() => update(pending.map(() => 'skip'))}>全部跳过</Button>
    </Space>
    <Table size="small" pagination={false} scroll={{ y: 380, x: 620 }} rowKey="index"
      dataSource={pending.map((material, index) => ({ material, index }))}
      columns={[
        { title: '导入物料', width: 270, render: (_, { material }) => <div><b>{material.name_zh}</b><div style={{ color: '#666', fontSize: 12 }}>{material.spec || '未填规格'}</div></div> },
        { title: '处理方式 / 对应旧物料', width: 350, render: (_, { index }) => <Select
          style={{ width: '100%' }} value={choices[index]} showSearch optionFilterProp="label"
          aria-label={`处理物料 ${index + 1}`}
          onChange={(value: ImportChoice) => update(choices.map((old, i) => i === index ? value : old))}
          options={[
            { value: 'skip', label: '跳过（不导入）' }, { value: 'add', label: '作为新物料添加' },
            ...rows.map((row, rowIndex) => ({ value: rowIndex,
              label: `覆盖：${row.name_zh || '未命名'} · ${row.spec || '无规格'} (#${row.id || rowIndex + 1})`,
              disabled: choices.some((choice, i) => i !== index && choice === rowIndex),
            })),
          ]} /> },
      ]} />
    <p style={{ marginTop: 10, color: '#666', fontSize: 12 }}>保留旧记录关联、启停状态及手工装箱资料；无新图时保留旧图。确认后仍需点击“保存”。</p>
  </div>
}
