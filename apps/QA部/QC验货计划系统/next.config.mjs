import { PHASE_DEVELOPMENT_SERVER } from 'next/constants.js';

/** @type {import('next').NextConfig} */
export default function nextConfig(phase) {
  return {
    // 云端部署挂在主 nginx 的 /qc-plan 子路径下（与 voyageplex 同一模式）；
    // 本地开发/独立 docker-compose 部署不设置该变量，仍运行在根路径。
    basePath: process.env.NEXT_PUBLIC_BASE_PATH || '',
    // Keep the live preview cache separate from production build output.
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? '.next-dev' : '.next-build',
  };
}
