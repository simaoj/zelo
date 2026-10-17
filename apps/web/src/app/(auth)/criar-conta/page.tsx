import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SignUpPage } from '@/features/auth/SignUpPage';

export const metadata: Metadata = { title: 'Criar conta' };

export default function Page() {
  return (
    <Suspense>
      <SignUpPage />
    </Suspense>
  );
}
