import Link from 'next/link';
import { ChevronRight, Dumbbell } from 'lucide-react';
import type { Workout } from '@zelo/contracts';
import { localTimeOf } from '@/shared/lib/time';
import { formatActiveKcal, formatDistance, formatDuration, modalityLabel } from '@/shared/lib/format';

export function WorkoutCard({ workout: w, tz }: { workout: Workout; tz: string }) {
  const name = modalityLabel(w.name);
  return (
    <Link
      href={`/atividade/exercicios/detalhe?id=${encodeURIComponent(w.id)}`}
      className="flex items-center gap-3 rounded-card bg-surface p-3 pl-4 shadow-card hover:bg-wash-peach"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-wash-sun text-[#6c5e00]">
        <Dumbbell aria-hidden className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{name}</p>
        <p className="tabular text-xs text-ink-muted">
          Início às {localTimeOf(w.startedAt, tz)} • {formatDuration(w.durationSeconds)}
        </p>
        {(w.distanceMeters != null || w.activeEnergyKcal != null) && (
          <p className="tabular mt-1 flex flex-wrap gap-1.5 text-xs">
            {w.distanceMeters != null && <span className="rounded-full bg-surface-muted px-2 py-0.5">{formatDistance(w.distanceMeters)}</span>}
            {w.activeEnergyKcal != null && <span className="rounded-full bg-surface-muted px-2 py-0.5">{formatActiveKcal(w.activeEnergyKcal)}</span>}
          </p>
        )}
      </div>
      <ChevronRight aria-hidden className="size-5 shrink-0 text-ink-muted" />
      <span className="sr-only">Ver detalhes</span>
    </Link>
  );
}
