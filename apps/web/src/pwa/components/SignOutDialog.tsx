'use client';
import { Dialog } from '@/shared/ui/Dialog';
import { Button } from '@/shared/ui/Button';
import type { SignOutChoice, SignOutPrompt } from '@/infrastructure/offline';

/** "Sair com alterações pendentes" — never discards silently. */
export function SignOutDialog({ prompt, onChoose }: { prompt: SignOutPrompt | null; onChoose: (c: SignOutChoice) => void }) {
  const n = prompt?.pendingCount ?? 0;
  const items = n === 1 ? '1 alteração salva só neste dispositivo' : `${n} alterações salvas só neste dispositivo`;
  return (
    <Dialog
      open={!!prompt}
      onClose={() => onChoose('cancel')}
      title="Alterações ainda não sincronizadas"
      description={`Você tem ${items}. Ao sair, os dados locais deste dispositivo são apagados.`}
    >
      <div className="flex flex-col gap-3">
        {prompt?.syncFailed ? (
          <p role="alert" className="rounded-[var(--radius-field)] bg-danger-wash p-3 text-sm text-ink">
            Não foi possível sincronizar tudo{prompt.online ? '' : ' (sem conexão)'}. Tente novamente, cancele ou descarte explicitamente.
          </p>
        ) : null}
        {!prompt?.online ? <p className="text-sm text-ink-muted">Você está offline: conecte-se para sincronizar antes de sair.</p> : null}
        <Button variant="primary" block onClick={() => onChoose('sync')} disabled={!prompt?.online} data-autofocus>
          Sincronizar e sair
        </Button>
        <Button variant="secondary" block onClick={() => onChoose('cancel')}>
          Cancelar
        </Button>
        <Button variant="danger" block onClick={() => onChoose('discard')}>
          Descartar e sair
        </Button>
      </div>
    </Dialog>
  );
}
