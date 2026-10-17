'use client';
import { useCallback, useRef, useState } from 'react';
import { describeError, serverAnswered, type DescribedError } from './errors';
import { useOptionalSession } from './session';

/**
 * Wraps a submit action: blocks duplicate submissions, exposes pending/error state,
 * and redirects to /entrar on session expiry. `onServerError` lets the caller rotate
 * its operationId when the server answered (payload may change before retry).
 */
export function useSubmit() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<DescribedError | null>(null);
  const inFlight = useRef(false);
  const session = useOptionalSession();

  const run = useCallback(
    async <T,>(action: () => Promise<T>, opts: { onServerError?: () => void } = {}): Promise<T | undefined> => {
      if (inFlight.current) return undefined;
      inFlight.current = true;
      setPending(true);
      setError(null);
      try {
        return await action();
      } catch (e) {
        const d = describeError(e);
        if (serverAnswered(e)) opts.onServerError?.();
        if (d.kind === 'expired') session?.expire();
        setError(d);
        return undefined;
      } finally {
        inFlight.current = false;
        setPending(false);
      }
    },
    [session],
  );

  return { pending, error, setError, run };
}
