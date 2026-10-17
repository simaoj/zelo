import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RoutinePage } from '@/features/routine/RoutinePage';

export const metadata: Metadata = { title: 'Rotina' };

export default function Page() {
  return (
    <Suspense>
      <RoutinePage />
    </Suspense>
  );
}
