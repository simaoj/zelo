'use client';
/**
 * pwaGuards — tells the PWA layer when it is NOT safe to reload the page for an update.
 *
 * Usage in forms (web-ui):
 *   useEditingGuard(isDirty)                       // hook, preferred
 *   pwaGuards.markEditing('weight-form') / pwaGuards.clearEditing('weight-form')
 *   or add the attribute data-zelo-editing="true" to a dirty <form>.
 *
 * The UpdateBanner refuses to apply "Nova versão disponível" while anything is editing or a
 * sync is running; it applies as soon as the user confirms again once idle.
 */
import { useEffect, useId } from 'react';

const editing = new Set<string>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const pwaGuards = {
  markEditing(key: string) {
    if (!editing.has(key)) {
      editing.add(key);
      emit();
    }
  },
  clearEditing(key: string) {
    if (editing.delete(key)) emit();
  },
  isEditing(): boolean {
    if (editing.size > 0) return true;
    if (typeof document === 'undefined') return false;
    return document.querySelector('[data-zelo-editing="true"]') !== null;
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
};

export function useEditingGuard(active: boolean, key?: string) {
  const auto = useId();
  const k = key ?? auto;
  useEffect(() => {
    if (!active) return;
    pwaGuards.markEditing(k);
    return () => pwaGuards.clearEditing(k);
  }, [active, k]);
}
