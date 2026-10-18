'use client';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { ChevronLeft, Droplets, HeartPulse, Pill, Ruler, Scale } from 'lucide-react';
import type { Module } from '@zelo/contracts';
import { useOptionalSession } from '@/shared/data/session';
import { Dialog } from '@/shared/ui/Dialog';
import { useToast } from '@/shared/ui/Toast';
import { WeightForm } from '@/features/body/WeightForm';
import { MeasurementForm } from '@/features/body/MeasurementForm';
import { BloodPressureForm } from '@/features/blood-pressure/BloodPressureForm';
import { RegisterIntakePanel } from '@/features/routine/RegisterIntakePanel';
import { WaterForm } from '@/features/hydration/WaterForm';

export type RegisterKind = 'weight' | 'measurement' | 'bloodPressure' | 'water' | 'intake';

interface RegisterContextValue {
  open: (kind?: RegisterKind) => void;
}

const RegisterContext = createContext<RegisterContextValue>({ open: () => {} });
export const useRegister = () => useContext(RegisterContext);

export const REGISTER_OPTIONS: { kind: RegisterKind; label: string; description: string; module: Module; icon: typeof Scale }[] = [
  { kind: 'weight', label: 'Peso', description: 'kg, data e horário', module: 'body', icon: Scale },
  { kind: 'measurement', label: 'Medidas', description: 'cintura, quadril, braço…', module: 'body', icon: Ruler },
  { kind: 'bloodPressure', label: 'Pressão', description: 'sistólica, diastólica e pulso', module: 'bloodPressure', icon: HeartPulse },
  { kind: 'water', label: 'Água', description: 'quantidade em ml e horário', module: 'hydration', icon: Droplets },
  { kind: 'intake', label: 'Tomada', description: 'medicamento, vitamina ou suplemento', module: 'routine', icon: Pill },
];

const TITLES: Record<RegisterKind, string> = {
  weight: 'Registrar peso',
  measurement: 'Registrar medidas',
  bloodPressure: 'Registrar pressão',
  water: 'Registrar água',
  intake: 'Registrar tomada',
};

export function RegisterProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ open: boolean; kind: RegisterKind | null }>({ open: false, kind: null });
  const open = useCallback((kind?: RegisterKind) => setState({ open: true, kind: kind ?? null }), []);
  const close = useCallback(() => setState({ open: false, kind: null }), []);
  const value = useMemo(() => ({ open }), [open]);
  return (
    <RegisterContext.Provider value={value}>
      {children}
      {state.open && <RegisterDialog kind={state.kind} onKind={(kind) => setState({ open: true, kind })} onClose={close} />}
    </RegisterContext.Provider>
  );
}

export function RegisterDialog({
  kind,
  onKind,
  onClose,
  modules,
}: {
  kind: RegisterKind | null;
  onKind: (k: RegisterKind | null) => void;
  onClose: () => void;
  /** override (tests); defaults to profile.visibleModules */
  modules?: readonly Module[];
}) {
  const session = useOptionalSession();
  const toast = useToast();
  const visible = modules ?? session?.profile.visibleModules ?? ['body', 'bloodPressure', 'hydration', 'activity', 'routine'];
  const options = REGISTER_OPTIONS.filter((o) => visible.includes(o.module));

  const done = (persistence: 'server' | 'local', what: string) => {
    toast({ message: persistence === 'local' ? `${what} salvo neste dispositivo` : `${what} salvo` });
    onClose();
  };

  return (
    <Dialog open onClose={onClose} title={kind ? TITLES[kind] : 'Registrar'} description={kind ? undefined : 'O que você quer registrar agora?'}>
      {kind && (
        <button
          type="button"
          onClick={() => onKind(null)}
          className="-ml-2 mb-2 inline-flex min-h-11 items-center gap-1 rounded-[12px] px-2 text-sm font-semibold text-brand-teal-ink hover:bg-brand-teal-wash"
        >
          <ChevronLeft aria-hidden className="size-4" />
          Outras opções
        </button>
      )}
      {!kind && (
        <ul className="grid grid-cols-2 gap-3 pb-2">
          {options.map((o) => {
            const Icon = o.icon;
            return (
              <li key={o.kind}>
                <button
                  type="button"
                  onClick={() => onKind(o.kind)}
                  className="flex h-full min-h-28 w-full flex-col items-start gap-2 rounded-card bg-surface p-4 text-left shadow-card hover:bg-wash-peach"
                >
                  <span className="flex size-11 items-center justify-center rounded-[14px] bg-wash-peach text-brand-orange-ink">
                    <Icon aria-hidden className="size-5" />
                  </span>
                  <span className="font-semibold text-ink">{o.label}</span>
                  <span className="text-xs text-ink-muted">{o.description}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {kind === 'weight' && <WeightForm onDone={(m) => done(m.persistence, 'Peso')} />}
      {kind === 'measurement' && <MeasurementForm onDone={(m) => done(m.persistence, 'Medidas')} />}
      {kind === 'bloodPressure' && <BloodPressureForm onDone={(m) => done(m.persistence, 'Pressão')} />}
      {kind === 'water' && <WaterForm onDone={(m) => done(m.persistence, 'Registro de água')} />}
      {kind === 'intake' && <RegisterIntakePanel onDone={onClose} />}
    </Dialog>
  );
}
