import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "包装物料管理系统 | Packaging Cost System",
  description: "9565 松鼠包装物料 MA 扣数及差价计算系统",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
