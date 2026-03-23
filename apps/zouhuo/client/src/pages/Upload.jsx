import { useState } from 'react';
import { Upload as AntUpload, Button, Input, message, Typography, Space, Table, Tag, Tooltip, Select } from 'antd';
import { InboxOutlined, DeleteOutlined, CheckCircleOutlined, CloseCircleOutlined, LoadingOutlined, LinkOutlined } from '@ant-design/icons';
import axios from 'axios';

const { Title, Text } = Typography;
const { Dragger } = AntUpload;

// 每个上传项：可以是1个或2个文件（自动配对）
let uidCounter = 1;

export default function Upload({ onDone }) {
  const [groups, setGroups] = useState([]);   // [{ gid, files:[{uid,file}], name, status, result, error }]
  const [processing, setProcessing] = useState(false);

  const handleBeforeUpload = (file, allFiles) => {
    // 只在第一个文件时触发批量添加（antd特性）
    if (file !== allFiles[0]) return false;

    const newFiles = allFiles.map(f => ({ uid: uidCounter++, file: f }));

    // 自动把文件两两配对：排模+外购 → 一组；单独的文件单独一组
    const unmatched = [...newFiles];
    const newGroups = [];

    // 简单策略：文件名含"排模"和含"外购"的配对，其余单独一组
    const moldFiles     = unmatched.filter(f => /排模/.test(f.file.name));
    const purchaseFiles = unmatched.filter(f => /外购/.test(f.file.name));
    const otherFiles    = unmatched.filter(f => !/排模|外购/.test(f.file.name));

    // 配对
    const pairCount = Math.min(moldFiles.length, purchaseFiles.length);
    for (let i = 0; i < pairCount; i++) {
      const mf = moldFiles[i], pf = purchaseFiles[i];
      const baseName = mf.file.name.replace(/排模.*?\.(xlsx|xlsm|xls)$/i, '').replace(/-?_?\s*$/, '').trim()
        || mf.file.name.replace(/\.(xlsx|xlsm|xls)$/i, '');
      newGroups.push({ gid: uidCounter++, files: [mf, pf], name: baseName, status: 'pending', result: null, error: null });
    }
    // 剩余未配对的
    for (const f of [...moldFiles.slice(pairCount), ...purchaseFiles.slice(pairCount), ...otherFiles]) {
      newGroups.push({ gid: uidCounter++, files: [f], name: f.file.name.replace(/\.(xlsx|xlsm|xls)$/i, ''), status: 'pending', result: null, error: null });
    }

    setGroups(prev => [...prev, ...newGroups]);
    return false;
  };

  const handleNameChange = (gid, name) => {
    setGroups(prev => prev.map(g => g.gid === gid ? { ...g, name } : g));
  };

  const handleRemove = (gid) => {
    setGroups(prev => prev.filter(g => g.gid !== gid));
  };

  const processOne = async (group) => {
    setGroups(prev => prev.map(g => g.gid === group.gid ? { ...g, status: 'uploading' } : g));
    try {
      const fd = new FormData();
      group.files.forEach(f => fd.append('file', f.file));
      fd.append('productName', group.name);
      const res = await axios.post('/api/upload', fd);
      setGroups(prev => prev.map(g => g.gid === group.gid ? { ...g, status: 'done', result: res.data } : g));
    } catch (err) {
      setGroups(prev => prev.map(g => g.gid === group.gid
        ? { ...g, status: 'error', error: err.response?.data?.message || '处理失败' } : g));
    }
  };

  const handleProcessAll = async () => {
    const pending = groups.filter(g => g.status === 'pending');
    if (pending.length === 0) return message.warning('没有待处理的组');
    setProcessing(true);
    for (const g of pending) await processOne(g);
    setProcessing(false);
    message.success('全部处理完成');
  };

  const pendingCount = groups.filter(g => g.status === 'pending').length;
  const doneCount    = groups.filter(g => g.status === 'done').length;

  const columns = [
    {
      title: '文件',
      key: 'files',
      width: 320,
      render: (_, g) => (
        <Space direction="vertical" size={2}>
          {g.files.map(f => (
            <Text key={f.uid} style={{ fontSize: 12, color: /排模/.test(f.file.name) ? '#1677ff' : /外购/.test(f.file.name) ? '#d48806' : '#555' }}>
              {/排模/.test(f.file.name) ? '📘 ' : /外购/.test(f.file.name) ? '📒 ' : '📄 '}
              {f.file.name}
            </Text>
          ))}
          {g.files.length === 2 && <Tag color="purple" icon={<LinkOutlined />} style={{ fontSize: 11 }}>已配对</Tag>}
        </Space>
      ),
    },
    {
      title: '走货明细名称',
      key: 'name',
      render: (_, g) => (
        <Input
          value={g.name}
          size="small"
          disabled={g.status !== 'pending'}
          onChange={e => handleNameChange(g.gid, e.target.value)}
          style={{ width: 200 }}
        />
      ),
    },
    {
      title: '状态',
      key: 'status',
      width: 220,
      render: (_, g) => {
        if (g.status === 'pending')   return <Tag>待处理</Tag>;
        if (g.status === 'uploading') return <Tag icon={<LoadingOutlined />} color="processing">处理中…</Tag>;
        if (g.status === 'done')      return (
          <Text style={{ color: '#52c41a', fontSize: 12 }}>
            <CheckCircleOutlined /> {g.result?.stats?.total} 条
            （排模 {g.result?.stats?.mold}，外购 {g.result?.stats?.purchase}）
          </Text>
        );
        if (g.status === 'error')     return <Text type="danger" style={{ fontSize: 12 }}><CloseCircleOutlined /> {g.error}</Text>;
      },
    },
    {
      title: '',
      width: 50,
      render: (_, g) => g.status === 'pending' ? (
        <Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={() => handleRemove(g.gid)} />
      ) : null,
    },
  ];

  return (
    <div style={{ maxWidth: 860 }}>
      <Title level={4}>上传 Excel 文件</Title>
      <Text type="secondary" style={{ display: 'block', marginBottom: 20 }}>
        支持 .xlsm / .xlsx 格式。可以拖入<b>多个文件</b>——文件名含「排模」和「外购」的会自动配对合并处理。
      </Text>

      <Dragger
        multiple
        accept=".xlsx,.xlsm,.xls"
        beforeUpload={handleBeforeUpload}
        showUploadList={false}
        fileList={[]}
        style={{ marginBottom: 20 }}
      >
        <p className="ant-upload-drag-icon">
          <InboxOutlined style={{ fontSize: 40, color: '#1677ff' }} />
        </p>
        <p className="ant-upload-text">点击或将文件拖到此区域</p>
        <p className="ant-upload-hint">
          文件名含「排模」+「外购」的会自动配对 · 支持一次拖入多组文件
        </p>
      </Dragger>

      {groups.length > 0 && (
        <>
          <Table
            columns={columns}
            dataSource={groups}
            rowKey="gid"
            size="small"
            pagination={false}
            style={{ marginBottom: 16 }}
          />
          <Space>
            <Button type="primary" size="large" loading={processing} disabled={pendingCount === 0} onClick={handleProcessAll}>
              {processing ? '处理中…' : `开始处理（${pendingCount} 组）`}
            </Button>
            {doneCount > 0 && <Button size="large" onClick={onDone}>查看结果（{doneCount} 个完成）</Button>}
            <Button size="large" onClick={() => setGroups([])}>清空</Button>
          </Space>
        </>
      )}
    </div>
  );
}
