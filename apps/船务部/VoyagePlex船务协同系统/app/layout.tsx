import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VoyagePlex 船务协同系统",
  description: "船务信息汇总、走柜资料生成与出货记录",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
