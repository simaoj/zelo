import type { ReactNode } from 'react';
import { AtividadeLayout } from '@/features/activity/AtividadeSection';

export default function Layout({ children }: { children: ReactNode }) {
  return <AtividadeLayout>{children}</AtividadeLayout>;
}
