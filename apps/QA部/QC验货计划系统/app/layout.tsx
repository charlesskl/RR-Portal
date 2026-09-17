import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'QC验货管理系统',
  description: '业务排期导入、验货计划、验货结果与系统设置一体化管理。',
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
