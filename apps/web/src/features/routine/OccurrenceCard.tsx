'use client';
import { useState } from 'react';
import { Check, CircleDashed, Clock, Pencil, Pill, Undo2, X } from 'lucide-react';
import { ROUTINE_TYPE_LABELS, type Occurrence } from '@zelo/contracts';
import { localTimeOf } from '@/shared/lib/time';
import { Button } from '@/shared/ui/Button';
import { cx } from '@/shared/ui/cx';
import { effectiveState, formatDose, isDecided, occurrenceView } from './occurrenceLogic';
import { useOccurrenceActions } from './useOccurrenceActions';
import { IntakeEditDialog } from './IntakeEditDialog';

const TYPE_STYLE = {
  medication: { accent: 'bg-brand-pink', chip: 'bg-brand-pink/60 text-[#5c1a2a]', icon: 'bg-brand-pink/50 text-[#7b2f00]' },
  vitamin: { accent: 'bg-brand-yellow', chip: 'bg-brand-yellow/70 text-[#443b00]', icon: 'bg-brand-yellow/60 text-[#524700]' },
  supplement: { accent: 'bg-brand-teal', chip: 'bg-brand-teal-wash text-brand-teal-ink', icon: 'bg-brand-teal-wash text-brand-teal-ink' },
} as const;

export function StateBadge({ state }: { state: ReturnType<typeof effectiveState> }) {
  const v = occurrenceView(state);
  const Icon = { clock: Clock, 'circle-dashed': CircleDashed, check: Check, x: X }[v.icon];
  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold',
        v.tone === 'neutral' && 'bg-surface-muted text-ink-muted',
        v.tone === 'attention' && 'bg-wash-peach text-brand-orange-ink',
        v.tone === 'done' && 'bg-brand-teal-wash text-brand-teal-ink',
        v.tone === 'skipped' && 'bg-[#efeeea] text-ink',
      )}
    >
      <Icon aria-hidden className="size-3.5" />
      {v.label}
    </span>
  );
}

export function OccurrenceCard({ occurrence: o, tz, compact }: { occurrence: Occurrence; tz: string; compact?: boolean }) {
  const { markTaken, markNotTaken, undo, pending } = useOccurrenceActions();
  const [editing, setEditing] = useState(false);
  const state = effectiveState(o);
  const decided = isDecided(state);
  const style = TYPE_STYLE[o.itemType];
  const busy = !!pending[o.id];

  return (
    <article
      aria-label={`${o.localTime} — ${o.nameSnapshot}`}
      className={cx('relative overflow-hidden rounded-card bg-surface shadow-card', decided && 'opacity-95')}
    >
      <div aria-hidden className={cx('absolute inset-x-0 top-0 h-1.5', style.accent)} />
      <div className="flex items-start gap-3 p-4 pt-5">
        <div className={cx('flex size-11 shrink-0 items-center justify-center rounded-[14px]', style.icon)}>
          <Pill aria-hidden className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="tabular text-[13px] font-bold text-brand-orange-ink">{o.localTime}</span>
            <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-semibold', style.chip)}>{ROUTINE_TYPE_LABELS[o.itemType]}</span>
          </div>
          <h3 className="mt-0.5 break-words text-[17px] font-semibold text-ink">{o.nameSnapshot}</h3>
          <p className="text-sm text-ink-muted">Dose: {formatDose(o.doseSnapshot, o.unitSnapshot)}</p>
          {o.intake?.notes && <p className="mt-1 text-sm italic text-ink-muted">“{o.intake.notes}”</p>}
        </div>
        <StateBadge state={state} />
      </div>
      <div className={cx('flex flex-wrap items-center gap-2 border-t border-line/70 px-4 py-3', decided && 'bg-surface-muted/50')}>
        {decided ? (
          <>
            <p className="mr-auto flex items-center gap-1.5 text-sm font-semibold text-brand-teal-ink">
              {state === 'taken' ? (
                <>
                  <Check aria-hidden className="size-4" />
                  Tomado às {o.intake?.actualTakenAt ? localTimeOf(o.intake.actualTakenAt, tz) : '—'}
                </>
              ) : (
                <span className="text-ink">Marcado como não tomado</span>
              )}
            </p>
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)} icon={<Pencil aria-hidden className="size-4" />}>
              Editar
            </Button>
            <Button size="sm" variant="ghost" pending={busy} onClick={() => void undo(o)} icon={<Undo2 aria-hidden className="size-4" />}>
              Desfazer
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="primary"
              className={cx('flex-1', compact ? 'min-w-[10rem]' : 'min-w-[12rem]')}
              pending={busy}
              onClick={() => void markTaken(o)}
              icon={<Check aria-hidden className="size-5" />}
            >
              Marcar como tomado
            </Button>
            <Button size="md" variant="soft" disabled={busy} onClick={() => void markNotTaken(o)} icon={<X aria-hidden className="size-4" />}>
              Não tomado
            </Button>
            <Button size="md" variant="ghost" disabled={busy} onClick={() => setEditing(true)} icon={<Clock aria-hidden className="size-4" />}>
              Outro horário
            </Button>
          </>
        )}
      </div>
      {editing && <IntakeEditDialog occurrence={o} tz={tz} onClose={() => setEditing(false)} />}
    </article>
  );
}
