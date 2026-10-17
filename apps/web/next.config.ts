import type { NextConfig } from 'next';

// Server-side rewrite: browser calls same-origin /api/*, Next forwards to the independent API.
// No business logic here (spec §2).
// PWA: the service worker is bundled separately after `next build` by `serwist build`
// (scripts/serwist.config.mjs), so Turbopack stays the default bundler.
const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  transpilePackages: ['@zelo/contracts'],
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_INTERNAL_URL}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
        ],
      },
      {
        // Service worker (bundled by `serwist build` after `next build`): always revalidate so
        // new versions are detected; scope is the whole origin.
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
        ],
      },
      {
        source: '/manifest.webmanifest',
        headers: [{ key: 'Cache-Control', value: 'no-cache' }],
      },
    ];
  },
};

export default nextConfig;
