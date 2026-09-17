import { PHASE_DEVELOPMENT_SERVER } from 'next/constants.js';

/** @type {import('next').NextConfig} */
export default function nextConfig(phase) {
  return {
    // Keep the live preview cache separate from production build output.
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? '.next-dev' : '.next-build',
  };
}
