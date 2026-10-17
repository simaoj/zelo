'use client';
import { Pencil, Trash2 } from 'lucide-react';

export function RowActions({ label, onEdit, onDelete }: { label: string; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="flex shrink-0 items-center">
      <button type="button" onClick={onEdit} className="inline-flex size-11 items-center justify-center rounded-full text-ink hover:bg-surface-muted">
        <Pencil aria-hidden className="size-[18px]" />
        <span className="sr-only">Editar {label}</span>
      </button>
      <button type="button" onClick={onDelete} className="inline-flex size-11 items-center justify-center rounded-full text-danger hover:bg-danger-wash/60">
        <Trash2 aria-hidden className="size-[18px]" />
        <span className="sr-only">Excluir {label}</span>
      </button>
    </div>
  );
}
