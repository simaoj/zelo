import type { Metadata } from 'next';
import { Suspense } from 'react';
import { StepsPage } from '@/features/activity/StepsPage';

export const metadata: Metadata = { title: 'Passos' };

export default function Page() {
  return (
    <Suspense>
      <StepsPage />
    </Suspense>
  );
}
