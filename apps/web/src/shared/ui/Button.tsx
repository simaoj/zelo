'use client';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';
import { cx } from './cx';

type Variant = 'primary' | 'secondary' | 'ghost' | 'teal' | 'danger' | 'soft';

const variants: Record<Variant, string> = {
  // dark text on orange for contrast (never white on #FF8243)
  primary: 'bg-brand-orange text-ink shadow-[0_4px_14px_rgba(255,130,67,0.28)] hover:bg-brand-orange-strong',
  secondary: 'bg-surface text-ink border border-line hover:bg-surface-muted',
  soft: 'bg-surface-muted text-ink hover:bg-[#ece8e1]',
  ghost: 'bg-transparent text-ink hover:bg-surface-muted',
  teal: 'bg-brand-teal-ink text-white hover:bg-[#005555]',
  danger: 'bg-danger text-white hover:bg-[#9a1414]',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'md' | 'sm' | 'lg';
  pending?: boolean;
  icon?: ReactNode;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', pending, icon, block, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={cx(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-[14px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        size === 'sm' && 'px-3 text-[13px]',
        size === 'md' && 'px-4 text-sm',
        size === 'lg' && 'min-h-12 px-5 text-[15px]',
        block && 'w-full',
        variants[variant],
        className,
      )}
      {...rest}
    >
      {pending ? <LoaderCircle aria-hidden className="size-[18px] animate-spin" /> : icon}
      {children}
    </button>
  );
});
