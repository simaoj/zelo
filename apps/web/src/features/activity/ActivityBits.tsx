'use client';
import { CloudOff, Footprints, RefreshCw } from 'lucide-react';
import { useSyncStatus } from '@/shared/data/hooks';
import { formatReceivedAt } from '@/shared/lib/format';
import { ACTIVITY_EMPTY_TEXT, ACTIVITY_EMPTY_TITLE, receivedLine } from './activityLogic';

export function ActivityEmpty() {
  return (
    <div className="flex flex-col items-start gap-2 rounded-card border border-dashed border-line bg-surface/60 p-5">
      <div className="flex size-11 items-center justify-center rounded-[14px] bg-wash-sun text-[#6c5e00]">
        <Footprints aria-hidden className="size-5" />
      </div>
      <p className="font-semibold text-ink">{ACTIVITY_EMPTY_TITLE}</p>
      <p className="text-sm text-ink-muted">{ACTIVITY_EMPTY_TEXT}</p>
    </div>
  );
}

/** "Dados recebidos em … • Parcial do dia" */
export function ReceivedLine({ lastReceivedAt, tz, partial }: { lastReceivedAt: string | null; tz: string; partial?: boolean }) {
  if (!lastReceivedAt) return null;
  return (
    <p className="flex items-center gap-1.5 text-xs text-ink-muted">
      <RefreshCw aria-hidden className="size-3.5 shrink-0" />
      <span>
        {receivedLine(lastReceivedAt, tz)}
        {partial && ' • Parcial do dia'}
      </span>
    </p>
  );
}

/** When offline with local data, tells the user these are stored values and from when. */
export function CachedDataNote({ tz }: { tz: string }) {
  const status = useSyncStatus();
  if (status.online || !status.offlineEnabled) return null;
  return (
    <p role="status" className="flex items-start gap-2 rounded-field bg-wash-sun px-3 py-2 text-sm text-[#524700]">
      <CloudOff aria-hidden className="mt-0.5 size-4 shrink-0" />
      {status.lastSyncedAt
        ? `Sem conexão: mostrando dados salvos neste dispositivo, atualizados ${formatReceivedAt(status.lastSyncedAt, tz).replace(/^(\d)/, 'em $1')}.`
        : 'Sem conexão: mostrando dados salvos neste dispositivo.'}
    </p>
  );
}
