import type { NextConfig } from "next";

// 生产部署在 RR Portal 的 /toyqms/ 子路径下（nginx 剥掉前缀转发给容器）。
// 构建时由 Dockerfile 注入 NEXT_PUBLIC_BASE_PATH=/toyqms，让静态资源 URL 与
// 前端路由都带上前缀——浏览器请求 /toyqms/_next/*，nginx 剥前缀后正好命中
// 容器内 out/_next/*。本地 dev 不设置则仍在根路径，行为不变。
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
const nextConfig: NextConfig = { output: "export", trailingSlash: true, basePath };
export default nextConfig;
