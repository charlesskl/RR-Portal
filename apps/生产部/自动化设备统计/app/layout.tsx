import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '生产自动化设备投资成本结余统计',
  description: '部门生产数据录入、设备投资回收与结余统计系统。',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
