'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useZelo } from '@/shared/data/ZeloProvider';
import { useSubmit } from '@/shared/data/useSubmit';
import { Button } from '@/shared/ui/Button';
import { FormError, TextField } from '@/shared/ui/Field';

function safeNext(v: string | null) {
  return v && v.startsWith('/') && !v.startsWith('//') && !v.startsWith('/entrar') ? v : '/hoje';
}

export function SignInPage() {
  const { auth } = useZelo();
  const router = useRouter();
  const params = useSearchParams();
  const expired = params.get('sessao') === 'expirada';
  const { pending, error, run } = useSubmit();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next = {
      email: /^\S+@\S+\.\S+$/.test(email.trim()) ? undefined : 'Informe um e-mail válido',
      password: password ? undefined : 'Informe sua senha',
    };
    setErrors(next);
    if (next.email || next.password) return;
    const r = await run(() => auth.signIn({ email: email.trim(), password }));
    if (r) router.replace(safeNext(params.get('voltar')));
  };

  const message =
    error?.kind === 'expired' || error?.kind === 'validation'
      ? 'E-mail ou senha incorretos.'
      : error?.kind === 'offline'
        ? 'Sem conexão. O primeiro acesso precisa de internet.'
        : error?.message;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-3xl font-semibold">Entrar</h1>
        <p className="mt-1 text-sm text-ink-muted">Que bom ter você por aqui.</p>
      </div>
      {expired && (
        <p role="status" className="rounded-field bg-wash-sun px-3.5 py-2.5 text-sm font-medium text-[#443b00]">
          Sessão expirada. Entre novamente para continuar.
        </p>
      )}
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <TextField label="E-mail" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} />
        <TextField
          label="Senha"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
        />
        {error && <FormError>{message}</FormError>}
        <Button type="submit" variant="primary" size="lg" pending={pending} block>
          Entrar
        </Button>
      </form>
      <div className="flex flex-col gap-1 text-sm">
        <Link href="/recuperar-acesso" className="inline-flex min-h-11 items-center font-semibold text-brand-teal-ink underline">
          Esqueci minha senha
        </Link>
        <p className="text-ink-muted">
          Ainda não tem conta?{' '}
          <Link href="/criar-conta" className="inline-flex min-h-11 items-center font-semibold text-brand-teal-ink underline">
            Criar conta
          </Link>
        </p>
      </div>
    </div>
  );
}
