'use client';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cx } from './cx';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  /** element to focus first (defaults to first focusable) */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  size?: 'md' | 'lg';
}

/**
 * Accessible modal: bottom sheet on mobile, centered modal on desktop (≥1024px).
 * Focus is trapped inside, Esc closes, focus returns to the trigger, background is inert.
 */
export function Dialog({ open, onClose, title, description, children, initialFocusRef, size = 'md' }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusFirst = () => {
      const target = initialFocusRef?.current ?? panel?.querySelector<HTMLElement>('[data-autofocus]') ?? panel?.querySelector<HTMLElement>(FOCUSABLE);
      (target ?? panel)?.focus();
    };
    focusFirst();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panel) return;
      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
      const list = items.length ? items : [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (list.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = list[0]!;
      const last = list[list.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !panel.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = overflow;
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus();
    };
  }, [open, initialFocusRef]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center lg:items-center lg:p-6">
      <div aria-hidden className="absolute inset-0 bg-[#2b1a10]/45" onClick={() => onCloseRef.current()} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cx(
          'relative z-10 flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[28px] bg-background shadow-float focus:outline-none',
          'lg:rounded-card',
          size === 'md' ? 'lg:max-w-lg' : 'lg:max-w-2xl',
        )}
      >
        <div aria-hidden className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-line lg:hidden" />
        <div className="flex items-start justify-between gap-3 px-5 pb-2 pt-3 lg:pt-5">
          <div className="min-w-0">
            <h2 id={titleId} className="font-display text-[22px] font-semibold leading-tight text-ink">
              {title}
            </h2>
            {description && (
              <p id={descId} className="mt-0.5 text-sm text-ink-muted">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => onCloseRef.current()}
            className="-mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-surface-muted"
          >
            <X aria-hidden className="size-5" />
            <span className="sr-only">Fechar</span>
          </button>
        </div>
        <div className="overflow-y-auto px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancelar',
  danger,
  pending,
  error,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  pending?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog open={open} onClose={onClose} title={title} description={description} initialFocusRef={cancelRef}>
      {error && (
        <p role="alert" className="mb-3 rounded-field bg-danger-wash/60 px-3 py-2 text-sm text-[#7a0f0f]">
          {error}
        </p>
      )}
      <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
        <button
          ref={cancelRef}
          type="button"
          onClick={onClose}
          className="min-h-11 rounded-[14px] border border-line bg-surface px-4 text-sm font-semibold text-ink hover:bg-surface-muted"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={pending}
          className={cx(
            'min-h-11 rounded-[14px] px-4 text-sm font-semibold disabled:opacity-60',
            danger ? 'bg-danger text-white hover:bg-[#9a1414]' : 'bg-brand-orange text-ink hover:bg-brand-orange-strong',
          )}
        >
          {pending ? 'Aguarde…' : confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}
