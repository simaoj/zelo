'use client';
import { useCallback, useEffect, useState } from 'react';
import type { QueuedOperationView } from '@/shared/data/ports';
import { isOfflineSync } from '@/infrastructure/offline';
import { Dialog } from '@/shared/ui/Dialog';
import { Button } from '@/shared/ui/Button';
import { usePwa, useSyncStatus } from '../PwaProvider';
import { FIELD_LABELS, OPERATION_LABELS, comparableFields, formatField } from '../labels';

/**
 * Lists operations that are pending / in conflict / rejected. Conflicts show the local and the
 * server version side by side; the user decides (never silent last-write-wins).
 * Opened from SyncStatusBadge (or usePwa().openConflicts()).
 */
export function ConflictCenter() {
  const { sync, conflictsOpen, closeConflicts } = usePwa();
  const status = useSyncStatus();
  const [ops, setOps] = useState<QueuedOperationView[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!sync) return;
    setOps(await sync.listProblemOperations());
  }, [sync]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- refresh list when opened / status changes
    if (conflictsOpen) void reload();
  }, [conflictsOpen, reload, status]);

  const act = async (id: string, fn: () => Promise<void>, done: string) => {
    setBusy(id);
    setMessage(null);
    try {
      await fn();
      setMessage(done);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Não foi possível concluir.');
    } finally {
      setBusy(null);
      await reload();
    }
  };

  const foreign = isOfflineSync(sync) ? sync.getForeignAccount() : null;
  const conflicts = ops.filter((o) => o.state === 'conflict');
  const errors = ops.filter((o) => o.state === 'error');
  const pending = ops.filter((o) => o.state === 'pending' || o.state === 'syncing');

  return (
    <Dialog open={conflictsOpen} onClose={closeConflicts} title="Sincronização" description="Alterações salvas neste dispositivo que ainda não foram confirmadas pelo servidor." size="lg">
      <div className="flex flex-col gap-5">
        {message ? (
          <p role="status" className="rounded-[var(--radius-field)] bg-brand-teal-wash p-3 text-sm text-brand-teal-ink">
            {message}
          </p>
        ) : null}

        {foreign && sync && isOfflineSync(sync) ? (
          <section className="rounded-[var(--radius-card)] border border-line bg-wash-sun p-4 text-sm">
            <h3 className="font-semibold">Dados de outra conta neste dispositivo</h3>
            <p className="mt-1 text-ink-muted">
              {foreign.email} tem {foreign.pendingCount} alteração(ões) não sincronizada(s). Entre com essa conta para sincronizar, ou descarte-as.
            </p>
            <Button className="mt-3" variant="danger" size="sm" onClick={() => void act('foreign', () => sync.discardForeignAccountData(), 'Dados da outra conta removidos deste dispositivo.')}>
              Descartar dados da outra conta
            </Button>
          </section>
        ) : null}

        {ops.length === 0 && !foreign ? <p className="text-sm text-ink-muted">Nenhuma pendência. Tudo sincronizado.</p> : null}

        {conflicts.map((op) => {
          const local = op.localPayload as Record<string, unknown> | null;
          const remote = (op.remote ?? null) as Record<string, unknown> | null;
          const fields = comparableFields(local, remote);
          return (
            <section key={op.operationId} className="rounded-[var(--radius-card)] border border-[#f3b8b1] bg-surface p-4" aria-labelledby={`c-${op.operationId}`}>
              <h3 id={`c-${op.operationId}`} className="font-semibold">
                Conflito: {OPERATION_LABELS[op.type] ?? op.type}
              </h3>
              <p className="mt-1 text-sm text-ink-muted">Este registro foi alterado em outro dispositivo. Escolha qual versão manter.</p>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <VersionCard title="Sua versão (neste dispositivo)" obj={local} fields={fields} empty="Excluído neste dispositivo" />
                <VersionCard title="Versão do servidor" obj={remote} fields={fields} empty="Excluído no servidor" />
              </div>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <Button variant="secondary" pending={busy === op.operationId} onClick={() => void act(op.operationId, () => sync!.resolveKeepRemote(op.operationId), 'Versão do servidor mantida.')}>
                  Manter versão do servidor
                </Button>
                <Button variant="primary" pending={busy === op.operationId} onClick={() => void act(op.operationId, () => sync!.resolveReapplyLocal(op.operationId), 'Sua edição será reaplicada sobre a versão atual.')}>
                  Reaplicar minha edição
                </Button>
              </div>
            </section>
          );
        })}

        {errors.map((op) => (
          <section key={op.operationId} className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
            <h3 className="font-semibold">Não aceito pelo servidor: {OPERATION_LABELS[op.type] ?? op.type}</h3>
            <p className="mt-1 text-sm text-danger">{op.error?.message ?? 'Erro ao sincronizar.'}</p>
            {op.error?.fieldErrors ? (
              <ul className="mt-1 list-disc pl-5 text-sm text-ink-muted">
                {Object.entries(op.error.fieldErrors).map(([k, v]) => (
                  <li key={k}>
                    {FIELD_LABELS[k] ?? k}: {v.join(', ')}
                  </li>
                ))}
              </ul>
            ) : null}
            <VersionCard title="Dados salvos neste dispositivo" obj={op.localPayload as Record<string, unknown>} fields={comparableFields(op.localPayload)} empty="—" />
            <p className="mt-2 text-sm text-ink-muted">Corrija registrando novamente com os valores certos e descarte esta alteração.</p>
            <Button className="mt-2" variant="danger" size="sm" pending={busy === op.operationId} onClick={() => void act(op.operationId, () => sync!.discardOperation(op.operationId), 'Alteração descartada.')}>
              Descartar esta alteração
            </Button>
          </section>
        ))}

        {pending.length > 0 ? (
          <section>
            <h3 className="font-semibold">Salvo neste dispositivo — aguardando envio</h3>
            <ul className="mt-2 divide-y divide-line rounded-[var(--radius-card)] border border-line bg-surface text-sm">
              {pending.map((op) => (
                <li key={op.operationId} className="flex items-center justify-between gap-2 p-3">
                  <span>{OPERATION_LABELS[op.type] ?? op.type}</span>
                  <span className="text-ink-muted">{new Date(op.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span>
                </li>
              ))}
            </ul>
            {status?.online ? (
              <Button className="mt-3" variant="primary" onClick={() => void act('sync', () => sync!.syncNow(), 'Sincronização concluída.')} pending={busy === 'sync'}>
                Sincronizar agora
              </Button>
            ) : (
              <p className="mt-2 text-sm text-ink-muted">Offline: serão enviadas quando a conexão voltar.</p>
            )}
          </section>
        ) : null}
      </div>
    </Dialog>
  );
}

function VersionCard({ title, obj, fields, empty }: { title: string; obj: Record<string, unknown> | null; fields: string[]; empty: string }) {
  return (
    <div className="rounded-[var(--radius-field)] bg-surface-muted p-3 text-sm">
      <p className="font-semibold">{title}</p>
      {obj ? (
        <dl className="mt-2 space-y-1">
          {fields.map((f) => (
            <div key={f} className="flex flex-wrap justify-between gap-x-3">
              <dt className="text-ink-muted">{FIELD_LABELS[f] ?? f}</dt>
              <dd className="font-medium">{formatField(f, obj[f])}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-2 text-ink-muted">{empty}</p>
      )}
    </div>
  );
}
