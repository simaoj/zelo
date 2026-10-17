import type { Metadata } from 'next';
import { Suspense } from 'react';
import { BodyPage } from '@/features/body/BodyPage';

export const metadata: Metadata = { title: 'Corpo' };

export default function Page() {
  return (
    <Suspense>
      <BodyPage />
    </Suspense>
  );
}
