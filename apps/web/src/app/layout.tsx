import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';
import { pwaMetadata, pwaViewport } from '@/pwa/metadata';
import { Providers } from './providers';
import './globals.css';

const newsreader = localFont({ src: './fonts/newsreader.ttf', variable: '--font-newsreader', display: 'swap', weight: '200 800' });
const jakarta = localFont({ src: './fonts/plus-jakarta-sans.ttf', variable: '--font-jakarta', display: 'swap', weight: '200 800' });

export const metadata: Metadata = {
  ...pwaMetadata,
  title: { default: 'Zelo — Seu cuidado, dia a dia', template: '%s • Zelo' },
  description: 'Acompanhe peso, medidas, pressão arterial, medicamentos e vitaminas.',
};

export const viewport: Viewport = {
  ...pwaViewport,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className={`${newsreader.variable} ${jakarta.variable}`}>
      <body className="min-h-dvh antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
