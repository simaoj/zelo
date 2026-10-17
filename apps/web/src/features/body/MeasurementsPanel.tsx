'use client';
import { useMemo, useState } from 'react';
import { NotebookPen, Ruler } from 'lucide-react';
import { PERIODS, type MeasurementSession, type MeasurementType, type Period, type Side } from '@zelo/contracts';
import { useZelo } from '@/shared/data/ZeloProvider';
import { useTimeZone } from '@/shared/data/session';
import { useResource } from '@/shared/data/hooks';
import { usePagedHistory } from '@/shared/data/usePagedHistory';
import { fetchAllPages } from '@/shared/data/paging';
import { useDeleteFlow } from '@/shared/data/useDeleteFlow';
import { formatDecimal, formatDelta, subtractDecimal } from '@/shared/lib/decimal';
import { uuid } from '@/shared/lib/ids';
import { describeInstant, formatDateTime, formatShortDate, localDateOf, periodStart, PERIOD_LABELS } from '@/shared/lib/time';
import { Button } from '@/shared/ui/Button';
import { Card, SectionTitle } from '@/shared/ui/Card';
import { TimeLineChart } from '@/shared/ui/Chart';
import { ConfirmDialog, Dialog } from '@/shared/ui/Dialog';
import { EmptyState, ErrorState, LoadingState, PersistenceNote } from '@/shared/ui/States';
import { ChipGroup } from '@/shared/ui/Tabs';
import { RowActions } from '@/shared/ui/RowActions';
import { MeasurementForm } from './MeasurementForm';
import { availableCombos, measurementLabel, seriesFor } from './measurementLogic';

export function MeasurementsPanel() {
  const tz = useTimeZone();
  const { data } = useZelo();
  const history = usePagedHistory('measurements', (ds, q) => ds.listMeasurements(q));
  // all sessions (for comparison with the previous equivalent record and chart)
  const all = useResource('measurements-all', (ds) => fetchAllPages((q) => ds.listMeasurements(q), {}));
  const [period, setPeriod] = useState<Period>('90d');
  const [comboKey, setComboKey] = useState<string>('');
  const [editing, setEditing] = useState<MeasurementSession | null>(null);
  const [lastPersistence, setLastPersistence] = useState<'server' | 'local' | null>(null);
  const del = useDeleteFlow<MeasurementSession>({
    what: 'Sessão de medidas',
    remove: (s) => data.deleteMeasurement(s.id, { operationId: uuid(), expectedVersion: s.version }),
    restore: (s) =>
      data.createMeasurement({
        id: uuid(),
        operationId: uuid(),
        measuredAt: s.measuredAt,
        timezone: s.timezone,
        values: s.values,
        ...(s.notes ? { notes: s.notes } : {}),
      }),
  });

  const sessions = useMemo(() => all.data ?? [], [all.data]);
  const combos = useMemo(() => availableCombos(sessions), [sessions]);
  const selected = combos.find((c) => `${c.type}:${c.side}` === comboKey) ?? combos[0];
  const series = selected ? seriesFor(sessions, selected.type, selected.side) : [];
  const from = periodStart(period, tz);
  const inPeriod = from ? series.filter((p) => p.measuredAt >= from) : series;
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  const latest = history.items[0];

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:items-start">
      <div className="flex min-w-0 flex-col gap-5">
        <Card aria-labelledby="med-ultima">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="med-ultima" className="flex items-center gap-2 text-sm font-semibold">
              <Ruler aria-hidden className="size-4 text-brand-teal-ink" />
              Última sessão de medidas
            </h2>
            {latest && <span className="rounded-full bg-surface-muted px-3 py-1 text-xs font-semibold text-ink-muted">{describeInstant(latest.measuredAt, tz)}</span>}
          </div>
          {!history.loaded && history.loading ? (
            <LoadingState />
          ) : history.error && !history.loaded ? (
            <ErrorState error={history.error} onRetry={history.reload} />
          ) : latest ? (
            <SessionValues session={latest} />
          ) : (
            <div className="mt-3">
              <EmptyState title="Nenhuma medida registrada">Preencha apenas as medidas que fizer — uma já basta.</EmptyState>
            </div>
          )}
        </Card>

        <Card aria-labelledby="med-grafico">
          <div className="flex flex-col gap-4">
            <h2 id="med-grafico" className="font-display text-xl font-semibold">
              Evolução por medida
            </h2>
            {all.loading && !all.data ? (
              <LoadingState />
            ) : all.error ? (
              <ErrorState error={all.error} onRetry={all.reload} />
            ) : !selected ? (
              <p className="text-sm text-ink-muted">O gráfico aparece depois do primeiro registro.</p>
            ) : (
              <>
                <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
                  Medida e lado
                  <select
                    value={`${selected.type}:${selected.side}`}
                    onChange={(e) => setComboKey(e.target.value)}
                    className="min-h-12 rounded-field bg-surface-muted px-3 text-base font-normal"
                  >
                    {combos.map((c) => (
                      <option key={`${c.type}:${c.side}`} value={`${c.type}:${c.side}`}>
                        {measurementLabel(c.type as MeasurementType, c.side as Side)}
                      </option>
                    ))}
                  </select>
                </label>
                {last && (
                  <p className="rounded-[14px] bg-surface-muted px-3 py-2.5 text-sm">
                    <strong>{measurementLabel(selected.type, selected.side)}:</strong>{' '}
                    <span className="tabular">{formatDecimal(last.valueCm)} cm</span>{' '}
                    {prev ? (
                      <span className="tabular text-ink-muted">
                        ({formatDelta(subtractDecimal(last.valueCm, prev.valueCm))} cm em relação ao registro anterior desta medida, de{' '}
                        {formatShortDate(localDateOf(prev.measuredAt, tz))})
                      </span>
                    ) : (
                      <span className="text-ink-muted">(primeiro registro desta medida)</span>
                    )}
                  </p>
                )}
                <ChipGroup label="Período do gráfico" value={period} onChange={setPeriod} options={PERIODS.map((p) => ({ value: p, label: PERIOD_LABELS[p] }))} />
                <TimeLineChart
                  title={`Evolução — ${measurementLabel(selected.type, selected.side)}`}
                  points={inPeriod.map((p) => ({ t: Date.parse(p.measuredAt), label: formatDateTime(p.measuredAt, tz), value: Number(p.valueCm) }))}
                  series={[{ key: 'value', label: measurementLabel(selected.type, selected.side), color: '#069494', unit: 'cm' }]}
                  formatValue={(v) => `${formatDecimal(String(v))} cm`}
                  tickFormat={(t) => formatShortDate(localDateOf(t, tz))}
                  emptyText="Sem registros desta medida neste período."
                />
              </>
            )}
          </div>
        </Card>
      </div>

      <div className="flex min-w-0 flex-col gap-5">
        <Card aria-labelledby="med-nova">
          <div className="mb-4 flex items-start gap-3">
            <div className="flex size-10 items-center justify-center rounded-full bg-wash-peach text-brand-orange-ink">
              <NotebookPen aria-hidden className="size-5" />
            </div>
            <h2 id="med-nova" className="text-lg font-semibold">
              Nova sessão de medidas
            </h2>
          </div>
          <MeasurementForm onDone={(m) => setLastPersistence(m.persistence)} />
          <div className="mt-3">
            <PersistenceNote persistence={lastPersistence} what="Medidas registradas" />
          </div>
        </Card>

        <section aria-labelledby="med-historico" className="flex flex-col gap-3">
          <SectionTitle id="med-historico" accent="teal">
            Histórico
          </SectionTitle>
          {history.loaded && history.items.length === 0 && <p className="text-sm text-ink-muted">Suas sessões aparecerão aqui.</p>}
          <ul className="flex flex-col gap-2">
            {history.items.map((s) => (
              <li key={s.id} className="flex items-start gap-3 rounded-card bg-surface p-3 pl-4 shadow-card">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-ink-muted">{describeInstant(s.measuredAt, tz)}</p>
                  <p className="tabular mt-1 text-sm">
                    {s.values.map((v) => `${measurementLabel(v.type, v.side)} ${formatDecimal(v.valueCm)} cm`).join(' • ')}
                  </p>
                  {s.notes && <p className="mt-0.5 break-words text-xs italic text-ink-muted">“{s.notes}”</p>}
                </div>
                <RowActions label={`sessão de ${formatDateTime(s.measuredAt, tz)}`} onEdit={() => setEditing(s)} onDelete={() => del.ask(s)} />
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

      <Dialog open={!!editing} onClose={() => setEditing(null)} title="Editar medidas" size="lg">
        {editing && (
          <MeasurementForm
            key={editing.id}
            session={editing}
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
        title="Excluir esta sessão de medidas?"
        description={del.target ? describeInstant(del.target.measuredAt, tz) : undefined}
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

function SessionValues({ session }: { session: MeasurementSession }) {
  return (
    <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
      {session.values.map((v) => (
        <div key={`${v.type}-${v.side}`} className="rounded-[14px] bg-surface-muted px-3 py-2">
          <dt className="text-xs text-ink-muted">{measurementLabel(v.type, v.side)}</dt>
          <dd className="tabular text-lg font-semibold">
            {formatDecimal(v.valueCm)} <span className="text-xs text-ink-muted">cm</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}
