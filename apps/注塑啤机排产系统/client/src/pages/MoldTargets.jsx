import { useState, useEffect } from 'react';
import { Table, Button, Card, Space, message, Input, InputNumber, Popconfirm, Modal, Form, Upload } from 'antd';
import { PlusOutlined, UploadOutlined, DeleteOutlined, DatabaseOutlined, ClearOutlined } from '@ant-design/icons';
import axios from 'axios';

const API = '/api/mold-targets';

export default function MoldTargets({ workshop = 'B' }) {
  const [targets, setTargets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form] = Form.useForm();
  const [search, setSearch] = useState('');
  const [selectedRowKeys, setSelectedRowKeys] = useState([]);

  const fetchTargets = async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(API, { params: { workshop } });
      setTargets(data);
    } catch (e) {
      message.error('获取数据失败');
    }
    setLoading(false);
  };

  useEffect(() => { fetchTargets(); }, [workshop]);

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      if (editingId) {
        await axios.put(`${API}/${editingId}`, values);
        message.success('更新成功');
      } else {
        await axios.post(API, { ...values, workshop });
        message.success('添加成功');
      }
      setModalOpen(false);
      setEditingId(null);
      form.resetFields();
      fetchTargets();
    } catch (e) {
      if (e.response) message.error(e.response.data.message);
    }
  };

  const handleEdit = (record) => {
    setEditingId(record.id);
    form.setFieldsValue(record);
    setModalOpen(true);
  };

  const handleDelete = async (id) => {
    await axios.delete(`${API}/${id}`);
    message.success('已删除');
    fetchTargets();
  };

  const handleBatchDelete = async () => {
    try {
      const { data } = await axios.post(`${API}/batch-delete`, { ids: selectedRowKeys });
      message.success(data.message);
      setSelectedRowKeys([]);
      fetchTargets();
    } catch (e) {
      message.error('删除失败');
    }
  };

  const handleDeleteAll = async () => {
    try {
      const { data } = await axios.delete(API, { params: { workshop } });
      message.success(data.message);
      setSelectedRowKeys([]);
      fetchTargets();
    } catch (e) {
      message.error('删除失败');
    }
  };

  const handleImportHistory = async () => {
    try {
      const { data } = await axios.post(`${API}/import-from-history`, { workshop });
      message.success(data.message);
      fetchTargets();
    } catch (e) {
      message.error('导入失败');
    }
  };

  const handleUploadExcel = async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('workshop', workshop);
    try {
      const { data } = await axios.post(`${API}/import-excel`, formData);
      message.success(data.message);
      fetchTargets();
    } catch (e) {
      message.error('导入失败：' + (e.response?.data?.message || e.message));
    }
    return false;
  };

  const filtered = search
    ? targets.filter(t => t.mold_no.includes(search) || (t.mold_name || '').includes(search))
    : targets;

  const columns = [
    { title: '模具编号', dataIndex: 'mold_no', width: 180 },
    { title: '模具名称', dataIndex: 'mold_name', width: 200 },
    { title: '24H目标', dataIndex: 'target_24h', width: 100,
      render: v => <strong style={{ color: '#1677ff' }}>{v}</strong>
    },
    { title: '11H目标', dataIndex: 'target_11h', width: 100,
      render: v => <strong style={{ color: '#52c41a' }}>{v}</strong>
    },
    { title: '备注', dataIndex: 'notes', ellipsis: true },
    { title: '操作', width: 150,
      render: (_, r) => (
        <Space>
          <Button size="small" onClick={() => handleEdit(r)}>编辑</Button>
          <Popconfirm title="确定删除？" onConfirm={() => handleDelete(r.id)}>
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      )
    },
  ];

  return (
    <div>
      <Card size="small">
        <Space style={{ marginBottom: 16 }} wrap>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditingId(null); form.resetFields(); setModalOpen(true); }}>
            新增模具目标
          </Button>
          <Popconfirm title="从历史数据库导入已有的目标数？" onConfirm={handleImportHistory}>
            <Button icon={<DatabaseOutlined />}>从历史记录导入</Button>
          </Popconfirm>
          <Upload accept=".xls,.xlsx" showUploadList={false} beforeUpload={handleUploadExcel}>
            <Button icon={<UploadOutlined />}>导入Excel</Button>
          </Upload>
          {selectedRowKeys.length > 0 && (
            <Popconfirm title={`确定删除选中的 ${selectedRowKeys.length} 条？`} onConfirm={handleBatchDelete}>
              <Button danger icon={<DeleteOutlined />}>删除选中 ({selectedRowKeys.length})</Button>
            </Popconfirm>
          )}
          <Popconfirm title={`确定清空全部 ${targets.length} 条模具目标？此操作不可恢复！`} onConfirm={handleDeleteAll} okText="确定清空" okButtonProps={{ danger: true }}>
            <Button danger icon={<ClearOutlined />}>清空全部</Button>
          </Popconfirm>
          <Input.Search placeholder="搜索模具编号/名称" onSearch={setSearch} onChange={e => !e.target.value && setSearch('')} style={{ width: 250 }} allowClear />
          <span style={{ color: '#999' }}>共 {filtered.length} 条</span>
        </Space>
        <Table
          columns={columns}
          dataSource={filtered}
          rowKey="id"
          loading={loading}
          size="small"
          pagination={{ pageSize: 50 }}
          rowSelection={{
            selectedRowKeys,
            onChange: setSelectedRowKeys,
          }}
        />
      </Card>

      <Modal
        title={editingId ? '编辑模具目标' : '新增模具目标'}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => { setModalOpen(false); setEditingId(null); }}
        okText="保存"
        cancelText="取消"
      >
        <Form form={form} layout="vertical">
          <Form.Item name="mold_no" label="模具编号" rules={[{ required: true, message: '请输入模具编号' }]}>
            <Input placeholder="如 MCKP-01M-01" />
          </Form.Item>
          <Form.Item name="mold_name" label="模具名称">
            <Input placeholder="如 洗手盆模" />
          </Form.Item>
          <Form.Item name="target_24h" label="24H目标">
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="target_11h" label="11H目标">
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="notes" label="备注">
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
