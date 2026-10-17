import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RecoverPage } from '@/features/auth/RecoverPage';

export const metadata: Metadata = { title: 'Recuperar acesso' };

export default function Page() {
  return (
    <Suspense>
      <RecoverPage />
    </Suspense>
  );
}
