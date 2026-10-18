'use client';
import { useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { useResource } from '@/shared/data/hooks';
import { useTimeZone } from '@/shared/data/session';
import { addDays, formatShortDate, todayIn, WEEKDAY_SHORT } from '@/shared/lib/time';
import { formatInt, formatSteps } from '@/shared/lib/format';
import { Card, PageHeader, SectionTitle } from '@/shared/ui/Card';
import { DailyBarChart } from '@/shared/ui/Chart';
import { ErrorState, LoadingState, SkeletonCard } from '@/shared/ui/States';
import { ChipGroup } from '@/shared/ui/Tabs';
import { cx } from '@/shared/ui/cx';
import { ActivityEmpty, CachedDataNote, ReceivedLine } from './ActivityBits';
import { StepsGoalDialog } from './StepsGoal';
import { stepsDayStatus } from './activityLogic';

type Range = '7' | '30';

function weekdayOf(date: string) {
  const [y, m, d] = date.split('-').map(Number);
  return WEEKDAY_SHORT[new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay()]!;
}

export function StepsPage() {
  const tz = useTimeZone();
  const today = todayIn(tz);
  const [range, setRange] = useState<Range>('7');
  const [goalOpen, setGoalOpen] = useState(false);
  const steps = useResource(`steps:${range}:${today}:${tz}`, (ds) => ds.getStepsSummary(addDays(today, -(Number(range) - 1)), today));
  const s = steps.data;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="Movimento" title="Passos" description="Totais diários recebidos do Auto Export. Não é possível editar os passos aqui." />
      <CachedDataNote tz={tz} />
      {steps.loading && !s ? (
        <SkeletonCard lines={5} />
      ) : steps.error && !s ? (
        <ErrorState error={steps.error} onRetry={steps.reload} />
      ) : s ? (
        <>
          {!s.lastReceivedAt && <ActivityEmpty />}
          <Card aria-labelledby="passos-grafico">
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 id="passos-grafico" className="font-display text-xl font-semibold">
                    Passos por dia
                  </h2>
                  <p className="tabular text-sm text-ink-muted">
                    {s.averageOnDaysWithData != null ? (
                      <>
                        Média nos dias com dados: <strong className="text-brand-teal-ink">{formatSteps(s.averageOnDaysWithData)}</strong>
                      </>
                    ) : (
                      'Nenhum dia com dados neste período'
                    )}
                  </p>
                </div>
                <ChipGroup
                  label="Período do histórico de passos"
                  value={range}
                  onChange={setRange}
                  options={[
                    { value: '7', label: '7 dias' },
                    { value: '30', label: '30 dias' },
                  ]}
                />
              </div>
              {steps.loading ? (
                <LoadingState />
              ) : (
                <DailyBarChart
                  title={`Passos por dia, últimos ${range} dias`}
                  days={s.days.map((d) => ({ date: d.date, value: d.count, note: d.partial ? 'parcial' : undefined }))}
                  formatValue={formatSteps}
                  tickFormat={range === '7' ? weekdayOf : formatShortDate}
                  rowLabel={(d) => `${weekdayOf(d)}, ${formatShortDate(d)}`}
                  absentLabel="sem dados"
                  goal={s.goal?.dailyStepsTarget ?? null}
                  highlightDate={today}
                  color="#ffc9a8"
                />
              )}
              <div className="flex flex-wrap items-center gap-x-3 border-t border-line pt-3">
                <p className="tabular text-sm">{s.goal ? `Meta pessoal: ${formatSteps(s.goal.dailyStepsTarget)}` : 'Nenhuma meta pessoal de passos definida'}</p>
                <button
                  type="button"
                  onClick={() => setGoalOpen(true)}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-[12px] px-2 text-sm font-semibold text-brand-orange-ink hover:bg-wash-peach"
                >
                  <SlidersHorizontal aria-hidden className="size-4" />
                  {s.goal ? 'Ajustar' : 'Definir meta'}
                </button>
              </div>
              <ReceivedLine lastReceivedAt={s.lastReceivedAt} tz={tz} />
            </div>
          </Card>

          <section aria-labelledby="passos-dias" className="flex flex-col gap-3">
            <SectionTitle id="passos-dias" accent="orange">
              Dia a dia
            </SectionTitle>
            <ul className="flex flex-col gap-2">
              {[...s.days].reverse().map((d) => {
                const st = stepsDayStatus(d);
                return (
                  <li key={d.date} className="flex flex-wrap items-center justify-between gap-2 rounded-card bg-surface px-4 py-3 shadow-card">
                    <span className="text-sm font-semibold">
                      {d.date === today ? 'Hoje' : weekdayOf(d.date)}, {formatShortDate(d.date)}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className={cx('tabular text-sm', st.kind === 'absent' ? 'text-ink-muted' : 'font-semibold')}>{st.kind === 'value' ? formatInt(d.count!) + ' passos' : st.text}</span>
                      {st.partial && st.kind !== 'absent' && (
                        <span className="rounded-full bg-wash-sun px-2 py-0.5 text-xs font-semibold text-[#524700]">Parcial (hoje)</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      ) : null}
      {goalOpen && <StepsGoalDialog goal={s?.goal ?? null} onClose={() => setGoalOpen(false)} />}
    </div>
  );
}
