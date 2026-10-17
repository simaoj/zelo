import type { Metadata, Viewport } from 'next';
import { Newsreader, Plus_Jakarta_Sans } from 'next/font/google';
import type { ReactNode } from 'react';
import { pwaMetadata, pwaViewport } from '@/pwa/metadata';
import { Providers } from './providers';
import './globals.css';

const newsreader = Newsreader({ subsets: ['latin'], variable: '--font-newsreader', display: 'swap', weight: ['500', '600'] });
const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-jakarta', display: 'swap' });

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
