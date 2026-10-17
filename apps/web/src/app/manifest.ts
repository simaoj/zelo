import type { MetadataRoute } from 'next';

// Served at /manifest.webmanifest (owned by the PWA agent). Static: no user data.
export const dynamic = 'force-static';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Zelo',
    short_name: 'Zelo',
    description: 'Acompanhe peso, medidas, pressão e sua rotina de cuidados.',
    lang: 'pt-BR',
    dir: 'ltr',
    start_url: '/hoje',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    theme_color: '#FFFCF8',
    background_color: '#FFFCF8',
    categories: ['health', 'lifestyle'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
