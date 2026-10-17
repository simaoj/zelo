import type { Metadata } from 'next';
import { Suspense } from 'react';
import { TodayPage } from '@/features/today/TodayPage';

export const metadata: Metadata = { title: 'Hoje' };

export default function Page() {
  return (
    <Suspense>
      <TodayPage />
    </Suspense>
  );
}
