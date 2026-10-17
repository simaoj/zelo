'use client';
import { useCallback, useState } from 'react';
import { useEditingGuard } from '@/pwa';

/** Marks a form as being edited so the PWA never reloads for an update mid-edit. */
export function useDirtyGuard() {
  const [dirty, setDirty] = useState(false);
  useEditingGuard(dirty);
  const markDirty = useCallback(() => setDirty(true), []);
  const clear = useCallback(() => setDirty(false), []);
  return { dirty, markDirty, clear };
}
