'use client';
import { useState } from 'react';
import { Flag, NotebookPen, Pencil, TrendingUp } from 'lucide-react';
import type { Period, WeightEntry } from '@zelo/contracts';
import { useZelo } from '@/shared/data/ZeloProvider';
import { useTimeZone } from '@/shared/data/session';
import { useResource } from '@/shared/data/hooks';
import { usePagedHistory } from '@/shared/data/usePagedHistory';
import { fetchAllPages } from '@/shared/data/paging';
import { useDeleteFlow } from '@/shared/data/useDeleteFlow';
import { formatDecimal, formatDelta, subtractDecimal } from '@/shared/lib/decimal';
import { uuid } from '@/shared/lib/ids';
import { describeInstant, formatDateTime, localDateOf, formatShortDate, periodStart, PERIOD_LABELS } from '@/shared/lib/time';
import { PERIODS } from '@zelo/contracts';
import { Button } from '@/shared/ui/Button';
import { Card, SectionTitle } from '@/shared/ui/Card';
import { TimeLineChart, type ChartPoint } from '@/shared/ui/Chart';
import { ConfirmDialog, Dialog } from '@/shared/ui/Dialog';
import { EmptyState, ErrorState, LoadingState, PersistenceNote, SkeletonCard } from '@/shared/ui/States';
import { ChipGroup } from '@/shared/ui/Tabs';
import { RowActions } from '@/shared/ui/RowActions';
import { WeightForm } from './WeightForm';
import { GoalDialog } from './GoalDialog';

export function WeightPanel() {
  const tz = useTimeZone();
  const { data } = useZelo();
  const [period, setPeriod] = useState<Period>('30d');
  const history = usePagedHistory('weights', (ds, q) => ds.listWeights(q));
  const chart = useResource(`weights-chart:${period}:${tz}`, (ds) => {
    const from = periodStart(period, tz);
    return fetchAllPages((q) => ds.listWeights(q), from ? { from } : {});
  });
  const goal = useResource('weight-goal', (ds) => ds.getWeightGoal());
  const [editing, setEditing] = useState<WeightEntry | null>(null);
  const [goalOpen, setGoalOpen] = useState(false);
  const [lastPersistence, setLastPersistence] = useState<'server' | 'local' | null>(null);
  const del = useDeleteFlow<WeightEntry>({
    what: 'Registro de peso',
    remove: (w) => data.deleteWeight(w.id, { operationId: uuid(), expectedVersion: w.version }),
    restore: (w) =>
      data.createWeight({
        id: uuid(),
        operationId: uuid(),
        measuredAt: w.measuredAt,
        timezone: w.timezone,
        weightKg: w.weightKg,
        ...(w.notes ? { notes: w.notes } : {}),
      }),
  });

  const latest = history.items[0];
  const points: ChartPoint[] = [...(chart.data ?? [])]
    .sort((a, b) => a.measuredAt.localeCompare(b.measuredAt))
    .map((w) => ({ t: Date.parse(w.measuredAt), label: formatDateTime(w.measuredAt, tz), weight: Number(w.weightKg) }));

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:items-start">
      <div className="flex min-w-0 flex-col gap-5">
        {/* Latest */}
        {!history.loaded && history.loading ? (
          <SkeletonCard />
        ) : history.error && !history.loaded ? (
          <ErrorState error={history.error} onRetry={history.reload} />
        ) : (
          <Card aria-labelledby="peso-ultimo">
            <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 size-36 rounded-full bg-brand-yellow/40 blur-xl" />
            <div className="relative flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="peso-ultimo" className="flex items-center gap-2 text-sm font-semibold text-ink">
                  <span aria-hidden className="size-2 rounded-full bg-brand-teal" />
                  Último registro
                </h2>
                {latest && <span className="rounded-full bg-surface-muted px-3 py-1 text-xs font-semibold text-ink-muted">{describeInstant(latest.measuredAt, tz)}</span>}
              </div>
              {latest ? (
                <>
                  <p className="tabular">
                    <span className="font-display text-[40px] font-semibold leading-none">{formatDecimal(latest.weightKg)}</span>{' '}
                    <span className="text-lg font-semibold text-ink-muted">kg</span>
                  </p>
                  {latest.deltaKg != null && (
                    <p className="flex items-center gap-2 rounded-[14px] bg-surface-muted px-3 py-2.5 text-sm text-ink">
                      <TrendingUp aria-hidden className="size-4 shrink-0 text-brand-teal-ink" />
                      <span>
                        Variação de <strong className="tabular">{formatDelta(latest.deltaKg)} kg</strong> em relação ao registro anterior
                      </span>
                    </p>
                  )}
                </>
              ) : (
                <EmptyState title="Nenhum peso registrado">Use o formulário para fazer o primeiro registro.</EmptyState>
              )}
              <GoalRow
                goal={goal.data ?? null}
                loading={goal.loading && goal.data === undefined}
                latestKg={latest?.weightKg}
                onEdit={() => setGoalOpen(true)}
              />
            </div>
          </Card>
        )}

        {/* Chart */}
        <Card aria-labelledby="peso-grafico">
          <div className="flex flex-col gap-4">
            <h2 id="peso-grafico" className="flex items-center gap-2 font-display text-xl font-semibold">
              <TrendingUp aria-hidden className="size-5 text-brand-teal-ink" />
              Evolução do peso
            </h2>
            <ChipGroup label="Período do gráfico" value={period} onChange={setPeriod} options={PERIODS.map((p) => ({ value: p, label: PERIOD_LABELS[p] }))} />
            {chart.loading && !chart.data ? (
              <LoadingState />
            ) : chart.error ? (
              <ErrorState error={chart.error} onRetry={chart.reload} />
            ) : (
              <TimeLineChart
                title="Evolução do peso"
                points={points}
                series={[{ key: 'weight', label: 'Peso', color: '#069494', unit: 'kg' }]}
                formatValue={(v) => `${formatDecimal(String(v))} kg`}
                tickFormat={(t) => formatShortDate(localDateOf(t, tz))}
                emptyText="Nenhum peso registrado neste período."
              />
            )}
          </div>
        </Card>
      </div>

      <div className="flex min-w-0 flex-col gap-5">
        {/* Form */}
        <Card aria-labelledby="peso-novo">
          <div className="mb-4 flex items-start gap-3">
            <div className="flex size-10 items-center justify-center rounded-full bg-wash-peach text-brand-orange-ink">
              <NotebookPen aria-hidden className="size-5" />
            </div>
            <div>
              <h2 id="peso-novo" className="text-lg font-semibold">
                Novo registro de peso
              </h2>
              <p className="text-xs text-ink-muted">Você pode registrar mais de uma vez por dia.</p>
            </div>
          </div>
          <WeightForm onDone={(m) => setLastPersistence(m.persistence)} />
          <div className="mt-3">
            <PersistenceNote persistence={lastPersistence} what="Peso registrado" />
          </div>
        </Card>

        {/* History */}
        <section aria-labelledby="peso-historico" className="flex flex-col gap-3">
          <SectionTitle id="peso-historico" accent="teal">
            Histórico
          </SectionTitle>
          {history.error != null && history.loaded && <ErrorState error={history.error} onRetry={history.reload} />}
          {history.loaded && history.items.length === 0 && <p className="text-sm text-ink-muted">Seus registros aparecerão aqui.</p>}
          <ul className="flex flex-col gap-2">
            {history.items.map((w) => (
              <li key={w.id} className="flex items-center gap-3 rounded-card bg-surface p-3 pl-4 shadow-card">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="tabular text-lg font-semibold">{formatDecimal(w.weightKg)} kg</span>
                    {w.deltaKg != null && (
                      <span className="tabular rounded-full bg-brand-teal-wash px-2 py-0.5 text-xs font-semibold text-brand-teal-ink">{formatDelta(w.deltaKg)} kg</span>
                    )}
                  </p>
                  <p className="text-xs text-ink-muted">{describeInstant(w.measuredAt, tz)}</p>
                  {w.notes && <p className="mt-0.5 break-words text-xs italic text-ink-muted">“{w.notes}”</p>}
                </div>
                <RowActions label={`peso de ${formatDateTime(w.measuredAt, tz)}`} onEdit={() => setEditing(w)} onDelete={() => del.ask(w)} />
              </li>
            ))}
          </ul>
          {history.hasMore && (
            <Button onClick={() => void history.loadMore()} pending={history.loading}>
              Carregar mais
            </Button>
          )}
        </section>
      </div>

      <Dialog open={!!editing} onClose={() => setEditing(null)} title="Editar peso">
        {editing && (
          <WeightForm
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
        title="Excluir este registro de peso?"
        description={del.target ? `${formatDecimal(del.target.weightKg)} kg — ${describeInstant(del.target.measuredAt, tz)}` : undefined}
        confirmLabel="Excluir"
        danger
        pending={del.pending}
        error={del.error}
        onConfirm={() => void del.confirm()}
        onClose={del.cancel}
      />
      {goalOpen && <GoalDialog goal={goal.data ?? null} onClose={() => setGoalOpen(false)} onChanged={goal.reload} />}
    </div>
  );
}

function GoalRow({
  goal,
  loading,
  latestKg,
  onEdit,
}: {
  goal: { targetKg: string } | null;
  loading: boolean;
  latestKg?: string;
  onEdit: () => void;
}) {
  if (loading) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line/70 pt-3">
      <p className="flex items-center gap-2 text-sm text-ink">
        <Flag aria-hidden className="size-4 text-brand-orange-ink" />
        {goal ? (
          <span>
            Meta pessoal: <strong className="tabular">{formatDecimal(goal.targetKg)} kg</strong>
            {latestKg && (
              <span className="tabular text-ink-muted"> • diferença de {formatDecimal(subtractDecimal(latestKg, goal.targetKg).replace('-', ''))} kg</span>
            )}
          </span>
        ) : (
          <span className="text-ink-muted">Sem meta definida (opcional)</span>
        )}
      </p>
      <Button size="sm" variant="ghost" onClick={onEdit} icon={goal ? <Pencil aria-hidden className="size-4" /> : undefined}>
        {goal ? 'Editar meta' : 'Definir meta'}
      </Button>
    </div>
  );
}

