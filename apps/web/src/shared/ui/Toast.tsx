'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';

export interface ToastInput {
  message: string;
  action?: { label: string; onClick: () => void | Promise<void> };
  /** ms; default 6000 (longer when there is an action) */
  duration?: number;
}

interface ToastItem extends ToastInput {
  id: number;
}

const ToastContext = createContext<(t: ToastInput) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const show = useCallback((t: ToastInput) => {
    const id = nextId.current++;
    setItems((xs) => [...xs.slice(-2), { ...t, id }]);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(6.5rem+env(safe-area-inset-bottom))] z-[90] flex flex-col items-center gap-2 px-4 lg:bottom-6 lg:left-auto lg:right-6 lg:items-end"
      >
        {items.map((t) => (
          <Toast key={t.id} item={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function Toast({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const t = setTimeout(onDismiss, item.duration ?? (item.action ? 10000 : 5000));
    return () => clearTimeout(t);
  }, [item, onDismiss]);
  return (
    <div role="status" className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-[16px] bg-[#30312e] px-4 py-2 text-sm text-white shadow-float">
      <span className="flex-1 py-1.5">{item.message}</span>
      {item.action && (
        <button
          type="button"
          disabled={busy}
          className="min-h-11 rounded-[12px] px-3 font-semibold text-brand-yellow underline-offset-2 hover:underline disabled:opacity-60"
          onClick={async () => {
            setBusy(true);
            try {
              await item.action!.onClick();
            } finally {
              onDismiss();
            }
          }}
        >
          {item.action.label}
        </button>
      )}
      <button type="button" onClick={onDismiss} className="inline-flex size-11 items-center justify-center rounded-full hover:bg-white/10">
        <X aria-hidden className="size-4" />
        <span className="sr-only">Dispensar aviso</span>
      </button>
    </div>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
