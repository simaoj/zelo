'use client';
import Link from 'next/link';
import { CalendarDays, ChevronRight, HeartPulse, Pill, Plus, Ruler, Scale, Sprout } from 'lucide-react';
import type { DashboardResponse, Module } from '@zelo/contracts';
import { InstallPrompt } from '@/pwa';
import { useResource } from '@/shared/data/hooks';
import { useSession } from '@/shared/data/session';
import { formatDecimal, formatDelta } from '@/shared/lib/decimal';
import { describeInstant, formatLongDate, greeting, todayIn } from '@/shared/lib/time';
import { Button } from '@/shared/ui/Button';
import { Card, Eyebrow, SectionTitle } from '@/shared/ui/Card';
import { Sparkline } from '@/shared/ui/Chart';
import { EmptyState, ErrorState, SkeletonCard } from '@/shared/ui/States';
import { cx } from '@/shared/ui/cx';
import { useRegister, type RegisterKind } from '@/features/shell/RegisterDialog';
import { OccurrenceCard } from '@/features/routine/OccurrenceCard';
import { effectiveState, isDecided } from '@/features/routine/occurrenceLogic';
import { measurementLabel } from '@/features/body/measurementLogic';

const QUICK: { kind: RegisterKind; label: string; module: Module; icon: typeof Scale; primary?: boolean }[] = [
  { kind: 'bloodPressure', label: 'Pressão', module: 'bloodPressure', icon: HeartPulse, primary: true },
  { kind: 'weight', label: 'Peso', module: 'body', icon: Scale },
  { kind: 'measurement', label: 'Medidas', module: 'body', icon: Ruler },
  { kind: 'intake', label: 'Tomada', module: 'routine', icon: Pill },
];

export function TodayPage() {
  const { profile } = useSession();
  const tz = profile.timezone;
  const today = todayIn(tz);
  const dash = useResource(`dashboard:${today}`, (ds) => ds.getDashboard(today));
  const { open } = useRegister();
  const modules = profile.visibleModules;
  const has = (m: Module) => modules.includes(m);
  const d = dash.data;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)] lg:items-start">
      <div className="flex min-w-0 flex-col gap-6">
        {/* Greeting */}
        <section className="relative overflow-hidden rounded-card bg-surface p-5 shadow-card">
          <div aria-hidden className="pointer-events-none absolute -right-8 -top-10 size-32 rounded-full bg-brand-yellow/50 blur-xl" />
          <div aria-hidden className="pointer-events-none absolute -right-4 top-12 size-20 rounded-full bg-brand-pink/50 blur-lg" />
          <div className="relative flex flex-col gap-1">
            <Eyebrow>Seu cuidado, dia a dia</Eyebrow>
            <h1 className="font-display text-[28px] font-semibold leading-tight tracking-tight lg:text-[34px]">
              {greeting(tz)}, {d?.displayName ?? profile.displayName}
            </h1>
            <p className="flex items-center gap-1.5 text-sm text-ink-muted">
              <CalendarDays aria-hidden className="size-4 text-[#6c5e00]" />
              {formatLongDate(d?.date ?? today)}
            </p>
            <p className="mt-2 flex items-center gap-2 border-t border-line/70 pt-3 text-sm italic text-ink">
              <Sprout aria-hidden className="size-5 shrink-0 text-brand-orange-ink" />
              Um dia de cada vez, cuidando de você com carinho.
            </p>
          </div>
        </section>

        {/* Quick actions */}
        <section aria-labelledby="quick-title" className="flex flex-col gap-2">
          <h2 id="quick-title" className="text-[13px] font-semibold uppercase tracking-[0.08em] text-ink">
            Ações rápidas
          </h2>
          <div className="flex flex-wrap gap-2">
            {QUICK.filter((q) => has(q.module)).map((q) => {
              const Icon = q.icon;
              return (
                <button
                  key={q.kind}
                  type="button"
                  onClick={() => open(q.kind)}
                  className={cx(
                    'flex min-h-11 items-center gap-2 rounded-[14px] px-4 text-[13px] font-semibold',
                    q.primary ? 'bg-brand-orange text-ink shadow-[0_4px_14px_rgba(255,130,67,0.25)]' : 'bg-surface text-ink shadow-card',
                  )}
                >
                  <Plus aria-hidden className="size-4" />
                  <Icon aria-hidden className="size-4" />
                  {q.label}
                </button>
              );
            })}
          </div>
        </section>

        {/* Seu cuidado hoje */}
        <section aria-labelledby="care-title" className="flex flex-col gap-3">
          <SectionTitle id="care-title" accent="orange" action={d && d.occurrences.length > 0 ? <CareCount d={d} /> : undefined}>
            Seu cuidado hoje
          </SectionTitle>
          {dash.loading && !d ? (
            <SkeletonCard />
          ) : dash.error && !d ? (
            <ErrorState error={dash.error} onRetry={dash.reload} />
          ) : d ? (
            <div className="flex flex-col gap-3">
              {has('routine') &&
                (d.occurrences.length === 0 ? (
                  <EmptyState icon={<Pill aria-hidden className="size-5" />} title="Nenhum horário programado para hoje">
                    Cadastre medicamentos, vitaminas ou suplementos em{' '}
                    <Link href="/rotina?aba=itens" className="font-semibold text-brand-teal-ink underline">
                      Rotina
                    </Link>{' '}
                    para vê-los aqui.
                  </EmptyState>
                ) : (
                  d.occurrences.map((o) => <OccurrenceCard key={o.id} occurrence={o} tz={tz} compact />)
                ))}
              {has('bloodPressure') && (
                <div className="relative flex flex-wrap items-center gap-3 overflow-hidden rounded-card bg-surface p-4 shadow-card">
                  <div aria-hidden className="absolute inset-x-6 top-0 h-1 rounded-b-full bg-brand-orange" />
                  <div className="flex size-11 items-center justify-center rounded-[14px] bg-wash-peach text-brand-orange-ink">
                    <HeartPulse aria-hidden className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold">Pressão arterial</h3>
                    <p className="text-sm text-ink-muted">
                      {d.latestBloodPressure ? `Último registro: ${describeInstant(d.latestBloodPressure.measuredAt, tz)}` : 'Nenhum registro ainda'}
                    </p>
                  </div>
                  <Button variant="primary" onClick={() => open('bloodPressure')} icon={<Plus aria-hidden className="size-4" />}>
                    Registrar pressão
                  </Button>
                </div>
              )}
              {!has('routine') && !has('bloodPressure') && (
                <EmptyState title="Seus módulos de rotina e pressão estão ocultos">Você pode ativá-los em Configurações.</EmptyState>
              )}
            </div>
          ) : null}
        </section>
      </div>

      {/* Últimos registros */}
      <aside aria-labelledby="latest-title" className="flex min-w-0 flex-col gap-3">
        <SectionTitle id="latest-title" accent="teal">
          Últimos registros
        </SectionTitle>
        {dash.loading && !d ? (
          <>
            <SkeletonCard lines={2} />
            <SkeletonCard lines={2} />
          </>
        ) : d ? (
          <>
            {has('bloodPressure') && <LatestBp d={d} tz={tz} />}
            {has('body') && <LatestWeight d={d} tz={tz} />}
            {has('body') && <LatestMeasurement d={d} tz={tz} />}
          </>
        ) : null}
        <InstallPrompt />
      </aside>
    </div>
  );
}

function CareCount({ d }: { d: DashboardResponse }) {
  const decided = d.occurrences.filter((o) => isDecided(effectiveState(o))).length;
  return (
    <span className="tabular text-xs font-medium text-ink-muted">
      {decided} de {d.occurrences.length} registrados
    </span>
  );
}

function LatestBp({ d, tz }: { d: DashboardResponse; tz: string }) {
  const bp = d.latestBloodPressure;
  return (
    <Card aria-labelledby="bp-latest">
      <div className="flex items-center gap-2.5">
        <div className="flex size-10 items-center justify-center rounded-[12px] bg-brand-teal-wash text-brand-teal-ink">
          <HeartPulse aria-hidden className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 id="bp-latest" className="text-[17px] font-semibold">
            Pressão arterial
          </h3>
          {bp && <p className="text-xs font-semibold text-brand-teal-ink">{describeInstant(bp.measuredAt, tz)}</p>}
        </div>
        <Link href="/pressao" className="inline-flex size-11 items-center justify-center rounded-full text-ink-muted hover:bg-surface-muted">
          <ChevronRight aria-hidden className="size-5" />
          <span className="sr-only">Ver pressão arterial</span>
        </Link>
      </div>
      {bp ? (
        <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2">
          <p className="tabular">
            <span className="font-display text-[32px] font-semibold">
              {bp.systolic} / {bp.diastolic}
            </span>{' '}
            <span className="text-xs font-semibold text-ink-muted">mmHg</span>
          </p>
          {bp.pulseBpm != null && (
            <span className="tabular rounded-[12px] bg-brand-yellow/50 px-2.5 py-1 text-sm font-bold text-[#443b00]">Pulso {bp.pulseBpm} bpm</span>
          )}
        </div>
      ) : (
        <p className="mt-2 text-sm text-ink-muted">Sem registros de pressão ainda.</p>
      )}
    </Card>
  );
}

function LatestWeight({ d, tz }: { d: DashboardResponse; tz: string }) {
  const w = d.latestWeight;
  const values = d.weightSparkline.map((p) => Number(p.weightKg));
  return (
    <Card aria-labelledby="w-latest">
      <div className="flex items-center gap-2.5">
        <div className="flex size-10 items-center justify-center rounded-[12px] bg-surface-muted text-ink-muted">
          <Scale aria-hidden className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 id="w-latest" className="text-[17px] font-semibold">
            Peso
          </h3>
          {w && <p className="text-xs text-ink-muted">{describeInstant(w.measuredAt, tz)}</p>}
        </div>
        <Link href="/corpo" className="inline-flex size-11 items-center justify-center rounded-full text-ink-muted hover:bg-surface-muted">
          <ChevronRight aria-hidden className="size-5" />
          <span className="sr-only">Ver peso</span>
        </Link>
      </div>
      {w ? (
        <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="tabular">
              <span className="font-display text-[32px] font-semibold">{formatDecimal(w.weightKg)}</span>{' '}
              <span className="text-xs font-semibold text-ink-muted">kg</span>
            </p>
            {w.deltaKg != null && (
              <p className="tabular text-xs text-ink-muted">
                <span className="font-semibold text-brand-teal-ink">{formatDelta(w.deltaKg)} kg</span> em relação ao registro anterior
              </p>
            )}
          </div>
          {values.length > 0 && <Sparkline values={values} label={`Últimos ${values.length} registros`} />}
        </div>
      ) : (
        <p className="mt-2 text-sm text-ink-muted">Sem registros de peso ainda.</p>
      )}
    </Card>
  );
}

function LatestMeasurement({ d, tz }: { d: DashboardResponse; tz: string }) {
  const m = d.latestMeasurement;
  return (
    <Card aria-labelledby="m-latest">
      <div className="flex items-center gap-2.5">
        <div className="flex size-10 items-center justify-center rounded-[12px] bg-surface-muted text-ink-muted">
          <Ruler aria-hidden className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 id="m-latest" className="text-[17px] font-semibold">
            Medidas
          </h3>
          {m && <p className="text-xs text-ink-muted">{describeInstant(m.measuredAt, tz)}</p>}
        </div>
        <Link href="/corpo?aba=medidas" className="inline-flex size-11 items-center justify-center rounded-full text-ink-muted hover:bg-surface-muted">
          <ChevronRight aria-hidden className="size-5" />
          <span className="sr-only">Ver medidas</span>
        </Link>
      </div>
      {m ? (
        <dl className="mt-3 grid grid-cols-2 gap-2">
          {m.values.map((v) => (
            <div key={`${v.type}-${v.side}`} className="rounded-[14px] bg-surface-muted px-3 py-2">
              <dt className="text-xs text-ink-muted">{measurementLabel(v.type, v.side)}</dt>
              <dd className="tabular text-lg font-semibold">
                {formatDecimal(v.valueCm)} <span className="text-xs font-semibold text-ink-muted">cm</span>
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-2 text-sm text-ink-muted">Sem medidas registradas ainda.</p>
      )}
    </Card>
  );
}
