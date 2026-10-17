'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useZelo } from '@/shared/data/ZeloProvider';
import { useSubmit } from '@/shared/data/useSubmit';
import { fieldError } from '@/shared/data/errors';
import { browserTimeZone, listTimeZones } from '@/shared/lib/time';
import { Button } from '@/shared/ui/Button';
import { FormError, SelectField, TextField } from '@/shared/ui/Field';

export function SignUpPage() {
  const { auth } = useZelo();
  const router = useRouter();
  const { pending, error, run } = useSubmit();
  const zones = useMemo(() => listTimeZones(), []);
  const [form, setForm] = useState(() => ({ displayName: '', email: '', password: '', timezone: browserTimeZone() }));
  const [errors, setErrors] = useState<Partial<Record<keyof typeof form, string>>>({});
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = form.displayName.trim();
    const next = {
      displayName: !name ? 'Informe como quer ser chamado(a)' : name.length > 80 ? 'Use até 80 caracteres' : undefined,
      email: /^\S+@\S+\.\S+$/.test(form.email.trim()) ? undefined : 'Informe um e-mail válido',
      password: form.password.length < 8 ? 'Mínimo de 8 caracteres' : form.password.length > 128 ? 'Máximo de 128 caracteres' : undefined,
      timezone: form.timezone ? undefined : 'Escolha um fuso horário',
    };
    setErrors(next);
    if (Object.values(next).some(Boolean)) return;
    const r = await run(() => auth.signUp({ displayName: name, email: form.email.trim(), password: form.password, timezone: form.timezone }));
    if (r) router.replace('/hoje');
  };
  const fe = error?.fieldErrors ?? {};

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-3xl font-semibold">Criar conta</h1>
        <p className="mt-1 text-sm text-ink-muted">Organize seus registros de saúde com calma.</p>
      </div>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <TextField label="Como quer ser chamado(a)" autoComplete="nickname" required value={form.displayName} onChange={set('displayName')} error={errors.displayName ?? fieldError(fe, 'displayName')} />
        <TextField label="E-mail" type="email" autoComplete="email" required value={form.email} onChange={set('email')} error={errors.email ?? fieldError(fe, 'email')} />
        <TextField
          label="Senha"
          type="password"
          autoComplete="new-password"
          required
          hint="Mínimo de 8 caracteres."
          value={form.password}
          onChange={set('password')}
          error={errors.password ?? fieldError(fe, 'password')}
        />
        <SelectField label="Fuso horário" required value={form.timezone} onChange={set('timezone')} error={errors.timezone ?? fieldError(fe, 'timezone')}>
          {!zones.includes(form.timezone) && <option value={form.timezone}>{form.timezone}</option>}
          {zones.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </SelectField>
        {error && <FormError>{error.kind === 'conflict' ? 'Não foi possível criar a conta com estes dados.' : error.kind === 'validation' ? 'Confira os campos destacados.' : error.message}</FormError>}
        <Button type="submit" variant="primary" size="lg" pending={pending} block>
          Criar conta
        </Button>
      </form>
      <p className="text-sm text-ink-muted">
        Já tem conta?{' '}
        <Link href="/entrar" className="inline-flex min-h-11 items-center font-semibold text-brand-teal-ink underline">
          Entrar
        </Link>
      </p>
    </div>
  );
}
