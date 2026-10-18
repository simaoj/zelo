import type { Metadata } from 'next';
import { Suspense } from 'react';
import { WorkoutDetailsPage } from '@/features/activity/WorkoutDetailsPage';

export const metadata: Metadata = { title: 'Exercício' };

/** Static route (?id=) so the service worker can precache it and details open offline. */
export default function Page() {
  return (
    <Suspense>
      <WorkoutDetailsPage />
    </Suspense>
  );
}
