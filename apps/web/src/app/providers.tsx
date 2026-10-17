'use client';
import type { ReactNode } from 'react';
import { ZeloProvider } from '@/shared/data/ZeloProvider';
import { ToastProvider } from '@/shared/ui/Toast';
import { getComposition } from '@/infrastructure/composition';
import { Splash } from '@/features/shell/Splash';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ZeloProvider create={getComposition} fallback={<Splash />}>
      <ToastProvider>{children}</ToastProvider>
    </ZeloProvider>
  );
}
