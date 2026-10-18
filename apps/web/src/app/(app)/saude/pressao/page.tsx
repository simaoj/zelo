import type { Metadata } from 'next';
import { Suspense } from 'react';
import { BloodPressurePage } from '@/features/blood-pressure/BloodPressurePage';

export const metadata: Metadata = { title: 'Pressão' };

export default function Page() {
  return (
    <Suspense>
      <BloodPressurePage />
    </Suspense>
  );
}
