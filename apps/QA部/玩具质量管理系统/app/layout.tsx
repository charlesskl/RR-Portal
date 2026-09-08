import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/shell";
import { DataProvider } from "@/components/data-provider";
import { AuthGate, AuthProvider } from "@/components/auth-provider";

export const metadata: Metadata = { title: "ToyQMS", description: "玩具质量管理系统 — 投诉与 CAP 分析" };
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="zh-CN"><body><AuthProvider><AuthGate><DataProvider><AppShell>{children}</AppShell></DataProvider></AuthGate></AuthProvider></body></html>; }
