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
    // The deployment's own root opens the public Tools marketplace.
    return [{ source: '/', destination: `${BASE_PATH}/tools`, basePath: false, permanent: false }];
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Receipts may use the camera and Mileage the location, both on this site only.
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(self)' },
        ],
      },
    ];
  },
};

export default nextConfig;
