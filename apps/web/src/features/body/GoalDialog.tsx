'use client';
import { useState } from 'react';
import type { WeightGoal } from '@zelo/contracts';
import { useZelo } from '@/shared/data/ZeloProvider';
import { useIntent } from '@/shared/data/intent';
import { useSubmit } from '@/shared/data/useSubmit';
import { normalizeDecimal } from '@/shared/lib/decimal';
import { Button } from '@/shared/ui/Button';
import { Dialog } from '@/shared/ui/Dialog';
import { FormError, TextField } from '@/shared/ui/Field';

/** Optional personal goal: create, edit or remove. No automatic recommendation. */
export function GoalDialog({ goal, onClose, onChanged }: { goal: WeightGoal | null; onClose: () => void; onChanged: () => void }) {
  const { data } = useZelo();
  const intent = useIntent();
  const save = useSubmit();
  const remove = useSubmit();
  const [value, setValue] = useState(goal ? goal.targetKg.replace('.', ',') : '');
  const [err, setErr] = useState<string>();
  const [confirmRemove, setConfirmRemove] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = normalizeDecimal(value, 2);
    setErr(n.ok ? undefined : n.error);
    if (!n.ok) return;
    const r = await save.run(() => data.putWeightGoal({ operationId: intent.current().operationId, targetKg: n.value }), {
      onServerError: () => intent.rotateOperation(),
    });
    if (r) {
      onChanged();
      onClose();
    }
  };

  return (
    <Dialog open onClose={onClose} title={goal ? 'Editar meta' : 'Definir meta'} description="A meta é pessoal e opcional. O Zelo não sugere valores.">
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <TextField label="Meta (kg)" required inputMode="decimal" suffix="kg" value={value} onChange={(e) => setValue(e.target.value)} error={err} />
        {save.error && <FormError>{save.error.message}</FormError>}
        {remove.error && <FormError>{remove.error.message}</FormError>}
        {confirmRemove ? (
          <div className="flex flex-col gap-2 rounded-field bg-wash-peach p-3">
            <p className="text-sm font-semibold">Remover a meta?</p>
            <div className="flex gap-2">
              <Button onClick={() => setConfirmRemove(false)}>Manter</Button>
              <Button
                variant="danger"
                pending={remove.pending}
                onClick={async () => {
                  const ok = await remove.run(async () => {
                    await data.deleteWeightGoal();
                    return true;
                  });
                  if (ok) {
                    onChanged();
                    onClose();
                  }
                }}
              >
                Remover meta
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            {goal ? (
              <Button variant="ghost" className="text-danger" onClick={() => setConfirmRemove(true)}>
                Remover meta
              </Button>
            ) : (
              <span />
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button onClick={onClose}>Cancelar</Button>
              <Button type="submit" variant="primary" pending={save.pending}>
                Salvar meta
              </Button>
            </div>
          </div>
        )}
      </form>
    </Dialog>
  );
}
