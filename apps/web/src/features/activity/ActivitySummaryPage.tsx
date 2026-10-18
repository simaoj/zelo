'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Footprints, SlidersHorizontal, Timer } from 'lucide-react';
import { useResource } from '@/shared/data/hooks';
import { useTimeZone } from '@/shared/data/session';
import { todayIn } from '@/shared/lib/time';
import { formatDuration, formatInt, formatSteps, percentOf } from '@/shared/lib/format';
import { Card, PageHeader, SectionTitle } from '@/shared/ui/Card';
import { ProgressBar } from '@/shared/ui/ProgressRing';
import { ErrorState, SkeletonCard } from '@/shared/ui/States';
import { ActivityEmpty, CachedDataNote, ReceivedLine } from './ActivityBits';
import { StepsGoalDialog } from './StepsGoal';
import { WorkoutCard } from './WorkoutCard';
import { stepsDayStatus } from './activityLogic';

export function ActivitySummaryPage() {
  const tz = useTimeZone();
  const today = todayIn(tz);
  const act = useResource(`activity-today:${today}:${tz}`, (ds) => ds.getActivityToday(today));
  const recent = useResource(`workouts-recent:${tz}`, (ds) => ds.listWorkouts({ limit: 3 }));
  const [goalOpen, setGoalOpen] = useState(false);
  const a = act.data;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="Movimento" title="Atividade" description="Passos e exercícios recebidos do Auto Export. Somente leitura." />
      <CachedDataNote tz={tz} />
      {act.loading && !a ? (
        <SkeletonCard lines={4} />
      ) : act.error && !a ? (
        <ErrorState error={act.error} onRetry={act.reload} />
      ) : a && !a.lastReceivedAt ? (
        <ActivityEmpty />
      ) : a ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Card aria-labelledby="res-passos">
              <div className="flex items-center gap-2.5">
                <span className="flex size-10 items-center justify-center rounded-[12px] bg-wash-peach text-brand-orange-ink">
                  <Footprints aria-hidden className="size-5" />
                </span>
                <h2 id="res-passos" className="flex-1 text-[17px] font-semibold">
                  Passos de hoje
                </h2>
                {a.steps.partial && a.steps.count != null && <span className="rounded-full bg-wash-sun px-2.5 py-0.5 text-xs font-semibold text-[#524700]">Parcial do dia</span>}
              </div>
              <StepsToday count={a.steps.count} partial={a.steps.partial} goal={a.stepsGoal?.dailyStepsTarget ?? null} />
              <div className="mt-2 flex flex-wrap items-center gap-x-3">
                <p className="tabular text-sm text-ink-muted">
                  {a.stepsGoal ? `Meta pessoal: ${formatSteps(a.stepsGoal.dailyStepsTarget)}` : 'Nenhuma meta pessoal definida'}
                </p>
                <button
                  type="button"
                  onClick={() => setGoalOpen(true)}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-[12px] px-2 text-sm font-semibold text-brand-orange-ink hover:bg-wash-peach"
                >
                  <SlidersHorizontal aria-hidden className="size-4" />
                  {a.stepsGoal ? 'Ajustar' : 'Definir meta'}
                </button>
              </div>
            </Card>
            <Card aria-labelledby="res-exercicio">
              <div className="flex items-center gap-2.5">
                <span className="flex size-10 items-center justify-center rounded-[12px] bg-wash-sun text-[#6c5e00]">
                  <Timer aria-hidden className="size-5" />
                </span>
                <h2 id="res-exercicio" className="text-[17px] font-semibold">
                  Exercícios de hoje
                </h2>
              </div>
              {a.workoutCount > 0 ? (
                <>
                  <p className="tabular mt-3 font-display text-[32px] font-semibold leading-none">{formatDuration(a.workoutSeconds)}</p>
                  <p className="mt-1 text-sm text-ink-muted">
                    {a.workoutCount === 1 ? '1 exercício recebido hoje' : `${formatInt(a.workoutCount)} exercícios recebidos hoje`}
                  </p>
                </>
              ) : (
                <p className="mt-3 text-sm text-ink-muted">Nenhum exercício recebido hoje.</p>
              )}
            </Card>
          </div>
          <ReceivedLine lastReceivedAt={a.lastReceivedAt} tz={tz} partial={a.steps.partial && a.steps.count != null} />

          <section aria-labelledby="res-recentes" className="flex flex-col gap-3">
            <SectionTitle
              id="res-recentes"
              accent="teal"
              action={
                <Link href="/atividade/exercicios" className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-teal-ink underline-offset-2 hover:underline">
                  Ver todos
                </Link>
              }
            >
              Exercícios recentes
            </SectionTitle>
            {recent.data && recent.data.items.length === 0 && <p className="text-sm text-ink-muted">Nenhum exercício recebido ainda.</p>}
            <ul className="flex flex-col gap-2">
              {recent.data?.items.map((w) => (
                <li key={w.id}>
                  <WorkoutCard workout={w} tz={tz} />
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : null}
      {goalOpen && <StepsGoalDialog goal={a?.stepsGoal ?? null} onClose={() => setGoalOpen(false)} />}
    </div>
  );
}

export function StepsToday({ count, partial, goal }: { count: number | null; partial: boolean; goal: number | null }) {
  const status = stepsDayStatus({ count, partial });
  if (status.kind === 'absent') return <p className="mt-3 text-sm text-ink-muted">Sem dados de passos para hoje.</p>;
  return (
    <div className="mt-3 flex flex-col gap-2">
      <p className="tabular">
        <span className="font-display text-[32px] font-semibold leading-none">{formatInt(count!)}</span>{' '}
        <span className="text-sm font-semibold text-ink-muted">{count === 1 ? 'passo' : 'passos'}</span>
        {goal != null && <span className="text-sm text-ink-muted"> de {formatInt(goal)}</span>}
      </p>
      {goal != null && (
        <>
          <ProgressBar fraction={count! / goal} color="bg-brand-orange" />
          <p className="tabular text-xs text-ink-muted">{percentOf(count!, goal)}% da meta pessoal</p>
        </>
      )}
    </div>
  );
}
