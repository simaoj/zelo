import type { Metadata, Viewport } from 'next';

export const PWA_THEME_COLOR = '#FFFCF8';
export const PWA_BACKGROUND_COLOR = '#FFFCF8';

/** Spread into the root layout `metadata` export. */
export const pwaMetadata: Metadata = {
  applicationName: 'Zelo',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Zelo', statusBarStyle: 'default' },
  formatDetection: { telephone: false },
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
};

/** Spread into the root layout `viewport` export. */
export const pwaViewport: Viewport = {
  themeColor: PWA_THEME_COLOR,
  viewportFit: 'cover',
  width: 'device-width',
  initialScale: 1,
};
