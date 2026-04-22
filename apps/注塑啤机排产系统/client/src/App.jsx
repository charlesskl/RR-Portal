import { useState } from 'react';
import { Layout, Menu, Typography, Button, Tag } from 'antd';
import {
  UnorderedListOutlined,
  ToolOutlined,
  RobotOutlined,
  FileTextOutlined,
  DatabaseOutlined,
  DesktopOutlined,
  ImportOutlined,
  AimOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import OrderImport from './pages/OrderImport';
import HistoryData from './pages/HistoryData';
import MachineProfile from './pages/MachineProfile';
import MoldTargets from './pages/MoldTargets';
import Scheduling from './pages/Scheduling';
import ScheduleResult from './pages/ScheduleResult';
import WorkshopPortal from './pages/WorkshopPortal';

const { Sider, Content, Header } = Layout;
const { Text } = Typography;

const WORKSHOP_COLORS = { A: '#1565c0', B: '#e65100', C: '#2e7d32' };
const WORKSHOP_LABELS = { A: 'A车间', B: 'B车间', C: '华登' };

const menuItems = [
  { key: 'orderImport',    icon: <ImportOutlined />,        label: '订单导入' },
  { key: 'scheduling',     icon: <RobotOutlined />,         label: '智能排机' },
  { key: 'scheduleResult', icon: <FileTextOutlined />,      label: '排机结果' },
  { key: 'historyData',    icon: <DatabaseOutlined />,      label: '历史数据库' },
  { key: 'machineProfile', icon: <DesktopOutlined />,       label: '机台档案' },
  { key: 'moldTargets',    icon: <AimOutlined />,           label: '模具目标' },
];

const titles = {
  orderImport:    '订单导入',
  historyData:    '历史数据库',
  machineProfile: '机台档案',
  moldTargets:    '模具目标',
  scheduling:     '智能排机',
  scheduleResult: '排机结果',
};

export default function App() {
  const [workshop, setWorkshop] = useState(() => localStorage.getItem('workshop') || null);
  const [page, setPage] = useState('orderImport');

  const handleEnter = (ws) => {
    localStorage.setItem('workshop', ws);
    setWorkshop(ws);
    setPage('orderImport');
  };

  const handleSwitch = () => {
    localStorage.removeItem('workshop');
    setWorkshop(null);
    setPage('orderImport');
  };

  // 未选车间 → 显示门户页
  if (!workshop) {
    return <WorkshopPortal onEnter={handleEnter} />;
  }

  const wsColor = WORKSHOP_COLORS[workshop] || '#1565c0';

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider theme="dark" width={200}>
        <div style={{
          height: 64,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
          padding: '0 12px',
          flexDirection: 'column', gap: 4,
        }}>
          <Text style={{ color: '#fff', fontSize: 13, fontWeight: 'bold', textAlign: 'center', lineHeight: 1.4 }}>
            AI注塑啤机<br/>排产系统
          </Text>
          <Tag color={wsColor} style={{ margin: 0, fontSize: 11 }}>{WORKSHOP_LABELS[workshop] || workshop}</Tag>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[page]}
          items={menuItems}
          onClick={({ key }) => setPage(key)}
          style={{ marginTop: 8 }}
        />
      </Sider>
      <Layout>
        <Header style={{
          background: '#fff', padding: '0 24px',
          boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <Text style={{ fontSize: 16, fontWeight: 600, color: '#333' }}>
            {titles[page]}
          </Text>
          <Button
            icon={<SwapOutlined />}
            size="small"
            onClick={handleSwitch}
            style={{ color: wsColor, borderColor: wsColor }}
          >
            切换车间（当前：{WORKSHOP_LABELS[workshop] || workshop}）
          </Button>
        </Header>
        <Content style={{ margin: 24, padding: 24, background: '#fff', borderRadius: 8 }}>
          {page === 'orderImport'    && <OrderImport workshop={workshop} />}
          {page === 'historyData'    && <HistoryData workshop={workshop} />}
          {page === 'machineProfile' && <MachineProfile workshop={workshop} />}
          {page === 'moldTargets'    && <MoldTargets workshop={workshop} />}
          {page === 'scheduling'     && <Scheduling workshop={workshop} onDone={() => setPage('scheduleResult')} />}
          {page === 'scheduleResult' && <ScheduleResult workshop={workshop} />}
        </Content>
      </Layout>
    </Layout>
  );
}
