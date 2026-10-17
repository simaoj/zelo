'use client';
import { useState } from 'react';
import { HeartPulse, Info, NotebookPen } from 'lucide-react';
import { PERIODS, type BloodPressureEntry, type Period } from '@zelo/contracts';
import { useZelo } from '@/shared/data/ZeloProvider';
import { useTimeZone } from '@/shared/data/session';
import { useResource } from '@/shared/data/hooks';
import { usePagedHistory } from '@/shared/data/usePagedHistory';
import { fetchAllPages } from '@/shared/data/paging';
import { useDeleteFlow } from '@/shared/data/useDeleteFlow';
import { uuid } from '@/shared/lib/ids';
import { describeInstant, formatDateTime, formatShortDate, localDateOf, periodStart, PERIOD_LABELS } from '@/shared/lib/time';
import { Button } from '@/shared/ui/Button';
import { Card, PageHeader, SectionTitle } from '@/shared/ui/Card';
import { TimeLineChart, type ChartPoint } from '@/shared/ui/Chart';
import { ConfirmDialog, Dialog } from '@/shared/ui/Dialog';
import { EmptyState, ErrorState, LoadingState, PersistenceNote, SkeletonCard } from '@/shared/ui/States';
import { ChipGroup } from '@/shared/ui/Tabs';
import { RowActions } from '@/shared/ui/RowActions';
import { BloodPressureForm } from './BloodPressureForm';

export const BP_NOTE = 'Seus registros ajudam no acompanhamento com um profissional de saúde.';

export function BloodPressurePage() {
  const tz = useTimeZone();
  const { data } = useZelo();
  const [period, setPeriod] = useState<Period>('7d');
  const history = usePagedHistory('blood-pressure', (ds, q) => ds.listBloodPressure(q));
  const chart = useResource(`bp-chart:${period}:${tz}`, (ds) => {
    const from = periodStart(period, tz);
    return fetchAllPages((q) => ds.listBloodPressure(q), from ? { from } : {});
  });
  const [editing, setEditing] = useState<BloodPressureEntry | null>(null);
  const [lastPersistence, setLastPersistence] = useState<'server' | 'local' | null>(null);
  const del = useDeleteFlow<BloodPressureEntry>({
    what: 'Registro de pressão',
    remove: (b) => data.deleteBloodPressure(b.id, { operationId: uuid(), expectedVersion: b.version }),
    restore: (b) =>
      data.createBloodPressure({
        id: uuid(),
        operationId: uuid(),
        measuredAt: b.measuredAt,
        timezone: b.timezone,
        systolic: b.systolic,
        diastolic: b.diastolic,
        pulseBpm: b.pulseBpm,
        ...(b.diastolic >= b.systolic ? { confirmedUnusual: true } : {}),
        ...(b.notes ? { notes: b.notes } : {}),
      }),
  });

  const latest = history.items[0];
  const sorted = [...(chart.data ?? [])].sort((a, b) => a.measuredAt.localeCompare(b.measuredAt));
  const bpPoints: ChartPoint[] = sorted.map((b) => ({ t: Date.parse(b.measuredAt), label: formatDateTime(b.measuredAt, tz), systolic: b.systolic, diastolic: b.diastolic }));
  const pulsePoints: ChartPoint[] = sorted
    .filter((b) => b.pulseBpm != null)
    .map((b) => ({ t: Date.parse(b.measuredAt), label: formatDateTime(b.measuredAt, tz), pulse: b.pulseBpm }));
  const tick = (t: number) => formatShortDate(localDateOf(t, tz));

  return (
    <div className="flex flex-col gap-5">
      <section className="relative overflow-hidden rounded-card bg-wash-sun p-5">
        <div aria-hidden className="pointer-events-none absolute -right-6 -top-8 size-28 rounded-full bg-brand-yellow/70" />
        <div aria-hidden className="pointer-events-none absolute -bottom-10 right-16 size-20 rounded-full bg-brand-pink/60" />
        <div className="relative">
          <PageHeader eyebrow="Cuidado contínuo" title="Pressão arterial" description={BP_NOTE} />
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:items-start">
        <div className="flex min-w-0 flex-col gap-5">
          {!history.loaded && history.loading ? (
            <SkeletonCard />
          ) : history.error != null && !history.loaded ? (
            <ErrorState error={history.error} onRetry={history.reload} />
          ) : (
            <Card aria-labelledby="pa-ultima">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h2 id="pa-ultima" className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-muted">
                  Última aferição
                </h2>
                {latest && <span className="rounded-full bg-surface-muted px-3 py-1 text-xs font-semibold text-ink-muted">{describeInstant(latest.measuredAt, tz)}</span>}
              </div>
              {latest ? (
                <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
                  <p className="tabular">
                    <span className="font-display text-[40px] font-semibold leading-none">
                      {latest.systolic} / {latest.diastolic}
                    </span>{' '}
                    <span className="text-sm font-semibold text-ink-muted">mmHg</span>
                  </p>
                  <div className="flex items-center gap-2 rounded-[14px] bg-wash-peach px-3 py-2">
                    <HeartPulse aria-hidden className="size-5 text-brand-orange-ink" />
                    <span className="text-sm">
                      Pulso{' '}
                      <strong className="tabular">{latest.pulseBpm != null ? `${latest.pulseBpm} bpm` : 'não informado'}</strong>
                    </span>
                  </div>
                </div>
              ) : (
                <div className="mt-3">
                  <EmptyState title="Nenhuma pressão registrada">Use o formulário para registrar a primeira aferição.</EmptyState>
                </div>
              )}
            </Card>
          )}

          <Card aria-labelledby="pa-grafico">
            <div className="flex flex-col gap-4">
              <h2 id="pa-grafico" className="font-display text-xl font-semibold">
                Curva de pressão
              </h2>
              <ChipGroup label="Período dos gráficos" value={period} onChange={setPeriod} options={PERIODS.map((p) => ({ value: p, label: PERIOD_LABELS[p] }))} />
              {chart.loading && !chart.data ? (
                <LoadingState />
              ) : chart.error ? (
                <ErrorState error={chart.error} onRetry={chart.reload} />
              ) : (
                <>
                  <TimeLineChart
                    title="Pressão arterial (mmHg)"
                    points={bpPoints}
                    series={[
                      { key: 'systolic', label: 'Sistólica', color: '#006a6a', unit: 'mmHg' },
                      { key: 'diastolic', label: 'Diastólica', color: '#e8692b', unit: 'mmHg', dashed: true },
                    ]}
                    formatValue={(v) => `${v} mmHg`}
                    tickFormat={tick}
                    emptyText="Nenhuma aferição neste período."
                  />
                  <h3 className="mt-2 text-sm font-semibold">Pulso (bpm)</h3>
                  <TimeLineChart
                    title="Pulso (bpm)"
                    height={160}
                    points={pulsePoints}
                    series={[{ key: 'pulse', label: 'Pulso', color: '#b7a649', unit: 'bpm' }]}
                    formatValue={(v) => `${v} bpm`}
                    tickFormat={tick}
                    emptyText="Nenhum pulso informado neste período."
                  />
                </>
              )}
            </div>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <Card aria-labelledby="pa-nova">
            <div className="mb-4 flex items-center gap-3">
              <span aria-hidden className="h-8 w-2 rounded-full bg-brand-orange" />
              <h2 id="pa-nova" className="flex items-center gap-2 font-display text-xl font-semibold">
                Registrar nova pressão
              </h2>
              <NotebookPen aria-hidden className="ml-auto size-5 text-ink-muted" />
            </div>
            <BloodPressureForm onDone={(m) => setLastPersistence(m.persistence)} />
            <div className="mt-3">
              <PersistenceNote persistence={lastPersistence} what="Pressão registrada" />
            </div>
          </Card>

          <section aria-labelledby="pa-historico" className="flex flex-col gap-3">
            <SectionTitle id="pa-historico" accent="teal">
              Histórico
            </SectionTitle>
            {history.loaded && history.items.length === 0 && <p className="text-sm text-ink-muted">Suas aferições aparecerão aqui.</p>}
            <ul className="flex flex-col gap-2">
              {history.items.map((b) => (
                <li key={b.id} className="flex items-center gap-3 rounded-card bg-surface p-3 pl-4 shadow-card">
                  <div className="min-w-0 flex-1">
                    <p className="tabular text-lg font-semibold">
                      {b.systolic} / {b.diastolic} <span className="text-xs font-semibold text-ink-muted">mmHg</span>
                    </p>
                    <p className="text-xs text-ink-muted">{describeInstant(b.measuredAt, tz)}</p>
                    <p className="mt-1 flex flex-wrap gap-1.5 text-xs">
                      <span className="tabular rounded-full bg-surface-muted px-2 py-0.5">{b.pulseBpm != null ? `Pulso ${b.pulseBpm} bpm` : 'Sem pulso'}</span>
                    </p>
                    {b.notes && <p className="mt-0.5 break-words text-xs italic text-ink-muted">“{b.notes}”</p>}
                  </div>
                  <RowActions label={`pressão de ${formatDateTime(b.measuredAt, tz)}`} onEdit={() => setEditing(b)} onDelete={() => del.ask(b)} />
                </li>
              ))}
            </ul>
            {history.hasMore && (
              <Button onClick={() => void history.loadMore()} pending={history.loading}>
                Carregar mais
              </Button>
            )}
          </section>

          <p className="flex items-start gap-2 rounded-card bg-surface-muted p-4 text-sm text-ink">
            <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-brand-teal-ink" />
            {BP_NOTE} O Zelo não faz diagnósticos nem classificações.
          </p>
        </div>
      </div>

      <Dialog open={!!editing} onClose={() => setEditing(null)} title="Editar pressão">
        {editing && (
          <BloodPressureForm
            key={editing.id}
            entry={editing}
            onDone={(m) => {
              setLastPersistence(m.persistence);
              setEditing(null);
            }}
            onCancel={() => setEditing(null)}
            onConflict={() => {
              setEditing(null);
              history.reload();
            }}
          />
        )}
      </Dialog>
      <ConfirmDialog
        open={!!del.target}
        title="Excluir esta aferição?"
        description={del.target ? `${del.target.systolic} / ${del.target.diastolic} mmHg — ${describeInstant(del.target.measuredAt, tz)}` : undefined}
        confirmLabel="Excluir"
        danger
        pending={del.pending}
        error={del.error}
        onConfirm={() => void del.confirm()}
        onClose={del.cancel}
      />
    </div>
  );
}
