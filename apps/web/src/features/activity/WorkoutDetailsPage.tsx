'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { useResource } from '@/shared/data/hooks';
import { useTimeZone } from '@/shared/data/session';
import { formatFullDate, formatLongDate, formatShortDate, localDateOf, localTimeOf } from '@/shared/lib/time';
import { formatActiveKcal, formatDistance, formatDuration, modalityLabel } from '@/shared/lib/format';
import { Card, Eyebrow } from '@/shared/ui/Card';
import { ErrorState, SkeletonCard } from '@/shared/ui/States';
import { CachedDataNote } from './ActivityBits';
import { PROVIDER_LABEL } from './activityLogic';

export function WorkoutDetailsPage() {
  const tz = useTimeZone();
  const id = useSearchParams().get('id');
  const res = useResource(id ? `workout:${id}` : null, (ds) => ds.getWorkout(id!));
  const w = res.data;
  return (
    <div className="flex flex-col gap-4">
      <Link href="/atividade/exercicios" className="-ml-2 inline-flex min-h-11 items-center gap-1 self-start rounded-[12px] px-2 text-sm font-semibold text-brand-teal-ink hover:bg-brand-teal-wash">
        <ChevronLeft aria-hidden className="size-4" />
        Exercícios
      </Link>
      <CachedDataNote tz={tz} />
      {!id ? (
        <p className="text-sm text-ink-muted">Exercício não encontrado.</p>
      ) : res.loading && !w ? (
        <SkeletonCard lines={6} />
      ) : res.error && !w ? (
        <ErrorState error={res.error} onRetry={res.reload} />
      ) : w ? (
        <Card aria-labelledby="ex-titulo">
          <Eyebrow>{formatLongDate(localDateOf(w.startedAt, tz))}</Eyebrow>
          <h1 id="ex-titulo" className="font-display text-[28px] font-semibold leading-tight">
            {modalityLabel(w.name)}
          </h1>
          {modalityLabel(w.name) !== w.name && <p className="text-sm text-ink-muted">Nome exportado: {w.name}</p>}
          <dl className="mt-4 grid grid-cols-1 gap-2 min-[400px]:grid-cols-2">
            <Item label="Início" value={localTimeOf(w.startedAt, tz)} />
            <Item label="Fim" value={localDateOf(w.endedAt, tz) === localDateOf(w.startedAt, tz) ? localTimeOf(w.endedAt, tz) : `${formatShortDate(localDateOf(w.endedAt, tz))} às ${localTimeOf(w.endedAt, tz)}`} />
            <Item label="Duração" value={formatDuration(w.durationSeconds)} />
            <Item label="Distância" value={w.distanceMeters != null ? formatDistance(w.distanceMeters) : 'Não informada'} muted={w.distanceMeters == null} />
            <Item label="Energia ativa" value={w.activeEnergyKcal != null ? formatActiveKcal(w.activeEnergyKcal) : 'Não informada'} muted={w.activeEnergyKcal == null} />
          </dl>
          <div className="mt-4 flex flex-col gap-1 border-t border-line pt-3 text-sm text-ink-muted">
            <p>Origem: {PROVIDER_LABEL[w.provider] ?? w.provider}</p>
            <p>
              Recebido em {formatFullDate(localDateOf(w.receivedAt, tz))} às {localTimeOf(w.receivedAt, tz)}
            </p>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function Item({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="rounded-[14px] bg-surface-muted px-3 py-2">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className={muted ? 'text-sm text-ink-muted' : 'tabular text-lg font-semibold'}>{value}</dd>
    </div>
  );
}
