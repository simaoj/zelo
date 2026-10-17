'use client';
import { useCallback, useRef } from 'react';
import { uuid } from '@/shared/lib/ids';

export interface Intent {
  /** client-generated entity id (create) */
  id: string;
  /** idempotency key for this user intent */
  operationId: string;
}

/**
 * Generates `id`/`operationId` ONCE per user intent so retries and double clicks are
 * idempotent. After the server rejects a payload (validation/confirmation), call
 * `rotateOperation()` before sending a changed payload; call `reset()` after success.
 * Read with `current()` inside event handlers.
 */
export function useIntent() {
  const ref = useRef<Intent | null>(null);
  const current = useCallback((): Intent => {
    if (!ref.current) ref.current = { id: uuid(), operationId: uuid() };
    return ref.current;
  }, []);
  const rotateOperation = useCallback((): Intent => {
    ref.current = { ...current(), operationId: uuid() };
    return ref.current;
  }, [current]);
  const reset = useCallback(() => {
    ref.current = { id: uuid(), operationId: uuid() };
  }, []);
  return { current, rotateOperation, reset };
}
