'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { MODULES, type Module } from '@zelo/contracts';
import { InstallPrompt, OfflineSettings, PushSettings } from '@/pwa';
import { useZelo } from '@/shared/data/ZeloProvider';
import { useSession } from '@/shared/data/session';
import { useIntent } from '@/shared/data/intent';
import { useSubmit } from '@/shared/data/useSubmit';
import { describeError, fieldError } from '@/shared/data/errors';
import { listTimeZones } from '@/shared/lib/time';
import { Button } from '@/shared/ui/Button';
import { Card, PageHeader } from '@/shared/ui/Card';
import { Checkbox, FormError, FormSuccess, SelectField, TextField } from '@/shared/ui/Field';
import { ConflictActions } from '@/shared/ui/ConflictActions';

const MODULE_LABELS: Record<Module, { label: string; description: string }> = {
  body: { label: 'Corpo', description: 'Peso e medidas' },
  bloodPressure: { label: 'Pressão', description: 'Pressão arterial e pulso' },
  hydration: { label: 'Água', description: 'Registros de água e meta pessoal opcional' },
  activity: { label: 'Atividade', description: 'Passos e exercícios recebidos do Auto Export (somente leitura)' },
  routine: { label: 'Rotina', description: 'Medicamentos, vitaminas e suplementos' },
};

export function SettingsPage() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="Preferências" title="Configurações" />
      <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
        <div className="flex min-w-0 flex-col gap-5">
          <ProfileCard />
          <AccountCard />
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          <OfflineSettings />
          <PushSettings />
          <InstallPrompt />
        </div>
      </div>
    </div>
  );
}

function ProfileCard() {
  const { profile, setProfile, refreshProfile } = useSession();
  const { data } = useZelo();
  const intent = useIntent();
  const { pending, error, run } = useSubmit();
  const zones = useMemo(() => listTimeZones(), []);
  const [name, setName] = useState(profile.displayName);
  const [timezone, setTimezone] = useState(profile.timezone);
  const [modules, setModules] = useState<Module[]>(profile.visibleModules);
  const [reminders, setReminders] = useState(profile.remindersEnabled);
  const [nameError, setNameError] = useState<string>();
  const [saved, setSaved] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaved(false);
    const trimmed = name.trim();
    const err = !trimmed ? 'Informe seu nome' : trimmed.length > 80 ? 'Use até 80 caracteres' : undefined;
    setNameError(err);
    if (err) return;
    const r = await run(
      () =>
        data.updateProfile({
          operationId: intent.current().operationId,
          expectedVersion: profile.version,
          displayName: trimmed,
          timezone,
          visibleModules: MODULES.filter((m) => modules.includes(m)),
          remindersEnabled: reminders,
        }),
      { onServerError: () => intent.rotateOperation() },
    );
    if (r) {
      intent.reset();
      setProfile(r);
      setSaved(true);
    }
  };

  return (
    <Card aria-labelledby="perfil-titulo">
      <h2 id="perfil-titulo" className="mb-4 font-display text-xl font-semibold">
        Perfil
      </h2>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <TextField label="Nome de exibição" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} error={nameError ?? fieldError(error?.fieldErrors ?? {}, 'displayName')} />
        <SelectField
          label="Fuso horário"
          required
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          hint="Define o “hoje” do app. Alterar o fuso não muda as programações já cadastradas."
        >
          {!zones.includes(timezone) && <option value={timezone}>{timezone}</option>}
          {zones.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </SelectField>
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-[13px] font-semibold">Módulos visíveis</legend>
          {MODULES.map((m) => (
            <Checkbox
              key={m}
              label={MODULE_LABELS[m].label}
              description={MODULE_LABELS[m].description}
              checked={modules.includes(m)}
              onChange={(e) => setModules((cur) => (e.target.checked ? [...cur, m] : cur.filter((x) => x !== m)))}
            />
          ))}
        </fieldset>
        <Checkbox
          label="Lembretes"
          description="Mostrar lembretes dos horários da rotina. Notificações push são configuradas por dispositivo abaixo."
          checked={reminders}
          onChange={(e) => setReminders(e.target.checked)}
        />
        {error && (
          <FormError>
            {error.kind === 'offline' ? 'Alterações de perfil precisam de conexão com a internet.' : error.message}
            {error.kind === 'conflict' && (
              <ConflictActions
                onReload={() => {
                  void refreshProfile();
                }}
              />
            )}
          </FormError>
        )}
        {saved && <FormSuccess>Preferências salvas.</FormSuccess>}
        <Button type="submit" variant="primary" pending={pending} className="self-start">
          Salvar preferências
        </Button>
      </form>
    </Card>
  );
}

function AccountCard() {
  const { auth } = useZelo();
  const { session } = useSession();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const logout = async () => {
    setPending(true);
    setError(null);
    try {
      await auth.signOut();
      router.replace('/entrar');
    } catch (e) {
      if (e instanceof Error && e.name === 'SignOutCancelledError') return;
      setError(describeError(e).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <Card aria-labelledby="conta-titulo">
      <h2 id="conta-titulo" className="font-display text-xl font-semibold">
        Conta
      </h2>
      <p className="mt-1 break-all text-sm text-ink-muted">{session.user.email}</p>
      {error && (
        <div className="mt-3">
          <FormError>{error}</FormError>
        </div>
      )}
      <Button className="mt-4" onClick={() => void logout()} pending={pending} icon={<LogOut aria-hidden className="size-4" />}>
        Sair
      </Button>
    </Card>
  );
}
