'use client';
import { useCallback, useState } from 'react';
import type { Occurrence } from '@zelo/contracts';
import { useZelo } from '@/shared/data/ZeloProvider';
import { useOptionalSession } from '@/shared/data/session';
import { describeError } from '@/shared/data/errors';
import { uuid } from '@/shared/lib/ids';
import { useToast } from '@/shared/ui/Toast';
import type { Mutation } from '@/shared/data/ports';

/** Intake decisions for occurrences. One operationId per click; pending blocks double submission. */
export function useOccurrenceActions() {
  const { data } = useZelo();
  const toast = useToast();
  const session = useOptionalSession();
  const [pending, setPending] = useState<Record<string, boolean>>({});

  const wrap = useCallback(
    async (o: Occurrence, fn: () => Promise<Mutation<unknown>>, success: string) => {
      if (pending[o.id]) return false;
      setPending((p) => ({ ...p, [o.id]: true }));
      try {
        const r = await fn();
        toast({ message: r.persistence === 'local' ? `${success} — salvo neste dispositivo` : success });
        return true;
      } catch (e) {
        const d = describeError(e);
        if (d.kind === 'expired') session?.expire();
        toast({ message: d.message });
        return false;
      } finally {
        setPending((p) => {
          const n = { ...p };
          delete n[o.id];
          return n;
        });
      }
    },
    [pending, toast, session],
  );

  const markTaken = useCallback(
    (o: Occurrence, actualTakenAt: string = new Date().toISOString(), notes?: string | null) =>
      wrap(
        o,
        () =>
          data.putOccurrenceIntake(o.id, {
            operationId: uuid(),
            intakeId: o.intake?.id ?? uuid(),
            status: 'taken',
            actualTakenAt,
            ...(notes !== undefined ? { notes } : {}),
            ...(o.intake ? { expectedVersion: o.intake.version } : {}),
          }),
        `${o.nameSnapshot}: marcado como tomado`,
      ),
    [data, wrap],
  );

  const markNotTaken = useCallback(
    (o: Occurrence, notes?: string | null) =>
      wrap(
        o,
        () =>
          data.putOccurrenceIntake(o.id, {
            operationId: uuid(),
            intakeId: o.intake?.id ?? uuid(),
            status: 'not_taken',
            actualTakenAt: null,
            ...(notes !== undefined ? { notes } : {}),
            ...(o.intake ? { expectedVersion: o.intake.version } : {}),
          }),
        `${o.nameSnapshot}: marcado como não tomado`,
      ),
    [data, wrap],
  );

  const undo = useCallback(
    (o: Occurrence) =>
      o.intake
        ? wrap(o, () => data.undoOccurrenceIntake(o.id, { operationId: uuid(), expectedVersion: o.intake!.version }), 'Registro desfeito')
        : Promise.resolve(false),
    [data, wrap],
  );

  return { markTaken, markNotTaken, undo, pending };
}
