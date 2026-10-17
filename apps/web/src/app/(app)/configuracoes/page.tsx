import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SettingsPage } from '@/features/settings/SettingsPage';

export const metadata: Metadata = { title: 'Configurações' };

export default function Page() {
  return (
    <Suspense>
      <SettingsPage />
    </Suspense>
  );
}
