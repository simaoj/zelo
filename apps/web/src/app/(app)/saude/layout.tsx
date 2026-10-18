import type { ReactNode } from 'react';
import { SaudeLayout } from '@/features/health/SaudeSection';

export default function Layout({ children }: { children: ReactNode }) {
  return <SaudeLayout>{children}</SaudeLayout>;
}
