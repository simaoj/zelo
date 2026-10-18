'use client';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Archive, CalendarDays, Check, ChevronLeft, ChevronRight, CircleDashed, Clock, Heart, Pencil, Pill, Plus, X } from 'lucide-react';
import { ROUTINE_TYPE_LABELS, type Occurrence, type RoutineItem, type RoutineType } from '@zelo/contracts';
import { useZelo } from '@/shared/data/ZeloProvider';
import { useTimeZone } from '@/shared/data/session';
import { useResource } from '@/shared/data/hooks';
import { describeError } from '@/shared/data/errors';
import { uuid } from '@/shared/lib/ids';
import { addDays, formatFullDate, formatLongDate, localDateOf, todayIn } from '@/shared/lib/time';
import { Button } from '@/shared/ui/Button';
import { Card, PageHeader, SectionTitle } from '@/shared/ui/Card';
import { ConfirmDialog, Dialog } from '@/shared/ui/Dialog';
import { EmptyState, ErrorState, LoadingState } from '@/shared/ui/States';
import { ChipGroup, TabPanel, Tabs } from '@/shared/ui/Tabs';
import { useToast } from '@/shared/ui/Toast';
import { cx } from '@/shared/ui/cx';
import { OccurrenceCard } from './OccurrenceCard';
import { AdHocIntakeForm } from './AdHocIntakeForm';
import { ItemForm } from './ItemForm';
import { IntakeHistory } from './IntakeHistory';
import { describeSchedule } from './itemLogic';
import { effectiveState, formatDose, isDecided } from './occurrenceLogic';

type Tab = 'hoje' | 'itens';

export function RoutinePage() {
  const params = useSearchParams();
  const router = useRouter();
  const tab: Tab = params.get('aba') === 'itens' ? 'itens' : 'hoje';
  const setTab = (t: Tab) => router.replace(t === 'hoje' ? '/rotina' : '/rotina?aba=itens', { scroll: false });
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="Acompanhamento diário" title="Minha rotina de cuidado" />
      <div className="max-w-md">
        <Tabs
          idPrefix="rotina"
          label="Seções da rotina"
          value={tab}
          onChange={setTab}
          items={[
            { value: 'hoje', label: 'Hoje', icon: <CalendarDays aria-hidden className="size-4" /> },
            { value: 'itens', label: 'Meus itens', icon: <Archive aria-hidden className="size-4" /> },
          ]}
        />
      </div>
      <TabPanel idPrefix="rotina" value={tab}>
        {tab === 'hoje' ? (
          <DayTab
            onNewItem={() => {
              setTab('itens');
              setCreating(true);
            }}
          />
        ) : (
          <ItemsTab creating={creating} setCreating={setCreating} />
        )}
      </TabPanel>
      <IntakeHistory />
    </div>
  );
}

type TypeFilter = 'all' | RoutineType;

function DayTab({ onNewItem }: { onNewItem: () => void }) {
  const tz = useTimeZone();
  const today = todayIn(tz);
  const [date, setDate] = useState(today);
  const [filter, setFilter] = useState<TypeFilter>('all');
  const [adHoc, setAdHoc] = useState(false);
  const toast = useToast();
  const occ = useResource(`occurrences:${date}`, (ds) => ds.listOccurrences(date));
  const items = (occ.data?.items ?? []).filter((o) => filter === 'all' || o.itemType === filter);
  const all = occ.data?.items ?? [];
  const decided = all.filter((o) => isDecided(effectiveState(o))).length;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)] lg:items-start">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => setDate(addDays(date, -1))} icon={<ChevronLeft aria-hidden className="size-4" />}>
            <span className="sr-only">Dia anterior</span>
          </Button>
          <label className="flex min-w-0 flex-1 flex-col text-xs font-semibold text-ink-muted sm:flex-none">
            <span className="sr-only">Data</span>
            <input
              type="date"
              value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              className="tabular min-h-11 rounded-field bg-surface px-3 text-base text-ink shadow-card"
            />
          </label>
          <Button variant="secondary" onClick={() => setDate(addDays(date, 1))} icon={<ChevronRight aria-hidden className="size-4" />}>
            <span className="sr-only">Próximo dia</span>
          </Button>
          {date !== today && (
            <Button variant="ghost" onClick={() => setDate(today)}>
              Voltar para hoje
            </Button>
          )}
        </div>
        <ChipGroup<TypeFilter>
          label="Filtrar por tipo"
          tone="orange"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'Todos' },
            { value: 'medication', label: 'Medicamentos' },
            { value: 'vitamin', label: 'Vitaminas' },
            { value: 'supplement', label: 'Suplementos' },
          ]}
        />
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-xl font-semibold">{date === today ? 'Horários de hoje' : 'Horários do dia'}</h2>
          <p className="text-sm text-ink-muted">
            {formatLongDate(date)}
            {all.length > 0 && (
              <span className="tabular">
                {' '}
                • {decided} de {all.length} registrados
              </span>
            )}
          </p>
        </div>
        {occ.loading && !occ.data ? (
          <LoadingState />
        ) : occ.error ? (
          <ErrorState error={occ.error} onRetry={occ.reload} />
        ) : items.length === 0 ? (
          <EmptyState icon={<Pill aria-hidden className="size-5" />} title={all.length === 0 ? 'Nada programado para este dia' : 'Nenhum item deste tipo neste dia'}>
            {all.length === 0 ? 'Cadastre itens com horários fixos em “Meus itens”.' : 'Escolha outro filtro para ver os demais horários.'}
          </EmptyState>
        ) : (
          <ol className="relative flex flex-col gap-4 before:absolute before:bottom-6 before:left-[21px] before:top-6 before:w-0.5 before:bg-line">
            {items.map((o) => (
              <TimelineItem key={o.id} o={o} tz={tz} />
            ))}
          </ol>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <Button variant="secondary" size="lg" onClick={() => setAdHoc(true)} icon={<Plus aria-hidden className="size-5" />}>
          Registrar tomada avulsa
        </Button>
        <Button variant="soft" size="lg" onClick={onNewItem} icon={<Plus aria-hidden className="size-5" />}>
          Adicionar novo item na rotina
        </Button>
        <div className="flex items-start gap-3 rounded-card bg-wash-sun p-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-yellow text-[#443b00]">
            <Heart aria-hidden className="size-5" />
          </div>
          <div>
            <p className="font-semibold">Cuidado compartilhado</p>
            <p className="text-sm text-ink">
              O Zelo ajuda a organizar os horários e doses que você e seu profissional de saúde estabeleceram. Não substitui orientações médicas.
            </p>
          </div>
        </div>
      </div>
      <Dialog open={adHoc} onClose={() => setAdHoc(false)} title="Tomada avulsa" description="Para um item já cadastrado, fora dos horários programados.">
        <AdHocIntakeForm
          onDone={(m) => {
            toast({ message: m.persistence === 'local' ? 'Tomada salva neste dispositivo' : 'Tomada avulsa registrada' });
            setAdHoc(false);
          }}
        />
      </Dialog>
    </div>
  );
}

function TimelineItem({ o, tz }: { o: Occurrence; tz: string }) {
  const state = effectiveState(o);
  const Icon = state === 'taken' ? Check : state === 'not_taken' ? X : state === 'unrecorded' ? CircleDashed : Clock;
  return (
    <li className="relative grid grid-cols-[44px_minmax(0,1fr)] gap-3">
      <div
        aria-hidden
        className={cx(
          'z-10 mt-4 flex size-11 items-center justify-center rounded-full ring-4 ring-background',
          state === 'taken' && 'bg-brand-teal-ink text-white',
          state === 'not_taken' && 'bg-[#e4e2de] text-ink',
          state === 'unrecorded' && 'bg-brand-orange text-ink',
          state === 'scheduled' && 'bg-surface-muted text-ink-muted',
        )}
      >
        <Icon className="size-5" />
      </div>
      <OccurrenceCard occurrence={o} tz={tz} />
    </li>
  );
}

function ItemsTab({ creating, setCreating }: { creating: boolean; setCreating: (v: boolean) => void }) {
  const tz = useTimeZone();
  const { data } = useZelo();
  const toast = useToast();
  const items = useResource('routine-items:all', (ds) => ds.listRoutineItems(true));
  const [editing, setEditing] = useState<RoutineItem | null>(null);
  const [archiving, setArchiving] = useState<RoutineItem | null>(null);
  const [archivePending, setArchivePending] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const active = (items.data ?? []).filter((i) => !i.archivedAt);
  const archived = (items.data ?? []).filter((i) => i.archivedAt);

  const archive = async () => {
    if (!archiving || archivePending) return;
    setArchivePending(true);
    setArchiveError(null);
    try {
      await data.archiveRoutineItem(archiving.id, { operationId: uuid(), expectedVersion: archiving.version });
      toast({ message: `${archiving.name} arquivado. O histórico foi preservado.` });
      setArchiving(null);
    } catch (e) {
      setArchiveError(describeError(e).message);
    } finally {
      setArchivePending(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionTitle accent="orange">Itens ativos</SectionTitle>
        <Button variant="primary" onClick={() => setCreating(true)} icon={<Plus aria-hidden className="size-4" />}>
          Novo item
        </Button>
      </div>
      {items.loading && !items.data ? (
        <LoadingState />
      ) : items.error ? (
        <ErrorState error={items.error} onRetry={items.reload} />
      ) : active.length === 0 ? (
        <EmptyState icon={<Pill aria-hidden className="size-5" />} title="Nenhum item na rotina">
          Adicione medicamentos, vitaminas ou suplementos com dose e horários.
        </EmptyState>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {active.map((it) => (
            <li key={it.id}>
              <Card className="h-full">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-semibold text-ink-muted">{ROUTINE_TYPE_LABELS[it.type]}</span>
                    <h3 className="mt-1 break-words text-lg font-semibold">{it.name}</h3>
                    <p className="text-sm text-ink-muted">Dose: {formatDose(it.currentDose, it.currentUnit)}</p>
                  </div>
                </div>
                <p className="mt-2 flex items-center gap-1.5 text-sm">
                  <Clock aria-hidden className="size-4 text-brand-teal-ink" />
                  {describeSchedule(it.currentSchedule)}
                </p>
                {it.currentSchedule && (
                  <p className="mt-1 text-xs text-ink-muted">
                    Desde {formatFullDate(it.currentSchedule.startDate)}
                    {it.currentSchedule.endDate ? ` até ${formatFullDate(it.currentSchedule.endDate)}` : ''} • {it.currentSchedule.timezone} • Lembrete{' '}
                    {it.currentSchedule.reminderEnabled ? 'ativado' : 'desativado'}
                  </p>
                )}
                {it.instructions && <p className="mt-2 break-words text-sm italic text-ink-muted">“{it.instructions}”</p>}
                <div className="mt-3 flex flex-wrap gap-2 border-t border-line/70 pt-3">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(it)} icon={<Pencil aria-hidden className="size-4" />}>
                    Editar
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setArchiving(it)} icon={<Archive aria-hidden className="size-4" />}>
                    Arquivar
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {archived.length > 0 && (
        <section aria-labelledby="arquivados" className="flex flex-col gap-3">
          <SectionTitle id="arquivados" accent="teal">
            Arquivados
          </SectionTitle>
          <ul className="flex flex-col gap-2">
            {archived.map((it) => (
              <li key={it.id} className="flex flex-wrap items-center justify-between gap-2 rounded-card bg-surface-muted/70 p-4">
                <div>
                  <p className="font-semibold">{it.name}</p>
                  <p className="text-xs text-ink-muted">
                    {ROUTINE_TYPE_LABELS[it.type]} • {formatDose(it.currentDose, it.currentUnit)} • arquivado em {formatFullDate(localDateOf(it.archivedAt!, tz))}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Dialog open={creating} onClose={() => setCreating(false)} title="Novo item" size="lg">
        <ItemForm
          onDone={(i) => {
            toast({ message: `${i.name} adicionado à rotina` });
            setCreating(false);
          }}
          onCancel={() => setCreating(false)}
        />
      </Dialog>
      <Dialog open={!!editing} onClose={() => setEditing(null)} title="Editar item" size="lg">
        {editing && (
          <ItemForm
            key={editing.id}
            item={editing}
            onDone={(i) => {
              toast({ message: `${i.name} atualizado` });
              setEditing(null);
            }}
            onCancel={() => setEditing(null)}
            onConflict={() => {
              setEditing(null);
              items.reload();
            }}
          />
        )}
      </Dialog>
      <ConfirmDialog
        open={!!archiving}
        title={`Arquivar ${archiving?.name ?? ''}?`}
        description="Os horários futuros deixam de ser gerados. O histórico de tomadas é preservado."
        confirmLabel="Arquivar"
        pending={archivePending}
        error={archiveError}
        onConfirm={() => void archive()}
        onClose={() => setArchiving(null)}
      />
    </div>
  );
}
