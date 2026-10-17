'use client';
import { useState } from 'react';
import type { Mutation } from './ports';
import { describeError } from './errors';
import { useOptionalSession } from './session';
import { useToast } from '@/shared/ui/Toast';

/**
 * Confirm → delete → toast with "Desfazer" (re-creates the record with a new id when possible).
 */
export function useDeleteFlow<T extends { id: string }>(opts: {
  remove: (item: T) => Promise<Mutation<null>>;
  restore?: (item: T) => Promise<unknown>;
  what: string;
}) {
  const [target, setTarget] = useState<T | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const session = useOptionalSession();

  const confirm = async () => {
    if (!target || pending) return;
    setPending(true);
    setError(null);
    try {
      const r = await opts.remove(target);
      const item = target;
      setTarget(null);
      toast({
        message: r.persistence === 'local' ? `${opts.what} excluído neste dispositivo` : `${opts.what} excluído`,
        action: opts.restore
          ? {
              label: 'Desfazer',
              onClick: async () => {
                try {
                  await opts.restore!(item);
                  toast({ message: `${opts.what} restaurado` });
                } catch (e) {
                  toast({ message: describeError(e).message });
                }
              },
            }
          : undefined,
      });
    } catch (e) {
      const d = describeError(e);
      if (d.kind === 'expired') session?.expire();
      setError(d.message);
    } finally {
      setPending(false);
    }
  };

  return {
    target,
    ask: (item: T) => {
      setError(null);
      setTarget(item);
    },
    cancel: () => setTarget(null),
    confirm,
    pending,
    error,
  };
}
