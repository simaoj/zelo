'use client';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CalendarDays, ChevronLeft, ChevronRight, CirclePlus, Droplets, GlassWater, Info, Milk, SlidersHorizontal, CupSoda } from 'lucide-react';
import { QUICK_WATER_AMOUNTS_ML, type WaterEntry } from '@zelo/contracts';
import { useZelo } from '@/shared/data/ZeloProvider';
import { useTimeZone } from '@/shared/data/session';
import { useResource } from '@/shared/data/hooks';
import { useDeleteFlow } from '@/shared/data/useDeleteFlow';
import { uuid } from '@/shared/lib/ids';
import { addDays, formatDayMonth, formatLongDate, formatShortDate, localTimeOf, todayIn, WEEKDAY_SHORT } from '@/shared/lib/time';
import { formatInt, formatMl, percentOf } from '@/shared/lib/format';
import { Button } from '@/shared/ui/Button';
import { Card, SectionTitle } from '@/shared/ui/Card';
import { DailyBarChart } from '@/shared/ui/Chart';
import { ConfirmDialog, Dialog } from '@/shared/ui/Dialog';
import { IntGoalDialog } from '@/shared/ui/IntGoalDialog';
import { ProgressRing } from '@/shared/ui/ProgressRing';
import { ErrorState, LoadingState, PersistenceNote, SkeletonCard } from '@/shared/ui/States';
import { ChipGroup } from '@/shared/ui/Tabs';
import { RowActions } from '@/shared/ui/RowActions';
import { cx } from '@/shared/ui/cx';
import { WaterForm } from './WaterForm';
import { useWaterQuickAdd } from './useWaterQuickAdd';
import { dayBounds, lastDays, WATER_MAX_ML } from './waterLogic';

const QUICK_META: Record<number, { label: string; icon: typeof GlassWater; tone: string }> = {
  200: { label: 'Copo comum', icon: GlassWater, tone: 'bg-brand-teal-wash text-brand-teal-ink' },
  300: { label: 'Copo grande', icon: CupSoda, tone: 'bg-wash-peach text-brand-orange-ink' },
  500: { label: 'Garrafinha', icon: Milk, tone: 'bg-wash-sun text-[#6c5e00]' },
};

type Range = '7' | '30';

function weekdayOf(date: string) {
  const [y, m, d] = date.split('-').map(Number);
  return WEEKDAY_SHORT[new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay()]!;
}

export function WaterPage() {
  const tz = useTimeZone();
  const { data } = useZelo();
  const router = useRouter();
  const params = useSearchParams();
  const today = todayIn(tz);
  const requested = params.get('dia');
  const date = requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) && requested <= today ? requested : today;
  const isToday = date === today;
  const setDate = (d: string) => router.replace(d === today ? '/saude/agua' : `/saude/agua?dia=${d}`, { scroll: false });

  const [range, setRange] = useState<Range>('7');
  const day = useResource(`hydration-day:${date}:${tz}`, (ds) => ds.getHydrationSummary(date, date));
  const entries = useResource(`water-entries:${date}:${tz}`, async (ds) => {
    const { from, to } = dayBounds(date, tz);
    const page = await ds.listWaterEntries({ from, to, limit: 200 });
    return [...page.items].sort((a, b) => b.consumedAt.localeCompare(a.consumedAt));
  });
  const history = useResource(`hydration-history:${range}:${today}:${tz}`, (ds) => {
    const { from, to } = lastDays(today, Number(range));
    return ds.getHydrationSummary(from, to);
  });

  const quick = useWaterQuickAdd(tz);
  const [customOpen, setCustomOpen] = useState(false);
  const [goalOpen, setGoalOpen] = useState(false);
  const [editing, setEditing] = useState<WaterEntry | null>(null);
  const [lastPersistence, setLastPersistence] = useState<'server' | 'local' | null>(null);
  const del = useDeleteFlow<WaterEntry>({
    what: 'Registro de água',
    remove: (w) => data.deleteWaterEntry(w.id, { operationId: uuid(), expectedVersion: w.version }),
    restore: (w) =>
      data.createWaterEntry({ id: uuid(), operationId: uuid(), consumedAt: w.consumedAt, timezone: w.timezone, amountMl: w.amountMl, ...(w.notes ? { notes: w.notes } : {}) }),
  });

  const summaryDay = day.data?.days[0];
  const goal = day.data?.goal ?? history.data?.goal ?? null;
  const total = summaryDay?.totalMl ?? null;
  const persistence = quick.lastPersistence ?? lastPersistence;

  return (
    <div className="flex flex-col gap-5">
      <h1 className="sr-only">Água</h1>
      {/* Date navigator */}
      <div className="flex items-center justify-between gap-2 rounded-card bg-surface-muted p-1.5">
        <button
          type="button"
          onClick={() => setDate(addDays(date, -1))}
          className="inline-flex size-11 items-center justify-center rounded-full text-ink hover:bg-surface"
        >
          <ChevronLeft aria-hidden className="size-5" />
          <span className="sr-only">Dia anterior</span>
        </button>
        <p className="flex min-w-0 items-center gap-2 text-center text-[15px] font-semibold" aria-live="polite">
          <CalendarDays aria-hidden className="size-[18px] shrink-0 text-brand-teal-ink" />
          <span className="truncate">{isToday ? `Hoje, ${formatDayMonth(date)}` : formatLongDate(date)}</span>
        </p>
        <button
          type="button"
          onClick={() => setDate(addDays(date, 1))}
          disabled={isToday}
          className="inline-flex size-11 items-center justify-center rounded-full text-ink hover:bg-surface disabled:opacity-30"
        >
          <ChevronRight aria-hidden className="size-5" />
          <span className="sr-only">Próximo dia</span>
        </button>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:items-start">
        <div className="flex min-w-0 flex-col gap-5">
          {/* Day total */}
          {day.loading && !day.data ? (
            <SkeletonCard lines={4} />
          ) : day.error && !day.data ? (
            <ErrorState error={day.error} onRetry={day.reload} />
          ) : (
            <Card aria-labelledby="agua-total" className="flex flex-col items-center gap-4 text-center">
              <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 size-36 rounded-full bg-brand-teal-wash" />
              <div aria-hidden className="pointer-events-none absolute -bottom-12 -left-10 size-32 rounded-full bg-wash-sun" />
              <h2 id="agua-total" className="relative inline-flex items-center gap-1.5 rounded-full bg-brand-teal-wash px-3 py-1 text-xs font-semibold text-brand-teal-ink">
                <Droplets aria-hidden className="size-4" />
                {isToday ? 'Água de hoje' : `Água em ${formatShortDate(date)}`}
              </h2>
              <ProgressRing fraction={goal && total != null ? total / goal.dailyTargetMl : null} size={200}>
                {total != null ? (
                  <>
                    <span className="tabular font-display text-[40px] font-semibold leading-none">{formatInt(total)}</span>
                    <span className="mt-1 text-sm text-ink-muted">ml de água</span>
                    {goal && (
                      <span className="tabular mt-2 rounded-full bg-brand-teal-wash px-2.5 py-0.5 text-xs font-semibold text-brand-teal-ink">
                        {percentOf(total, goal.dailyTargetMl)}% da meta
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <span className="font-display text-xl font-semibold leading-tight">Sem registros</span>
                    <span className="mt-1 max-w-[9rem] text-xs text-ink-muted">{isToday ? 'Nenhuma água registrada hoje ainda' : 'Nenhuma água registrada neste dia'}</span>
                  </>
                )}
              </ProgressRing>
              <p className="sr-only" role="status">
                {total != null ? `Total: ${formatMl(total)}${goal ? ` de ${formatMl(goal.dailyTargetMl)} da meta pessoal` : ''}` : 'Sem registros neste dia'}
              </p>
              <div className="relative flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
                {goal ? (
                  <p className="tabular text-[15px]">
                    Meta pessoal: <strong>{formatMl(goal.dailyTargetMl)}</strong>
                  </p>
                ) : (
                  <p className="text-[15px] text-ink-muted">Nenhuma meta pessoal definida</p>
                )}
                <button
                  type="button"
                  onClick={() => setGoalOpen(true)}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-[12px] px-2 text-sm font-semibold text-brand-orange-ink hover:bg-wash-peach"
                >
                  <SlidersHorizontal aria-hidden className="size-4" />
                  {goal ? 'Ajustar' : 'Definir meta'}
                </button>
              </div>
              <p className="relative max-w-sm text-sm text-ink-muted">Um gole de cada vez. Cada registro ajuda você a acompanhar o seu dia.</p>
            </Card>
          )}

          {/* Quick add */}
          <section aria-labelledby="agua-rapido" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="agua-rapido" className="font-display text-xl font-semibold">
                {isToday ? 'Registro rápido' : 'Registrar neste dia'}
              </h2>
              {isToday && <span className="text-xs text-ink-muted">1 toque salva</span>}
            </div>
            {isToday && (
              <div className="grid grid-cols-3 gap-2 sm:gap-3">
                {QUICK_WATER_AMOUNTS_ML.map((ml) => {
                  const meta = QUICK_META[ml]!;
                  const Icon = meta.icon;
                  const busy = quick.pendingAmount === ml;
                  return (
                    <button
                      key={ml}
                      type="button"
                      onClick={() => void quick.add(ml)}
                      disabled={quick.pendingAmount != null}
                      aria-busy={busy || undefined}
                      aria-label={`Registrar ${formatMl(ml)} agora`}
                      className="flex min-h-24 flex-col items-center justify-center gap-1.5 rounded-card bg-surface p-2 shadow-card transition-colors hover:bg-wash-peach disabled:opacity-60"
                    >
                      <span className={cx('flex size-10 items-center justify-center rounded-full', meta.tone)}>
                        <Icon aria-hidden className="size-5" />
                      </span>
                      <span className="tabular text-[15px] font-bold">+{formatMl(ml)}</span>
                      <span className="text-[11px] text-ink-muted">{meta.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
            <Button variant="soft" size="lg" onClick={() => setCustomOpen(true)} icon={<CirclePlus aria-hidden className="size-5 text-brand-orange-ink" />}>
              Outra quantidade ou horário
            </Button>
            {isToday && (
              <p className="flex items-start gap-2 text-xs text-ink-muted">
                <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-brand-teal-ink" />
                Os botões rápidos salvam na hora, com a opção de desfazer logo em seguida.
              </p>
            )}
            <PersistenceNote persistence={persistence} what="Água registrada" />
          </section>

          {/* History chart */}
          <Card aria-labelledby="agua-historico">
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 id="agua-historico" className="font-display text-xl font-semibold">
                    Histórico
                  </h2>
                  {history.data && (
                    <p className="tabular text-sm text-ink-muted">
                      {history.data.averageMlOnRecordedDays != null ? (
                        <>
                          Média nos dias com registro: <strong className="text-brand-teal-ink">{formatMl(history.data.averageMlOnRecordedDays)}</strong>
                        </>
                      ) : (
                        'Nenhum dia com registro neste período'
                      )}
                    </p>
                  )}
                </div>
                <ChipGroup
                  label="Período do histórico de água"
                  value={range}
                  onChange={setRange}
                  options={[
                    { value: '7', label: '7 dias' },
                    { value: '30', label: '30 dias' },
                  ]}
                />
              </div>
              {history.loading && !history.data ? (
                <LoadingState />
              ) : history.error && !history.data ? (
                <ErrorState error={history.error} onRetry={history.reload} />
              ) : history.data ? (
                <DailyBarChart
                  title={`Água por dia, últimos ${range} dias (ml)`}
                  days={history.data.days.map((d) => ({ date: d.date, value: d.totalMl }))}
                  formatValue={formatMl}
                  tickFormat={range === '7' ? weekdayOf : formatShortDate}
                  rowLabel={(d) => `${weekdayOf(d)}, ${formatShortDate(d)}`}
                  absentLabel="sem registros"
                  goal={history.data.goal?.dailyTargetMl ?? null}
                  highlightDate={today}
                />
              ) : null}
            </div>
          </Card>
        </div>

        {/* Day list */}
        <section aria-labelledby="agua-lista" className="flex min-w-0 flex-col gap-3">
          <SectionTitle
            id="agua-lista"
            accent="teal"
            action={total != null ? <span className="tabular text-xs font-medium text-ink-muted">Total: {formatMl(total)}</span> : undefined}
          >
            {isToday ? 'Registros de hoje' : `Registros de ${formatShortDate(date)}`}
          </SectionTitle>
          {entries.loading && !entries.data ? (
            <SkeletonCard lines={2} />
          ) : entries.error && !entries.data ? (
            <ErrorState error={entries.error} onRetry={entries.reload} />
          ) : entries.data && entries.data.length === 0 ? (
            <p className="rounded-card border border-dashed border-line bg-surface/60 p-4 text-sm text-ink-muted">Sem registros de água neste dia.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {entries.data?.map((w) => (
                <li key={w.id} className="flex items-center gap-3 rounded-card bg-surface p-3 pl-4 shadow-card">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-teal-wash text-brand-teal-ink">
                    <GlassWater aria-hidden className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="tabular">
                      <span className="text-lg font-semibold">{formatMl(w.amountMl)}</span>{' '}
                      <span className="text-xs text-ink-muted">às {localTimeOf(w.consumedAt, tz)}</span>
                    </p>
                    {w.notes && <p className="break-words text-xs italic text-ink-muted">“{w.notes}”</p>}
                  </div>
                  <RowActions label={`${formatMl(w.amountMl)} às ${localTimeOf(w.consumedAt, tz)}`} onEdit={() => setEditing(w)} onDelete={() => del.ask(w)} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <Dialog open={customOpen} onClose={() => setCustomOpen(false)} title="Registrar água" description="Informe a quantidade e, se quiser, outro horário.">
        {customOpen && (
          <WaterForm
            initialWhen={isToday ? undefined : { date, time: '12:00' }}
            onDone={(m) => {
              setLastPersistence(m.persistence);
              setCustomOpen(false);
            }}
            onCancel={() => setCustomOpen(false)}
          />
        )}
      </Dialog>
      <Dialog open={!!editing} onClose={() => setEditing(null)} title="Editar registro de água">
        {editing && (
          <WaterForm
            key={editing.id}
            entry={editing}
            onDone={(m) => {
              setLastPersistence(m.persistence);
              setEditing(null);
            }}
            onCancel={() => setEditing(null)}
            onConflict={() => {
              setEditing(null);
              entries.reload();
            }}
          />
        )}
      </Dialog>
      <ConfirmDialog
        open={!!del.target}
        title="Excluir este registro de água?"
        description={del.target ? `${formatMl(del.target.amountMl)} às ${localTimeOf(del.target.consumedAt, tz)}` : undefined}
        confirmLabel="Excluir"
        danger
        pending={del.pending}
        error={del.error}
        onConfirm={() => void del.confirm()}
        onClose={del.cancel}
      />
      {goalOpen && (
        <IntGoalDialog
          title={goal ? 'Ajustar meta pessoal de água' : 'Definir meta pessoal de água'}
          label="Meta diária"
          unit="ml"
          current={goal?.dailyTargetMl ?? null}
          max={WATER_MAX_ML}
          onSave={(v, operationId) => data.putHydrationGoal({ operationId, dailyTargetMl: v })}
          onRemove={() => data.deleteHydrationGoal()}
          onClose={() => setGoalOpen(false)}
        />
      )}
    </div>
  );
}
