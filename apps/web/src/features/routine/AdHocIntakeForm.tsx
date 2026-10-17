'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Check } from 'lucide-react';
import type { IntakeRecord } from '@zelo/contracts';
import type { Mutation } from '@/shared/data/ports';
import { useZelo } from '@/shared/data/ZeloProvider';
import { useTimeZone } from '@/shared/data/session';
import { useResource } from '@/shared/data/hooks';
import { useIntent } from '@/shared/data/intent';
import { useSubmit } from '@/shared/data/useSubmit';
import { Button } from '@/shared/ui/Button';
import { FormError, SelectField, TextAreaField } from '@/shared/ui/Field';
import { DateTimeFields, nowInTz, resolveInstant } from '@/shared/ui/DateTimeFields';
import { ErrorState, LoadingState } from '@/shared/ui/States';
import { formatDose } from './occurrenceLogic';

/** Ad-hoc intake: requires a registered item; does not confirm any occurrence. */
export function AdHocIntakeForm({ onDone, defaultItemId }: { onDone: (m: Mutation<IntakeRecord>) => void; defaultItemId?: string }) {
  const tz = useTimeZone();
  const { data } = useZelo();
  const items = useResource('routine-items:active', (ds) => ds.listRoutineItems(false));
  const intent = useIntent();
  const { pending, error, run } = useSubmit();
  const [itemId, setItemId] = useState(defaultItemId ?? '');
  const [when, setWhen] = useState(() => nowInTz(tz));
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<{ item?: string; when?: string }>({});

  if (items.loading && !items.data) return <LoadingState />;
  if (items.error) return <ErrorState error={items.error} onRetry={items.reload} />;
  const active = (items.data ?? []).filter((i) => !i.archivedAt);
  if (active.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        Cadastre um item em{' '}
        <Link className="font-semibold text-brand-teal-ink underline" href="/rotina?aba=itens">
          Rotina › Meus itens
        </Link>{' '}
        para registrar uma tomada avulsa.
      </p>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = resolveInstant(when, tz);
    const next = { item: itemId ? undefined : 'Escolha o item', when: t.ok ? undefined : t.error };
    setErrors(next);
    if (!itemId || !t.ok) return;
    const i = intent.current();
    const trimmed = notes.trim();
    const r = await run(
      () => data.createIntake({ id: i.id, operationId: i.operationId, itemId, actualTakenAt: t.iso, ...(trimmed ? { notes: trimmed } : {}) }),
      { onServerError: () => intent.rotateOperation() },
    );
    if (r) {
      intent.reset();
      setNotes('');
      setWhen(nowInTz(tz));
      onDone(r);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <SelectField label="Item" required value={itemId} onChange={(e) => setItemId(e.target.value)} error={errors.item}>
        <option value="">Selecione…</option>
        {active.map((it) => (
          <option key={it.id} value={it.id}>
            {it.name} — {formatDose(it.currentDose, it.currentUnit)}
          </option>
        ))}
      </SelectField>
      <DateTimeFields value={when} onChange={setWhen} tz={tz} error={errors.when} timeLabel="Horário em que tomou" />
      <TextAreaField label="Observação" optional maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
      <p className="text-xs text-ink-muted">A tomada avulsa fica no histórico do item e não marca nenhum horário programado como tomado.</p>
      {error && <FormError>{error.message}</FormError>}
      <Button type="submit" variant="primary" size="lg" pending={pending} icon={<Check aria-hidden className="size-5" />}>
        Registrar tomada avulsa
      </Button>
    </form>
  );
}
