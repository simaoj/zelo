import type { Metadata } from 'next';
import { Suspense } from 'react';
import { WorkoutsPage } from '@/features/activity/WorkoutsPage';

export const metadata: Metadata = { title: 'Exercícios' };

export default function Page() {
  return (
    <Suspense>
      <WorkoutsPage />
    </Suspense>
  );
}
