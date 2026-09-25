import type { MetadataRoute } from 'next';
import { BASE_PATH } from '@/lib/base-path';

/** Installable later without rework: a standalone app that opens on the last Space. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Hyphy Tools',
    short_name: 'Hyphy',
    description: 'A universal toolbox for people and the businesses they work in.',
    start_url: `${BASE_PATH}/`,
    display: 'standalone',
    background_color: '#f3f1eb',
    theme_color: '#f3f1eb',
    icons: [
      { src: `${BASE_PATH}/icon.svg`, sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: `${BASE_PATH}/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      {
        src: `${BASE_PATH}/icon-512.png`,
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
