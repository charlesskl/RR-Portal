/** @type {import('next').NextConfig} */

// .NET 后端地址（开发默认 5080；部署时用环境变量 DOTNET_API_URL 覆盖）
const DOTNET_API_URL = process.env.DOTNET_API_URL || "http://localhost:5080";
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

const nextConfig = {
  basePath: BASE_PATH,
  async rewrites() {
    // 全量迁移：除登出(/api/auth/logout 清 cookie)和健康检查(/api/health)仍由 Next 处理外，
    // 所有 /api/* 请求都透明代理到 .NET 后端。前端客户端组件无需改动。
    // ⚠️ 需保证 .NET 后端在 DOTNET_API_URL 上运行，否则这些请求会代理失败。
    return {
      beforeFiles: [
        // 登录 / 鉴权
        { source: "/api/auth/login", destination: `${DOTNET_API_URL}/api/auth/login` },

        // 基础数据（拉别 / 机台 / 节假日 / 工序对照表）
        { source: "/api/lines", destination: `${DOTNET_API_URL}/api/lines` },
        { source: "/api/lines/:id", destination: `${DOTNET_API_URL}/api/lines/:id` },
        { source: "/api/machines", destination: `${DOTNET_API_URL}/api/machines` },
        { source: "/api/machines/:id", destination: `${DOTNET_API_URL}/api/machines/:id` },
        { source: "/api/holidays", destination: `${DOTNET_API_URL}/api/holidays` },
        { source: "/api/holidays/:id", destination: `${DOTNET_API_URL}/api/holidays/:id` },
        { source: "/api/craft-aliases", destination: `${DOTNET_API_URL}/api/craft-aliases` },
        { source: "/api/craft-aliases/:id", destination: `${DOTNET_API_URL}/api/craft-aliases/:id` },

        // 用户管理
        { source: "/api/users", destination: `${DOTNET_API_URL}/api/users` },
        { source: "/api/users/:id", destination: `${DOTNET_API_URL}/api/users/:id` },

        // 产品信息库（三层下钻）
        // ⚠️ 导入路由（三段路径）必须显式列出，否则不会被两段的 /api/products/:id 规则代理 → Next 返回 404
        { source: "/api/products/import/preview", destination: `${DOTNET_API_URL}/api/products/import/preview` },
        { source: "/api/products/import/commit", destination: `${DOTNET_API_URL}/api/products/import/commit` },
        { source: "/api/products", destination: `${DOTNET_API_URL}/api/products` },
        { source: "/api/products/:id", destination: `${DOTNET_API_URL}/api/products/:id` },
        { source: "/api/products/:id/items", destination: `${DOTNET_API_URL}/api/products/:id/items` },
        { source: "/api/products/:id/items/:itemId", destination: `${DOTNET_API_URL}/api/products/:id/items/:itemId` },
        { source: "/api/products/:id/parts", destination: `${DOTNET_API_URL}/api/products/:id/parts` },
        { source: "/api/products/:id/parts/:partId", destination: `${DOTNET_API_URL}/api/products/:id/parts/:partId` },

        // 订单
        { source: "/api/orders", destination: `${DOTNET_API_URL}/api/orders` },
        { source: "/api/orders/:id", destination: `${DOTNET_API_URL}/api/orders/:id` },

        // 排期计划 production_plans（排期录入 + 实绩录入共用）
        { source: "/api/plans", destination: `${DOTNET_API_URL}/api/plans` },
        { source: "/api/plans/:id", destination: `${DOTNET_API_URL}/api/plans/:id` },

        // 月排自动排期（生成草稿预览 + 提交保存）
        { source: "/api/schedule/auto", destination: `${DOTNET_API_URL}/api/schedule/auto` },
        { source: "/api/schedule/auto/commit", destination: `${DOTNET_API_URL}/api/schedule/auto/commit` },

        // 按订单撤销排期（删全部计划行 + 订单退回已接单）—— 四段路径必须显式列出，否则 Next 返 404
        { source: "/api/schedule/orders/:orderId/unschedule", destination: `${DOTNET_API_URL}/api/schedule/orders/:orderId/unschedule` },

        // 急单（待排列表 / 产能检测预览 / 落库提交）—— 三段路径必须显式列出，否则 Next 返 404
        { source: "/api/schedule/urgent/orders", destination: `${DOTNET_API_URL}/api/schedule/urgent/orders` },
        { source: "/api/schedule/urgent/preview", destination: `${DOTNET_API_URL}/api/schedule/urgent/preview` },
        { source: "/api/schedule/urgent/commit", destination: `${DOTNET_API_URL}/api/schedule/urgent/commit` },

        // 实绩导出（每日生产明细表 xlsx 下载）
        { source: "/api/recording/export", destination: `${DOTNET_API_URL}/api/recording/export` },
      ],
    };
  },
};

export default nextConfig;
