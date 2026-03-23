import { useState, useEffect } from 'react';
import { Table, Button, Tag, Space, message, Popconfirm, Typography, Drawer, Modal, Input } from 'antd';
import { PlusOutlined, DeleteOutlined, EyeOutlined, DownloadOutlined, MergeCellsOutlined } from '@ant-design/icons';
import axios from 'axios';
import dayjs from 'dayjs';
import { downloadBlob } from '../utils/download';

const { Title, Text } = Typography;

function RowsDrawer({ product, open, onClose }) {
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open || !product) return;
    setLoading(true);
    axios.get(`/api/products/${product._id}/rows`)
      .then(r => setRows(r.data.rows))
      .finally(() => setLoading(false));
  }, [open, product]);

  const columns = [
    { title: '序号', dataIndex: 'seq', width: 55 },
    { title: '产品编号', dataIndex: 'prodNo', width: 100 },
    { title: '部件名称', dataIndex: 'partName', width: 160 },
    { title: '材料/规格', dataIndex: 'material', width: 140 },
    { title: '单位', dataIndex: 'unit', width: 55 },
    { title: '用量', dataIndex: 'qty', width: 60 },
    { title: '供应商', dataIndex: 'supplier', width: 110, render: v => v || '-' },
    { title: '单重(kg)', dataIndex: 'unitWt', width: 90, render: v => v || '-' },
    { title: '来源', dataIndex: 'source', width: 65,
      render: (s, r) => <Tag color={r.type === 'mold' ? 'blue' : 'gold'}>{s}</Tag> },
    { title: '类别', dataIndex: 'category', width: 80, render: v => v || '-' },
    { title: '生产地', dataIndex: 'prodPlace', width: 80, render: v => v || '-' },
  ];

  return (
    <Drawer
      title={
        <Space>
          <span>走货明细 — {product?.name}</span>
          <Button type="primary" size="small" icon={<DownloadOutlined />}
            onClick={() => downloadBlob(`/api/products/${product._id}/export`, `${product.name}_走货明细.xlsx`, '导出失败')}>
            导出 Excel
          </Button>
          <Button size="small" icon={<DownloadOutlined />}
            onClick={() => downloadBlob(`/api/products/${product._id}/bom`, `${product.name}_BOM图.xlsx`, 'BOM图导出失败')}>
            BOM图
          </Button>
        </Space>
      }
      open={open}
      onClose={onClose}
      width="90%"
    >
      <div style={{ marginBottom: 10 }}>
        <Text type="secondary">产品编号：{product?.prodNo || '-'} &nbsp;|&nbsp; 共 {rows.length} 条
          （<span style={{ color: '#4472C4' }}>蓝=排模</span>，<span style={{ color: '#d48806' }}>黄=外购</span>）
        </Text>
      </div>
      <Table
        columns={columns}
        dataSource={rows}
        rowKey="_id"
        loading={loading}
        size="small"
        scroll={{ x: 1000 }}
        pagination={{ pageSize: 100, showTotal: t => `共 ${t} 条` }}
        onRow={(r) => ({ style: { background: r.color } })}
      />
    </Drawer>
  );
}

export default function ProductList({ onUpload }) {
  const [products, setProducts]       = useState([]);
  const [loading, setLoading]         = useState(true);
  const [selected, setSelected]       = useState(null);
  const [drawerOpen, setDrawerOpen]   = useState(false);
  const [selectedKeys, setSelectedKeys] = useState([]);
  const [mergeModal, setMergeModal]   = useState(false);
  const [mergeName, setMergeName]     = useState('');
  const [merging, setMerging]         = useState(false);

  const load = () => {
    setLoading(true);
    axios.get('/api/products')
      .then(r => { setProducts(r.data); setSelectedKeys([]); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleDelete = async (id) => {
    try {
      await axios.delete(`/api/products/${id}`);
      message.success('已删除');
      load();
    } catch (err) {
      message.error(err.response?.data?.message || '删除失败');
    }
  };

  const openMerge = () => {
    const names = selectedKeys.map(id => products.find(p => p._id === id)?.name).filter(Boolean);
    setMergeName(names.join(' + '));
    setMergeModal(true);
  };

  const handleMerge = async () => {
    if (!mergeName.trim()) return message.error('请填写合并后的名称');
    setMerging(true);
    try {
      const res = await axios.post('/api/merge', { ids: selectedKeys, name: mergeName.trim() });
      message.success(res.data.message);
      setMergeModal(false);
      load();
    } catch (err) {
      message.error(err.response?.data?.message || '合并失败');
    } finally {
      setMerging(false);
    }
  };

  const rowSelection = {
    selectedRowKeys: selectedKeys,
    onChange: (keys) => setSelectedKeys(keys),
  };

  const columns = [
    {
      title: '走货明细名称', dataIndex: 'name', key: 'name',
      render: (name, r) => (
        <a onClick={() => { setSelected(r); setDrawerOpen(true); }} style={{ color: '#1677ff' }}>{name}</a>
      ),
    },
    { title: '产品编号', dataIndex: 'prodNo', key: 'prodNo', render: v => v || '-' },
    { title: '排模行', key: 'mold',     render: (_, r) => <Tag color="blue">{r.stats?.mold ?? 0}</Tag> },
    { title: '外购行', key: 'purchase', render: (_, r) => <Tag color="gold">{r.stats?.purchase ?? 0}</Tag> },
    { title: '合计',   key: 'total',    render: (_, r) => r.stats?.total ?? 0 },
    { title: '文件名', dataIndex: 'fileName', key: 'fileName',
      render: v => <Text type="secondary" style={{ fontSize: 12 }}>{v}</Text> },
    { title: '上传时间', dataIndex: 'createdAt', key: 'createdAt',
      render: d => dayjs(d).format('YYYY-MM-DD HH:mm') },
    {
      title: '操作', key: 'action',
      render: (_, r) => (
        <Space>
          <Button type="link" size="small" icon={<EyeOutlined />}
            onClick={() => { setSelected(r); setDrawerOpen(true); }}>查看</Button>
          <Button type="link" size="small" icon={<DownloadOutlined />}
            onClick={() => downloadBlob(`/api/products/${r._id}/export`, `${r.name}_走货明细.xlsx`, '导出失败')}>导出</Button>
          <Button type="link" size="small" icon={<DownloadOutlined />}
            onClick={() => downloadBlob(`/api/products/${r._id}/bom`, `${r.name}_BOM图.xlsx`, 'BOM图导出失败')}>BOM图</Button>
          <Popconfirm title="确定删除此记录？" onConfirm={() => handleDelete(r._id)}>
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>走货明细列表</Title>
        <Space>
          {selectedKeys.length >= 2 && (
            <Button icon={<MergeCellsOutlined />} onClick={openMerge}>
              合并选中 ({selectedKeys.length} 条)
            </Button>
          )}
          <Button type="primary" icon={<PlusOutlined />} onClick={onUpload}>上传新文件</Button>
        </Space>
      </div>

      {products.length === 0 && !loading ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: '#999' }}>
          <p>还没有走货明细记录</p>
          <Button type="primary" onClick={onUpload}>上传第一个文件</Button>
        </div>
      ) : (
        <Table
          rowSelection={rowSelection}
          columns={columns}
          dataSource={products}
          rowKey="_id"
          loading={loading}
          pagination={{ pageSize: 20, showTotal: t => `共 ${t} 条` }}
        />
      )}

      <RowsDrawer product={selected} open={drawerOpen} onClose={() => setDrawerOpen(false)} />

      <Modal
        title="合并走货明细"
        open={mergeModal}
        onOk={handleMerge}
        onCancel={() => setMergeModal(false)}
        confirmLoading={merging}
        okText="确认合并"
      >
        <p style={{ color: '#666', marginBottom: 12 }}>
          将选中的 {selectedKeys.length} 条记录合并成一条（排模行在前，外购行在后）
        </p>
        <Input
          placeholder="合并后的走货明细名称"
          value={mergeName}
          onChange={e => setMergeName(e.target.value)}
        />
      </Modal>
    </div>
  );
}
