import type { Metadata } from 'next';
import { Suspense } from 'react';
import { WaterPage } from '@/features/hydration/WaterPage';

export const metadata: Metadata = { title: 'Água' };

export default function Page() {
  return (
    <Suspense>
      <WaterPage />
    </Suspense>
  );
}
