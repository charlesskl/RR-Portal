import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Progress,
  Row,
  Space,
  Spin,
  Statistic,
  Tag,
  Typography,
  Upload,
  message,
} from 'antd';
import {
  DownloadOutlined,
  InboxOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  TranslationOutlined,
} from '@ant-design/icons';
import axios from 'axios';

import { downloadBlob } from '../utils/download';
import {
  canDownload,
  canStart,
  completionNotice,
  progressPercent,
  shouldPoll,
  statusLabel,
} from './excelTranslateState';

const { Title, Paragraph, Text } = Typography;
const { Dragger } = Upload;
const JOB_STORAGE_KEY = 'excelTranslationJobId';

function statusColor(status) {
  if (status === 'completed') return 'success';
  if (status === 'completed_with_warnings') return 'warning';
  if (status === 'failed') return 'error';
  if (status === 'ready') return 'blue';
  return 'processing';
}

export default function ExcelTranslatePage() {
  const [jobId, setJobId] = useState(() => localStorage.getItem(JOB_STORAGE_KEY));
  const [job, setJob] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [pollCycle, setPollCycle] = useState(0);
  const [networkError, setNetworkError] = useState(false);

  useEffect(() => {
    if (!jobId) return undefined;
    let cancelled = false;
    let timer;
    const poll = async () => {
      try {
        const response = await axios.get(`/api/excel-translations/${jobId}`);
        if (cancelled) return;
        setJob(response.data);
        setNetworkError(false);
        if (shouldPoll(response.data)) timer = window.setTimeout(poll, 10_000);
      } catch (error) {
        if (cancelled) return;
        if (error.response?.status === 404) {
          localStorage.removeItem(JOB_STORAGE_KEY);
          setJobId(null);
          setJob(null);
          setNetworkError(false);
          message.warning('翻译任务已过期，请重新上传文件');
        } else {
          setNetworkError(true);
          timer = window.setTimeout(poll, 10_000);
        }
      }
    };
    poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [jobId, pollCycle]);

  const handleUpload = async file => {
    const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    if (!['.xlsx', '.xlsm'].includes(extension)) {
      message.error('只支持 .xlsx 或 .xlsm 文件');
      return false;
    }

    setUploading(true);
    setNetworkError(false);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await axios.post('/api/excel-translations', formData);
      localStorage.setItem(JOB_STORAGE_KEY, response.data.jobId);
      setJob(response.data);
      setJobId(response.data.jobId);
      setPollCycle(cycle => cycle + 1);
      message.success('文件已上传，正在扫描全部工作表');
    } catch (error) {
      message.error(error.response?.data?.message || '上传失败，请检查文件格式');
    } finally {
      setUploading(false);
    }
    return false;
  };

  const handleStart = async () => {
    if (!jobId) return;
    setStarting(true);
    try {
      const response = await axios.post(`/api/excel-translations/${jobId}/start`);
      setJob(response.data);
      setPollCycle(cycle => cycle + 1);
    } catch (error) {
      message.error(error.response?.data?.message || '无法开始翻译');
    } finally {
      setStarting(false);
    }
  };

  const handleDownload = () => {
    if (!jobId || !job) return;
    downloadBlob(
      `/api/excel-translations/${jobId}/download`,
      job.downloadName || 'Excel_中英翻译.xlsx',
      '下载翻译文件失败',
    );
  };

  const reset = () => {
    localStorage.removeItem(JOB_STORAGE_KEY);
    setJobId(null);
    setJob(null);
    setNetworkError(false);
  };

  const notice = completionNotice(job);
  const active = job && shouldPoll(job);

  return (
    <Space direction="vertical" size={20} style={{ width: '100%' }}>
      <div>
        <Title level={3} style={{ marginBottom: 4 }}>
          <TranslationOutlined /> Excel 中英翻译
        </Title>
        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
          扫描一个工作簿的全部可见、隐藏和非常隐藏 Sheet，在原单元格后追加中英文。
        </Paragraph>
      </div>

      <Alert
        type="info"
        showIcon
        message="翻译与隐私说明"
        description="只有去重后的待翻译文字会发送至外部翻译服务；公式、图片、VBA、文件格式和完整工作簿不会发送。"
      />

      {!jobId && (
        <Card title="第一步：上传并扫描 Excel">
          <Dragger
            accept=".xlsx,.xlsm"
            multiple={false}
            showUploadList={false}
            beforeUpload={handleUpload}
            disabled={uploading}
          >
            <p className="ant-upload-drag-icon">
              {uploading ? <Spin /> : <InboxOutlined />}
            </p>
            <p className="ant-upload-text">点击或将一个 Excel 文件拖到这里</p>
            <p className="ant-upload-hint">支持 .xlsx / .xlsm，上传后先扫描，确认统计后再开始翻译</p>
          </Dragger>
        </Card>
      )}

      {jobId && !job && (
        <Card>
          <Space><Spin /><Text>正在恢复翻译任务…</Text></Space>
        </Card>
      )}

      {job && (
        <Card
          title={
            <Space wrap>
              <span>{job.originalName}</span>
              <Tag color={statusColor(job.status)}>{statusLabel(job)}</Tag>
            </Space>
          }
          extra={<Button icon={<ReloadOutlined />} onClick={reset}>重新上传</Button>}
        >
          <Space direction="vertical" size={20} style={{ width: '100%' }}>
            <Descriptions bordered size="small" column={{ xs: 1, sm: 2, lg: 4 }}>
              <Descriptions.Item label="Sheet 数量">{job.sheetCount ?? '扫描中'}</Descriptions.Item>
              <Descriptions.Item label="公式数量">{job.formulaCount ?? '扫描中'}</Descriptions.Item>
              <Descriptions.Item label="候选单元格">{job.candidateCellCount ?? '扫描中'}</Descriptions.Item>
              <Descriptions.Item label="唯一文本">{job.candidateUniqueCount ?? '扫描中'}</Descriptions.Item>
            </Descriptions>

            {Number(job.formulaCount) > 0 && (
              <Alert
                type="warning"
                showIcon
                message="输出为阅读型副本"
                description="公式表达式会保留，但引用已翻译文字的公式结果可能需要在 Excel 中重新计算。"
              />
            )}

            {job.status === 'ready' && Number(job.candidateUniqueCount) === 0 && (
              <Alert type="info" showIcon message="没有发现需要翻译的文字" />
            )}

            {(active || canDownload(job) || job.status === 'failed') && (
              <div>
                <Space style={{ marginBottom: 8 }} wrap>
                  <Text strong>{statusLabel(job)}</Text>
                  {job.currentSheet && <Text type="secondary">当前 Sheet：{job.currentSheet}</Text>}
                  {networkError && <Text type="warning">网络暂时不可用，稍后自动重试</Text>}
                </Space>
                <Progress
                  percent={progressPercent(job)}
                  status={job.status === 'failed' ? 'exception' : undefined}
                />
              </div>
            )}

            {(job.succeededCells !== null || job.failedCells !== null) && (
              <Row gutter={[12, 12]}>
                <Col xs={24} sm={8}>
                  <Card size="small"><Statistic title="翻译成功" value={job.succeededCells ?? 0} /></Card>
                </Col>
                <Col xs={24} sm={8}>
                  <Card size="small"><Statistic title="已完整/跳过" value={job.skippedCells ?? 0} /></Card>
                </Col>
                <Col xs={24} sm={8}>
                  <Card size="small"><Statistic title="保留原文/失败" value={job.failedCells ?? 0} /></Card>
                </Col>
              </Row>
            )}

            {job.status === 'failed' && (
              <Alert
                type="error"
                showIcon
                message="处理失败"
                description={job.errorMessage || '处理失败，请重新上传或联系管理员'}
              />
            )}

            {notice && (
              <Alert
                type={job.status === 'completed_with_warnings' ? 'warning' : 'success'}
                showIcon
                message={notice}
              />
            )}

            <Space wrap>
              {job.status === 'ready' && (
                <Button
                  type="primary"
                  icon={<PlayCircleOutlined />}
                  loading={starting}
                  disabled={!canStart(job)}
                  onClick={handleStart}
                >
                  开始中英翻译
                </Button>
              )}
              {canDownload(job) && (
                <Button type="primary" icon={<DownloadOutlined />} onClick={handleDownload}>
                  下载 {job.downloadName}
                </Button>
              )}
              <Button icon={<ReloadOutlined />} onClick={reset}>重新上传</Button>
            </Space>
          </Space>
        </Card>
      )}
    </Space>
  );
}
