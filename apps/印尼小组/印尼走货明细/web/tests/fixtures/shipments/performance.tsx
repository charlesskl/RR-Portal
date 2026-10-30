import '@ant-design/v5-patch-for-react-19'
import { createRoot } from 'react-dom/client'
import { App, ConfigProvider } from 'antd'
import ShipmentsPage from '../../../src/pages/ShipmentsPage'

// No auth guard, business server or stored credentials: the fixture server
// supplies synthetic GET responses and refuses every write request.
createRoot(document.getElementById('root')!).render(<ConfigProvider><App>
  <div style={{ background: '#fff1b8', padding: 8 }}>隔离性能回归 · 仅合成测试数据 · 禁止保存至服务器</div>
  <ShipmentsPage />
</App></ConfigProvider>)
