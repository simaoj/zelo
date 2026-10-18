import type { Metadata } from 'next';
import { WorkoutDetailsPage } from '@/features/activity/WorkoutDetailsPage';

export const metadata: Metadata = { title: 'Exercício' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <WorkoutDetailsPage id={id} />;
}
