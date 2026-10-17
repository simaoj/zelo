import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ResetPasswordPage } from '@/features/auth/ResetPasswordPage';

export const metadata: Metadata = { title: 'Redefinir senha' };

export default function Page() {
  return (
    <Suspense>
      <ResetPasswordPage />
    </Suspense>
  );
}
