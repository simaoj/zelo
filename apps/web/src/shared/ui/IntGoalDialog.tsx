'use client';
import { useState } from 'react';
import { useIntent } from '@/shared/data/intent';
import { useSubmit } from '@/shared/data/useSubmit';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { FormError, TextField } from './Field';

/**
 * Optional personal integer goal (water ml, daily steps): create, edit or remove.
 * The value always comes from the user — Zelo never suggests one.
 */
export function IntGoalDialog({
  title,
  label,
  unit,
  current,
  max,
  onSave,
  onRemove,
  onClose,
}: {
  title: string;
  label: string;
  unit: string;
  current: number | null;
  max: number;
  onSave: (value: number, operationId: string) => Promise<unknown>;
  onRemove: () => Promise<unknown>;
  onClose: () => void;
}) {
  const intent = useIntent();
  const save = useSubmit();
  const remove = useSubmit();
  const [value, setValue] = useState(current != null ? String(current) : '');
  const [err, setErr] = useState<string>();
  const [confirmRemove, setConfirmRemove] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = value.trim().replace(/\./g, '');
    let error: string | undefined;
    if (t === '') error = 'Informe um valor';
    else if (!/^\d+$/.test(t)) error = 'Use um número inteiro';
    else if (Number(t) <= 0) error = 'O valor deve ser maior que zero';
    else if (Number(t) > max) error = 'Valor muito grande';
    setErr(error);
    if (error) return;
    const ok = await save.run(
      async () => {
        await onSave(Number(t), intent.current().operationId);
        return true;
      },
      { onServerError: () => intent.rotateOperation() },
    );
    if (ok) onClose();
  };

  return (
    <Dialog open onClose={onClose} title={title} description="A meta é pessoal e opcional. O Zelo não sugere valores.">
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <TextField label={label} required inputMode="numeric" autoComplete="off" suffix={unit} value={value} onChange={(e) => setValue(e.target.value)} error={err} data-autofocus />
        {save.error && <FormError>{save.error.message}</FormError>}
        {remove.error && <FormError>{remove.error.message}</FormError>}
        {confirmRemove ? (
          <div className="flex flex-col gap-2 rounded-field bg-wash-peach p-3">
            <p className="text-sm font-semibold">Remover a meta?</p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setConfirmRemove(false)}>Manter</Button>
              <Button
                variant="danger"
                pending={remove.pending}
                onClick={async () => {
                  const ok = await remove.run(async () => {
                    await onRemove();
                    return true;
                  });
                  if (ok) onClose();
                }}
              >
                Remover meta
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            {current != null ? (
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
