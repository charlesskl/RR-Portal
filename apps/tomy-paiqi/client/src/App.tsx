import { useState } from 'react'
import { Button, Upload, message, Card, Typography, Space, Alert, Table, Tag } from 'antd'
import { UploadOutlined, FileExcelOutlined, FilePdfOutlined, DownloadOutlined } from '@ant-design/icons'
import type { UploadFile } from 'antd'
import FileStatusList from './components/FileStatusList'

const { Title, Text } = Typography

// Frontend-local type definitions (project convention: no shared package)

interface POItem {
  货号: string
  PO走货期: string
  数量: number
  factoryCode: string
  外箱: number | null
}

interface POData {
  tomyPO: string
  customerPO: string
  handleBy: string
  customerName: string
  destCountry: string
  items: POItem[]
  sourceFile: string
}

interface FileResult {
  filename: string
  status: 'done' | 'error'
  data: POData | null
  error?: string
}

interface ScheduleResult {
  filename: string
  status: 'done' | 'error'
  rowCount: number
  error?: string
}

interface MatchDetail {
  tomyPO: string
  货号: string
  sourceFile: string
  mismatches: Array<{ field: string; scheduleValue: unknown; poValue: unknown }>
}

interface UnmatchedDetail {
  tomyPO: string
  货号: string
  sourceFile: string
}

interface ReconciliationSummary {
  matchedCount: number
  unmatchedCount: number
  ambiguousCount: number
  mismatchedFieldCount: number
  errors: string[]
  details: {
    matched: MatchDetail[]
    unmatched: UnmatchedDetail[]
  }
}

interface ProcessResponse {
  files: FileResult[]
  scheduleDg: ScheduleResult | null
  scheduleId: ScheduleResult | null
  reconciliationDg?: ReconciliationSummary
  reconciliationId?: ReconciliationSummary
  outputReady?: boolean
  sessionId?: string
}

function ReconciliationCard({
  title,
  reconciliation,
}: {
  title: string
  reconciliation: ReconciliationSummary
}) {
  const { details } = reconciliation

  // Build table data: matched items (with/without mismatches) + unmatched items
  const tableData = [
    ...details.matched.map((m, i) => ({
      key: `m-${i}`,
      tomyPO: m.tomyPO,
      货号: m.货号,
      sourceFile: m.sourceFile,
      status: m.mismatches.length > 0 ? 'mismatch' as const : 'ok' as const,
      mismatches: m.mismatches,
    })),
    ...details.unmatched.map((u, i) => ({
      key: `u-${i}`,
      tomyPO: u.tomyPO,
      货号: u.货号,
      sourceFile: u.sourceFile,
      status: 'unmatched' as const,
      mismatches: [] as MatchDetail['mismatches'],
    })),
  ]

  const columns = [
    { title: 'TOMY PO', dataIndex: 'tomyPO', key: 'tomyPO', width: 120 },
    { title: '货号', dataIndex: '货号', key: '货号', width: 100 },
    {
      title: '状态',
      key: 'status',
      width: 100,
      render: (_: unknown, record: (typeof tableData)[0]) => {
        if (record.status === 'ok') return <Tag color="green">匹配</Tag>
        if (record.status === 'mismatch') return <Tag color="orange">有差异</Tag>
        return <Tag color="red">未找到</Tag>
      },
    },
    {
      title: '差异详情',
      key: 'mismatches',
      render: (_: unknown, record: (typeof tableData)[0]) => {
        if (record.mismatches.length === 0) return record.status === 'unmatched' ? '排期表中无对应行' : '—'
        return (
          <Space direction="vertical" size={0}>
            {record.mismatches.map((mm, i) => (
              <Text key={i} style={{ fontSize: 12 }}>
                <Text strong>{mm.field}</Text>: 排期=<Text code>{String(mm.scheduleValue ?? '空')}</Text> PO=<Text code>{String(mm.poValue ?? '空')}</Text>
              </Text>
            ))}
          </Space>
        )
      },
    },
  ]

  return (
    <Card size="small" title={title}>
      <Space direction="vertical" size="small" style={{ width: '100%' }}>
        <Text>
          核对完成:{' '}
          <Text strong style={{ color: '#52c41a' }}>{reconciliation.matchedCount}</Text> 项匹配，{' '}
          <Text strong style={{ color: reconciliation.mismatchedFieldCount > 0 ? '#fa8c16' : undefined }}>
            {reconciliation.mismatchedFieldCount}
          </Text> 个字段不匹配，{' '}
          <Text strong style={{ color: reconciliation.unmatchedCount > 0 ? '#ff4d4f' : undefined }}>
            {reconciliation.unmatchedCount}
          </Text> 项未找到
        </Text>
        {reconciliation.errors.map((e, i) => (
          <Text key={i} type="danger">{e}</Text>
        ))}
        {tableData.length > 0 && (
          <Table
            dataSource={tableData}
            columns={columns}
            size="small"
            pagination={false}
            scroll={{ x: 600 }}
          />
        )}
      </Space>
    </Card>
  )
}

function App() {
  const [poFiles, setPoFiles] = useState<UploadFile[]>([])
  const [scheduleDgFile, setScheduleDgFile] = useState<UploadFile[]>([])
  const [scheduleIdFile, setScheduleIdFile] = useState<UploadFile[]>([])
  const [loading, setLoading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [result, setResult] = useState<ProcessResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async () => {
    if (poFiles.length === 0) {
      message.warning('请选择PO PDF文件')
      return
    }
    if (scheduleDgFile.length === 0 && scheduleIdFile.length === 0) {
      message.warning('请至少选择一个排期表文件')
      return
    }

    setLoading(true)
    setResult(null)
    setError(null)

    const formData = new FormData()
    const poNames: string[] = []
    poFiles.forEach((file) => {
      if (file.originFileObj) {
        formData.append('pos', file.originFileObj)
        poNames.push(file.originFileObj.name)
      }
    })
    formData.append('poNames', JSON.stringify(poNames))

    if (scheduleDgFile[0]?.originFileObj) {
      formData.append('scheduleDg', scheduleDgFile[0].originFileObj)
      formData.append('scheduleDgName', scheduleDgFile[0].originFileObj.name)
    }
    if (scheduleIdFile[0]?.originFileObj) {
      formData.append('scheduleId', scheduleIdFile[0].originFileObj)
      formData.append('scheduleIdName', scheduleIdFile[0].originFileObj.name)
    }

    try {
      const response = await fetch('/api/process', {
        method: 'POST',
        body: formData,
      })
      if (!response.ok) {
        throw new Error(`服务器返回错误: ${response.status} ${response.statusText}`)
      }
      const data = (await response.json()) as ProcessResponse
      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  const handleDownload = async () => {
    if (!result?.sessionId) return
    setDownloading(true)
    try {
      const response = await fetch(`/api/download/${result.sessionId}`)
      if (!response.ok) {
        throw new Error(`下载失败: ${response.status} ${response.statusText}`)
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'TOMY_核对结果.zip'
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      message.error(err instanceof Error ? err.message : '下载失败')
    } finally {
      setDownloading(false)
    }
  }

  // Compute summary stats
  const successCount = result?.files.filter((f) => f.status === 'done').length ?? 0
  const errorCount = result?.files.filter((f) => f.status === 'error').length ?? 0
  const totalCount = result?.files.length ?? 0

  // Group POs by factory code
  const dgPOs = result?.files.filter((f) => f.data?.items[0]?.factoryCode === 'RR01') ?? []
  const idPOs = result?.files.filter((f) => f.data?.items[0]?.factoryCode === 'RR02') ?? []
  const unknownPOs = result?.files.filter((f) => {
    if (f.status === 'error') return true
    const fc = f.data?.items[0]?.factoryCode
    return fc !== 'RR01' && fc !== 'RR02'
  }) ?? []

  // Build schedules array for FileStatusList
  const schedules: Array<{ filename: string; status: 'done' | 'error'; rowCount: number; error?: string }> = []
  if (result?.scheduleDg) schedules.push(result.scheduleDg)
  if (result?.scheduleId) schedules.push(result.scheduleId)

  return (
    <div style={{ maxWidth: 800, margin: '40px auto', padding: '0 20px' }}>
      <Title level={2} style={{ textAlign: 'center' }}>
        TOMY 排期核对系统
      </Title>

      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <Card title="PO 文件 (PDF)" size="small">
          <Upload
            multiple
            accept=".pdf"
            beforeUpload={() => false}
            fileList={poFiles}
            onChange={({ fileList }) => setPoFiles(fileList)}
          >
            <Button icon={<FilePdfOutlined />}>选择 PO 文件</Button>
          </Upload>
        </Card>

        <Card title="东莞排期表 (Excel)" size="small">
          <Upload
            accept=".xlsx,.xls"
            maxCount={1}
            beforeUpload={() => false}
            fileList={scheduleDgFile}
            onChange={({ fileList }) => setScheduleDgFile(fileList)}
          >
            <Button icon={<FileExcelOutlined />}>选择东莞排期表</Button>
          </Upload>
        </Card>

        <Card title="印尼排期表 (Excel)" size="small">
          <Upload
            accept=".xlsx,.xls"
            maxCount={1}
            beforeUpload={() => false}
            fileList={scheduleIdFile}
            onChange={({ fileList }) => setScheduleIdFile(fileList)}
          >
            <Button icon={<FileExcelOutlined />}>选择印尼排期表</Button>
          </Upload>
        </Card>

        <Button
          type="primary"
          icon={<UploadOutlined />}
          onClick={handleSubmit}
          loading={loading}
          size="large"
          block
        >
          上传并核对
        </Button>

        {result && (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Card size="small" title={`PO 文件分类 (共 ${totalCount} 个，成功 ${successCount} 个，失败 ${errorCount} 个)`}>
              <Space direction="vertical" size="small" style={{ width: '100%' }}>
                {dgPOs.length > 0 && (
                  <div>
                    <Text strong style={{ color: '#1677ff' }}>东莞 RR01 ({dgPOs.length} 个)：</Text>
                    <Text>{dgPOs.map(f => f.filename).join('、')}</Text>
                  </div>
                )}
                {idPOs.length > 0 && (
                  <div>
                    <Text strong style={{ color: '#722ed1' }}>印尼 RR02 ({idPOs.length} 个)：</Text>
                    <Text>{idPOs.map(f => f.filename).join('、')}</Text>
                  </div>
                )}
                {unknownPOs.length > 0 && (
                  <div>
                    <Text strong type="warning">未分类 ({unknownPOs.length} 个)：</Text>
                    <Text>{unknownPOs.map(f => f.filename).join('、')}</Text>
                  </div>
                )}
              </Space>
            </Card>

            {result.reconciliationDg && (
              <ReconciliationCard
                title="东莞 (RR01) 核对结果"
                reconciliation={result.reconciliationDg}
              />
            )}

            {result.reconciliationId && (
              <ReconciliationCard
                title="印尼 (RR02) 核对结果"
                reconciliation={result.reconciliationId}
              />
            )}

            {result.outputReady && (
              <Button
                type="default"
                icon={<DownloadOutlined />}
                onClick={handleDownload}
                loading={downloading}
                size="large"
                block
              >
                下载核对结果
              </Button>
            )}

            <FileStatusList files={result.files} schedules={schedules} />
          </Space>
        )}

        {error && <Alert message="错误" description={error} type="error" />}
      </Space>
    </div>
  )
}

export default App
