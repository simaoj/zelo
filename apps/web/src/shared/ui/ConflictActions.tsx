'use client';
import { RefreshCw } from 'lucide-react';

export function ConflictActions({ onReload }: { onReload?: () => void }) {
  if (!onReload) return null;
  return (
    <button type="button" onClick={onReload} className="mt-2 inline-flex min-h-11 items-center gap-2 font-semibold underline">
      <RefreshCw aria-hidden className="size-4" />
      Recarregar dados
    </button>
  );
}
