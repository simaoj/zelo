import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ActivitySummaryPage } from '@/features/activity/ActivitySummaryPage';

export const metadata: Metadata = { title: 'Atividade' };

export default function Page() {
  return (
    <Suspense>
      <ActivitySummaryPage />
    </Suspense>
  );
}
