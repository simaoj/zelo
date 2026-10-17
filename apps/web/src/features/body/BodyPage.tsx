'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { Ruler, Scale } from 'lucide-react';
import { PageHeader } from '@/shared/ui/Card';
import { TabPanel, Tabs } from '@/shared/ui/Tabs';
import { WeightPanel } from './WeightPanel';
import { MeasurementsPanel } from './MeasurementsPanel';

type Tab = 'peso' | 'medidas';

export function BodyPage() {
  const params = useSearchParams();
  const router = useRouter();
  const tab: Tab = params.get('aba') === 'medidas' ? 'medidas' : 'peso';
  const setTab = (t: Tab) => router.replace(t === 'peso' ? '/corpo' : '/corpo?aba=medidas', { scroll: false });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="Acompanhamento físico" title="Ritmo do corpo" />
      <div className="max-w-md">
        <Tabs
          idPrefix="corpo"
          label="Peso ou medidas"
          value={tab}
          onChange={setTab}
          items={[
            { value: 'peso', label: 'Peso', icon: <Scale aria-hidden className="size-4" /> },
            { value: 'medidas', label: 'Medidas', icon: <Ruler aria-hidden className="size-4" /> },
          ]}
        />
      </div>
      <TabPanel idPrefix="corpo" value={tab}>
        {tab === 'peso' ? <WeightPanel /> : <MeasurementsPanel />}
      </TabPanel>
    </div>
  );
}
