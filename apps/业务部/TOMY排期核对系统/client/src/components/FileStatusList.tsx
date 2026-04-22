import { List, Tag, Typography, Space, Descriptions } from 'antd'
import { CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons'

const { Text } = Typography

// Frontend-local type definitions (mirrors server/types/index.ts)
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

function StatusTag({ status }: { status: 'done' | 'error' }) {
  if (status === 'done') {
    return (
      <Tag icon={<CheckCircleOutlined />} color="success">
        成功
      </Tag>
    )
  }
  return (
    <Tag icon={<CloseCircleOutlined />} color="error">
      失败
    </Tag>
  )
}

export default function FileStatusList({ files, schedules }: FileStatusListProps) {
  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      {files.length > 0 && (
        <List
          header={<Text strong>PO 文件解析结果</Text>}
          bordered
          dataSource={files}
          renderItem={(item) => (
            <List.Item>
              <Space direction="vertical" style={{ width: '100%' }}>
                <Space>
                  <StatusTag status={item.status} />
                  <Text strong>{item.filename}</Text>
                </Space>
                {item.status === 'done' && item.data ? (
                  <Descriptions size="small" column={2} style={{ marginLeft: 16 }}>
                    <Descriptions.Item label="TOMY PO">{item.data.tomyPO}</Descriptions.Item>
                    <Descriptions.Item label="客户 PO">{item.data.customerPO}</Descriptions.Item>
                    <Descriptions.Item label="跟单员">{item.data.handleBy}</Descriptions.Item>
                    <Descriptions.Item label="目的国">{item.data.destCountry}</Descriptions.Item>
                    <Descriptions.Item label="品项数">
                      {item.data.items.length} 项
                    </Descriptions.Item>
                    <Descriptions.Item label="工厂代码">
                      {[...new Set(item.data.items.map((i) => i.factoryCode))].join(', ')}
                    </Descriptions.Item>
                  </Descriptions>
                ) : (
                  <Text type="danger" style={{ marginLeft: 16 }}>
                    {item.error ?? '解析失败'}
                  </Text>
                )}
              </Space>
            </List.Item>
          )}
        />
      )}

      {schedules.length > 0 && (
        <List
          header={<Text strong>排期表解析结果</Text>}
          bordered
          dataSource={schedules}
          renderItem={(item) => (
            <List.Item>
              <Space direction="vertical" style={{ width: '100%' }}>
                <Space>
                  <StatusTag status={item.status} />
                  <Text strong>{item.filename}</Text>
                </Space>
                {item.status === 'done' ? (
                  <Text style={{ marginLeft: 16 }}>
                    共解析 <Text strong>{item.rowCount}</Text> 行数据
                  </Text>
                ) : (
                  <Text type="danger" style={{ marginLeft: 16 }}>
                    {item.error ?? '解析失败'}
                  </Text>
                )}
              </Space>
            </List.Item>
          )}
        />
      )}
    </Space>
  )
}
