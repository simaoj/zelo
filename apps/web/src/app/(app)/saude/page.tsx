import type { Metadata } from 'next';
import { SaudeIndex } from '@/features/health/SaudeSection';

export const metadata: Metadata = { title: 'Saúde' };

export default function Page() {
  return <SaudeIndex />;
}
