'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useZelo } from '@/shared/data/ZeloProvider';
import { useSubmit } from '@/shared/data/useSubmit';
import { Button } from '@/shared/ui/Button';
import { FormError, FormSuccess, TextField } from '@/shared/ui/Field';

export function ResetPasswordPage() {
  const { auth } = useZelo();
  const token = useSearchParams().get('token') ?? '';
  const { pending, error, run } = useSubmit();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next = {
      password: password.length < 8 ? 'Mínimo de 8 caracteres' : password.length > 128 ? 'Máximo de 128 caracteres' : undefined,
      confirm: confirm !== password ? 'As senhas não conferem' : undefined,
    };
    setErrors(next);
    if (next.password || next.confirm) return;
    const r = await run(async () => {
      await auth.confirmPasswordReset(token, password);
      return true;
    });
    if (r) setDone(true);
  };

  return (
    <div className="flex flex-col gap-5">
      <h1 className="font-display text-3xl font-semibold">Nova senha</h1>
      {token.length < 16 ? (
        <FormError>Link inválido ou incompleto. Solicite um novo link de recuperação.</FormError>
      ) : done ? (
        <FormSuccess>Senha alterada. Você já pode entrar com a nova senha.</FormSuccess>
      ) : (
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <TextField label="Nova senha" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} />
          <TextField label="Confirme a nova senha" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} error={errors.confirm} />
          {error && <FormError>{error.kind === 'validation' || error.kind === 'notFound' ? 'Link expirado ou inválido. Solicite um novo.' : error.message}</FormError>}
          <Button type="submit" variant="primary" size="lg" pending={pending} block>
            Salvar nova senha
          </Button>
        </form>
      )}
      <div className="flex flex-wrap gap-4 text-sm">
        <Link href="/entrar" className="inline-flex min-h-11 items-center font-semibold text-brand-teal-ink underline">
          Ir para entrar
        </Link>
        <Link href="/recuperar-acesso" className="inline-flex min-h-11 items-center font-semibold text-brand-teal-ink underline">
          Pedir novo link
        </Link>
      </div>
    </div>
  );
}
