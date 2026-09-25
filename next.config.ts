import type { NextConfig } from 'next';
import { BASE_PATH } from './src/lib/base-path';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  basePath: BASE_PATH,
  experimental: {
    // Server Actions arrive through the Studio proxy with Studio's origin.
    serverActions: { allowedOrigins: ['hyphy-studio.com', 'www.hyphy-studio.com'] },
  },
  async redirects() {
    // The deployment's own root opens the product.
    return [{ source: '/', destination: BASE_PATH, basePath: false, permanent: false }];
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Receipt capture may use the camera later; nothing else needs device access.
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
