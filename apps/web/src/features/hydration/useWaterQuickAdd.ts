'use client';
import { useCallback, useRef, useState } from 'react';
import type { WaterEntry } from '@zelo/contracts';
import type { Mutation } from '@/shared/data/ports';
import { useZelo } from '@/shared/data/ZeloProvider';
import { useOptionalSession } from '@/shared/data/session';
import { describeError, serverAnswered } from '@/shared/data/errors';
import { uuid } from '@/shared/lib/ids';
import { formatMl } from '@/shared/lib/format';
import { useToast } from '@/shared/ui/Toast';

interface QuickIntent {
  amount: number;
  id: string;
  operationId: string;
  consumedAt: string;
  createdAt: number;
}

/** A pending intent is retried as-is (same ids → idempotent) only if it is recent. */
const INTENT_TTL_MS = 60_000;

/**
 * Quick water buttons: save immediately (now, profile tz) and offer "Desfazer".
 * - one request at a time (double clicks are ignored while saving);
 * - a failed attempt keeps its id/operationId so a retry of the same amount cannot duplicate;
 * - undo deletes exactly the created entry with its version (works for local/offline entries too).
 */
export function useWaterQuickAdd(timezone: string) {
  const { data } = useZelo();
  const toast = useToast();
  const session = useOptionalSession();
  const inFlight = useRef(false);
  const intent = useRef<QuickIntent | null>(null);
  const [pendingAmount, setPendingAmount] = useState<number | null>(null);
  const [lastPersistence, setLastPersistence] = useState<'server' | 'local' | null>(null);

  const undo = useCallback(
    async (m: Mutation<WaterEntry>) => {
      try {
        const r = await data.deleteWaterEntry(m.value.id, { operationId: uuid(), expectedVersion: m.value.version });
        toast({ message: r.persistence === 'local' ? 'Registro desfeito neste dispositivo' : 'Registro desfeito' });
      } catch (e) {
        toast({ message: describeError(e).message });
      }
    },
    [data, toast],
  );

  const add = useCallback(
    async (amount: number): Promise<Mutation<WaterEntry> | undefined> => {
      if (inFlight.current) return undefined;
      inFlight.current = true;
      setPendingAmount(amount);
      const now = Date.now();
      const prev = intent.current;
      if (!prev || prev.amount !== amount || now - prev.createdAt > INTENT_TTL_MS) {
        intent.current = { amount, id: uuid(), operationId: uuid(), consumedAt: new Date(now).toISOString(), createdAt: now };
      }
      const i = intent.current!;
      try {
        const m = await data.createWaterEntry({ id: i.id, operationId: i.operationId, consumedAt: i.consumedAt, timezone, amountMl: amount });
        intent.current = null;
        setLastPersistence(m.persistence);
        toast({
          message: m.persistence === 'local' ? `+${formatMl(amount)} salvo neste dispositivo` : `+${formatMl(amount)} registrado`,
          action: { label: 'Desfazer', onClick: () => undo(m) },
        });
        return m;
      } catch (e) {
        const d = describeError(e);
        if (serverAnswered(e)) intent.current = null;
        if (d.kind === 'expired') session?.expire();
        toast({ message: d.kind === 'offline' ? 'Sem conexão: a água não foi registrada. Tente novamente.' : d.message });
        return undefined;
      } finally {
        inFlight.current = false;
        setPendingAmount(null);
      }
    },
    [data, timezone, toast, undo, session],
  );

  return { add, pendingAmount, lastPersistence };
}
