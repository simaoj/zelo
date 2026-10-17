import type { ReactNode } from 'react';
import { AuthenticatedApp } from '@/features/shell/AuthenticatedApp';

export default function AppLayout({ children }: { children: ReactNode }) {
  return <AuthenticatedApp>{children}</AuthenticatedApp>;
}
