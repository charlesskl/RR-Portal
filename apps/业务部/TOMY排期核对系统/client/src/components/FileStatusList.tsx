import { List, Typography, Space, Descriptions } from 'antd'

const { Text } = Typography

// ─── Types (mirrors server/types/index.ts) ────────────────────────────────

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

interface FileStatusListProps {
  files: FileResult[]
  schedules: ScheduleResult[]
}

function StatusChip({ status }: { status: 'done' | 'error' }) {
  if (status === 'done') return <span className="status-chip ok">成功</span>
  return <span className="status-chip err">失败</span>
}

function SectionList<T extends { filename: string; status: 'done' | 'error' }>({
  header,
  dataSource,
  renderBody,
}: {
  header: string
  dataSource: T[]
  renderBody: (item: T) => React.ReactNode
}) {
  if (dataSource.length === 0) return null
  return (
    <div>
      <div className="section-label" style={{ marginBottom: 8 }}>
        {header}
      </div>
      <List
        size="small"
        bordered
        dataSource={dataSource}
        renderItem={(item) => (
          <List.Item style={{ display: 'block' }}>
            <Space direction="vertical" size={6} style={{ width: '100%' }}>
              <Space size="small" wrap>
                <StatusChip status={item.status} />
                <Text strong className="num" style={{ fontSize: 13 }}>
                  {item.filename}
                </Text>
              </Space>
              {renderBody(item)}
            </Space>
          </List.Item>
        )}
      />
    </div>
  )
}

export default function FileStatusList({ files, schedules }: FileStatusListProps) {
  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <SectionList
        header="PO 文件解析详情"
        dataSource={files}
        renderBody={(item) => {
          if (item.status === 'done' && item.data) {
            const factoryCodes = [...new Set(item.data.items.map((i) => i.factoryCode))]
            return (
              <Descriptions size="small" column={2} style={{ marginLeft: 8 }} colon={false}>
                <Descriptions.Item label="TOMY PO">
                  <span className="num">{item.data.tomyPO}</span>
                </Descriptions.Item>
                <Descriptions.Item label="客户 PO">
                  <span className="num">{item.data.customerPO}</span>
                </Descriptions.Item>
                <Descriptions.Item label="跟单员">{item.data.handleBy}</Descriptions.Item>
                <Descriptions.Item label="目的国">{item.data.destCountry}</Descriptions.Item>
                <Descriptions.Item label="品项数">
                  <span className="num">{item.data.items.length}</span> 项
                </Descriptions.Item>
                <Descriptions.Item label="工厂代码">
                  <span className="num">{factoryCodes.join(', ')}</span>
                </Descriptions.Item>
              </Descriptions>
            )
          }
          return (
            <Text type="danger" style={{ marginLeft: 8, fontSize: 12 }}>
              {item.error ?? '解析失败'}
            </Text>
          )
        }}
      />

      <SectionList
        header="排期表解析详情"
        dataSource={schedules}
        renderBody={(item) => {
          if (item.status === 'done') {
            return (
              <Text style={{ marginLeft: 8, fontSize: 13 }}>
                共解析{' '}
                <span className="num stat-num" style={{ fontSize: 15 }}>
                  {item.rowCount}
                </span>{' '}
                行数据
              </Text>
            )
          }
          return (
            <Text type="danger" style={{ marginLeft: 8, fontSize: 12 }}>
              {item.error ?? '解析失败'}
            </Text>
          )
        }}
      />
    </Space>
  )
}
