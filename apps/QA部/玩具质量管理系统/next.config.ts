import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  output:"export",
  trailingSlash:true,
  // Avoid a 308 hop on /api/* (trailingSlash would append "/" before the
  // rewrite runs); the backend is reached directly.
  skipTrailingSlashRedirect:true,
  // Local development only (`next dev`): forward API calls to the backend
  // so the same-origin contract holds there too. Ignored for `output: export`.
  async rewrites(){ return [{ source: "/api/:path*", destination: "http://127.0.0.1:4313/api/:path*" }] },
};
export default nextConfig;
