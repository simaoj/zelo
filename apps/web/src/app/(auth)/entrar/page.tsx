import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SignInPage } from '@/features/auth/SignInPage';

export const metadata: Metadata = { title: 'Entrar' };

export default function Page() {
  return (
    <Suspense>
      <SignInPage />
    </Suspense>
  );
}
