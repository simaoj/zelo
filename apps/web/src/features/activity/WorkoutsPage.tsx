'use client';
import { useState } from 'react';
import type { Workout } from '@zelo/contracts';
import { usePagedHistory } from '@/shared/data/usePagedHistory';
import { useResource } from '@/shared/data/hooks';
import { useTimeZone } from '@/shared/data/session';
import { addDays, formatLongDate, localDateOf, todayIn } from '@/shared/lib/time';
import { formatDuration, modalityLabel } from '@/shared/lib/format';
import { Button } from '@/shared/ui/Button';
import { PageHeader } from '@/shared/ui/Card';
import { SelectField } from '@/shared/ui/Field';
import { ErrorState, SkeletonCard } from '@/shared/ui/States';
import { ChipGroup } from '@/shared/ui/Tabs';
import { ActivityEmpty, CachedDataNote } from './ActivityBits';
import { WorkoutCard } from './WorkoutCard';

type PeriodFilter = '7' | '30' | '90' | 'all';
const PERIOD_OPTIONS: { value: PeriodFilter; label: string }[] = [
  { value: '7', label: '7 dias' },
  { value: '30', label: '30 dias' },
  { value: '90', label: '90 dias' },
  { value: 'all', label: 'Tudo' },
];

/** Groups workouts (already ordered by start desc) by their local date in the profile tz. */
export function groupByDate(items: Workout[], tz: string): { date: string; items: Workout[] }[] {
  const groups: { date: string; items: Workout[] }[] = [];
  for (const w of items) {
    const date = localDateOf(w.startedAt, tz);
    const last = groups[groups.length - 1];
    if (last && last.date === date) last.items.push(w);
    else groups.push({ date, items: [w] });
  }
  return groups;
}

export function WorkoutsPage() {
  const tz = useTimeZone();
  const today = todayIn(tz);
  const [period, setPeriod] = useState<PeriodFilter>('30');
  const [name, setName] = useState('');
  const [names, setNames] = useState<string[]>([]);
  const from = period === 'all' ? undefined : addDays(today, -(Number(period) - 1));
  const list = usePagedHistory(`workouts:${period}:${name}:${today}`, async (ds, q) => {
    const page = await ds.listWorkouts({ ...(from ? { from, to: today } : {}), ...(name ? { name } : {}), ...(q.cursor ? { cursor: q.cursor } : {}), limit: q.limit });
    setNames(page.availableNames);
    return page;
  });
  const activity = useResource(`activity-today:${today}:${tz}`, (ds) => ds.getActivityToday(today));
  const groups = groupByDate(list.items, tz);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="Movimento" title="Exercícios" description="Exercícios recebidos do Auto Export. Somente leitura." />
      <CachedDataNote tz={tz} />
      <div className="flex flex-col gap-3 rounded-card bg-surface p-4 shadow-card sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold">Período</span>
          <ChipGroup label="Período dos exercícios" value={period} onChange={setPeriod} options={PERIOD_OPTIONS} />
        </div>
        <SelectField label="Modalidade" value={name} onChange={(e) => setName(e.target.value)} containerClassName="sm:w-64">
          <option value="">Todas</option>
          {names.map((n) => (
            <option key={n} value={n}>
              {modalityLabel(n)}
            </option>
          ))}
        </SelectField>
      </div>

      {!list.loaded && list.loading ? (
        <SkeletonCard lines={4} />
      ) : list.error != null && !list.loaded ? (
        <ErrorState error={list.error} onRetry={list.reload} />
      ) : list.items.length === 0 ? (
        names.length === 0 ? (
          activity.data && !activity.data.lastReceivedAt ? (
            <ActivityEmpty />
          ) : (
            <p className="rounded-card border border-dashed border-line bg-surface/60 p-4 text-sm text-ink-muted">Nenhum exercício recebido ainda.</p>
          )
        ) : (
          <p className="rounded-card border border-dashed border-line bg-surface/60 p-4 text-sm text-ink-muted">Nenhum exercício neste período ou modalidade.</p>
        )
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map((g) => {
            const total = g.items.reduce((acc, w) => acc + w.durationSeconds, 0);
            return (
              <section key={g.date} aria-labelledby={`ex-${g.date}`} className="flex flex-col gap-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 id={`ex-${g.date}`} className="text-[15px] font-semibold">
                    {g.date === today ? `Hoje, ${formatLongDate(g.date).toLowerCase()}` : formatLongDate(g.date)}
                  </h2>
                  <span className="tabular text-xs text-ink-muted">Total: {formatDuration(total)}</span>
                </div>
                <ul className="flex flex-col gap-2">
                  {g.items.map((w) => (
                    <li key={w.id}>
                      <WorkoutCard workout={w} tz={tz} />
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
          {list.hasMore && (
            <Button onClick={() => void list.loadMore()} pending={list.loading}>
              Carregar mais
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
