'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useZelo } from '@/shared/data/ZeloProvider';
import { useSubmit } from '@/shared/data/useSubmit';
import { Button } from '@/shared/ui/Button';
import { FormError, FormSuccess, TextField } from '@/shared/ui/Field';

export function RecoverPage() {
  const { auth } = useZelo();
  const { pending, error, run } = useSubmit();
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string>();
  const [sent, setSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = /^\S+@\S+\.\S+$/.test(email.trim());
    setEmailError(ok ? undefined : 'Informe um e-mail válido');
    if (!ok) return;
    const r = await run(async () => {
      await auth.requestPasswordReset(email.trim());
      return true;
    });
    if (r) setSent(true);
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-3xl font-semibold">Recuperar acesso</h1>
        <p className="mt-1 text-sm text-ink-muted">Enviaremos um link para você criar uma nova senha.</p>
      </div>
      {sent ? (
        <FormSuccess>Se houver uma conta com este e-mail, você receberá as instruções em instantes.</FormSuccess>
      ) : (
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <TextField label="E-mail" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} error={emailError} />
          {error && <FormError>{error.kind === 'offline' ? 'Sem conexão. A recuperação de acesso precisa de internet.' : error.message}</FormError>}
          <Button type="submit" variant="primary" size="lg" pending={pending} block>
            Enviar link
          </Button>
        </form>
      )}
      <Link href="/entrar" className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-teal-ink underline">
        Voltar para entrar
      </Link>
    </div>
  );
}
