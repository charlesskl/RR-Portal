import { useState } from 'react';
import { Upload, Button, Select, Typography, Table, message, Space, Card, Input } from 'antd';
import { InboxOutlined, FileWordOutlined, LoadingOutlined } from '@ant-design/icons';
import axios from 'axios';

const { Title, Text } = Typography;
const { Dragger } = Upload;
const { Option } = Select;

export default function AdocPage() {
  const [parsing, setParsing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [materials, setMaterials] = useState([]);
  const [records, setRecords] = useState([]);
  const [selectedMaterial, setSelectedMaterial] = useState(null);
  const [supplierName, setSupplierName] = useState('');

  const handleUpload = async (file) => {
    setParsing(true);
    setMaterials([]);
    setRecords([]);
    setSelectedMaterial(null);
    try {
      const formData = new FormData();
      formData.append('pdf', file);
      const res = await axios.post('/api/adoc/parse', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setMaterials(res.data.materials);
      setRecords(res.data.records);
      message.success(`解析完成，共找到 ${res.data.materials.length} 种材料`);
    } catch (e) {
      message.error(e.response?.data?.message || e.message || '解析失败', 10);
    } finally {
      setParsing(false);
    }
    return false; // prevent antd auto upload
  };

  const handleGenerate = async () => {
    if (!records.length) return message.warning('请先上传并解析 PDF');
    if (!selectedMaterial) return message.warning('请选择材料');
    setGenerating(true);
    try {
      const res = await axios.post('/api/adoc/generate',
        { records, materialCode: selectedMaterial, supplierName },
        { responseType: 'blob' },
      );
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `TOMY A-DOC ${selectedMaterial}.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      message.error('生成失败');
    } finally {
      setGenerating(false);
    }
  };

  const filtered = selectedMaterial ? records.filter(r => r.materialCode === selectedMaterial) : [];

  const columns = [
    { title: 'No', dataIndex: '_no', key: '_no', width: 50, render: (_, __, i) => i + 1 },
    { title: 'Substance name', dataIndex: 'substanceName', key: 'substanceName', ellipsis: true },
    { title: 'CAS No.', dataIndex: 'casNumber', key: 'casNumber', width: 120 },
    { title: 'Category/Origin', dataIndex: 'category', key: 'category', ellipsis: true },
    { title: 'Conc % Product', dataIndex: 'concProduct', key: 'concProduct', width: 130 },
    { title: 'Conc % HM', dataIndex: 'concHM', key: 'concHM', width: 110 },
    { title: 'Affected material', dataIndex: 'materialDescription', key: 'materialDescription', ellipsis: true },
    { title: 'Intentionally use?', key: 'intent', width: 130, render: () => 'Yes' },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Title level={3}>TOMY A-DOC 生成</Title>

      <Card title="第一步：上传 PDF" style={{ marginBottom: 16 }}>
        <Dragger
          accept=".pdf"
          beforeUpload={handleUpload}
          showUploadList={false}
          multiple={false}
          disabled={parsing}
        >
          <p className="ant-upload-drag-icon">
            {parsing ? <LoadingOutlined /> : <InboxOutlined />}
          </p>
          <p className="ant-upload-text">点击或拖拽 TOMY Substance On Watch Alert PDF 文件</p>
          <p className="ant-upload-hint">仅支持 PDF 格式</p>
        </Dragger>
      </Card>

      {materials.length > 0 && (
        <Card title="第二步：选择材料并生成 A-DOC" style={{ marginBottom: 16 }}>
          <Space direction="vertical" style={{ width: '100%' }}>
            <Space wrap>
              <Text>供应商名称：</Text>
              <Input
                placeholder="可选，留空则空白"
                value={supplierName}
                onChange={e => setSupplierName(e.target.value)}
                style={{ width: 280 }}
              />
            </Space>
            <Space wrap>
              <Text>选择材料：</Text>
              <Select
                style={{ width: 320 }}
                placeholder="请选择材料"
                onChange={setSelectedMaterial}
                value={selectedMaterial}
              >
                {materials.map(m => (
                  <Option key={m.code} value={m.code}>
                    {m.code} — {m.description} ({m.count} 种物质)
                  </Option>
                ))}
              </Select>
              <Button
                type="primary"
                icon={<FileWordOutlined />}
                loading={generating}
                onClick={handleGenerate}
                disabled={!selectedMaterial}
              >
                生成 A-DOC PDF
              </Button>
            </Space>
          </Space>
        </Card>
      )}

      {filtered.length > 0 && (
        <Card title={`预览：${selectedMaterial} 含 ${filtered.length} 种物质`}>
          <Table
            dataSource={filtered}
            columns={columns}
            rowKey={(_, i) => i}
            size="small"
            pagination={false}
            scroll={{ x: 1200 }}
          />
        </Card>
      )}
    </div>
  );
}
