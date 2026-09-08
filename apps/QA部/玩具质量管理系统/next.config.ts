import type { NextConfig } from "next";

// 生产部署在 RR Portal 的 /toyqms/ 子路径下（nginx 透传完整路径，不再剥前缀）。
// 构建时由 Dockerfile 注入 NEXT_PUBLIC_BASE_PATH=/toyqms，让静态资源 URL 与
// 前端路由都带上前缀；本地 dev 不设置则仍在根路径，行为不变。
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
const nextConfig: NextConfig = { output: "export", trailingSlash: true, basePath };
export default nextConfig;
