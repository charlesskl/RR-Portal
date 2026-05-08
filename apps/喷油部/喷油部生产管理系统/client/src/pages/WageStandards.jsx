import { useEffect, useState } from 'react';
import { Table, Button, Space, InputNumber, Input, Popconfirm, message } from 'antd';
import api from '../api';

export default function WageStandards() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try { setList((await api.get('/wage-standards')).data); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const onSave = async (row) => {
    if (!row.technique || !row.worker_count) { message.warning('工序和人数必填'); return; }
    await api.post('/wage-standards', {
      technique: row.technique,
      worker_count: Number(row.worker_count),
      unit_wage: Number(row.unit_wage) || 0,
    });
    message.success('已保存');
    load();
  };

  const onDelete = async (id) => {
    await api.delete(`/wage-standards/${id}`);
    load();
  };

  const onSuggest = async () => {
    const { data } = await api.post('/wage-standards/suggest-from-history');
    message.success(`已从历史新增 ${data.added} 条`);
    load();
  };

  const onAdd = () => {
    setList([...list, { technique: '', worker_count: 1, unit_wage: 0, _new: true }]);
  };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>标准价表</h2>
      <Space style={{ marginBottom: 12 }}>
        <Button onClick={onAdd}>+ 新增一行</Button>
        <Button type="primary" onClick={onSuggest}>从历史推导</Button>
      </Space>
      <Table
        rowKey={r => r.id || `new-${list.indexOf(r)}`}
        loading={loading}
        dataSource={list}
        pagination={false}
        size="middle"
        columns={[
          { title: '工序', dataIndex: 'technique', width: 160, render: (v, row, i) =>
            <Input value={v} placeholder="如:喷油"
              onChange={e => { const n=[...list]; n[i].technique = e.target.value; setList(n); }}
              style={{ width: 140 }} /> },
          { title: '人数', dataIndex: 'worker_count', width: 100, render: (v, row, i) =>
            <InputNumber min={1} value={v}
              onChange={val => { const n=[...list]; n[i].worker_count = val; setList(n); }} /> },
          { title: '建议工价', dataIndex: 'unit_wage', width: 140, render: (v, row, i) =>
            <InputNumber min={0} step={0.001} value={v}
              onChange={val => { const n=[...list]; n[i].unit_wage = val; setList(n); }} /> },
          { title: '操作', width: 200, render: (_, row) => (
            <Space>
              <Button size="small" type="primary" onClick={() => onSave(row)}>保存</Button>
              {row.id && (
                <Popconfirm title="删除这一条?" onConfirm={() => onDelete(row.id)}>
                  <Button size="small" danger>删除</Button>
                </Popconfirm>
              )}
            </Space>
          )},
        ]}
      />
    </div>
  );
}
