'use client';
import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cx } from './cx';

const control =
  'w-full min-h-12 rounded-field border border-transparent bg-surface-muted px-3.5 text-base text-ink placeholder:text-[#8b7267] focus:border-brand-teal focus:bg-surface focus:outline-none focus-visible:outline-2 focus-visible:outline-brand-teal aria-[invalid=true]:border-danger aria-[invalid=true]:bg-danger-wash/40';

interface FieldShellProps {
  label: ReactNode;
  error?: string;
  hint?: ReactNode;
  optional?: boolean;
  required?: boolean;
  id: string;
  children: ReactNode;
  className?: string;
}

function FieldShell({ label, error, hint, optional, required, id, children, className }: FieldShellProps) {
  return (
    <div className={cx('flex min-w-0 flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-[13px] font-semibold text-ink">
        {label}
        {required && <span aria-hidden className="text-brand-orange-ink"> *</span>}
        {optional && <span className="font-normal text-ink-muted"> (opcional)</span>}
      </label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-ink-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs font-semibold text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function describedBy(id: string, error?: string, hint?: ReactNode) {
  return error ? `${id}-error` : hint ? `${id}-hint` : undefined;
}

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: ReactNode;
  error?: string;
  hint?: ReactNode;
  optional?: boolean;
  suffix?: string;
  containerClassName?: string;
}

export function TextField({ label, error, hint, optional, suffix, containerClassName, className, required, ...rest }: TextFieldProps) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} error={error} hint={hint} optional={optional} required={required} className={containerClassName}>
      <div className="relative">
        <input
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, error, hint)}
          required={required}
          className={cx(control, suffix && 'pr-14', 'tabular', className)}
          {...rest}
        />
        {suffix && (
          <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-sm font-semibold text-ink-muted">
            {suffix}
          </span>
        )}
      </div>
    </FieldShell>
  );
}

export interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  label: ReactNode;
  error?: string;
  hint?: ReactNode;
  optional?: boolean;
  containerClassName?: string;
}

export function SelectField({ label, error, hint, optional, containerClassName, className, children, required, ...rest }: SelectFieldProps) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} error={error} hint={hint} optional={optional} required={required} className={containerClassName}>
      <select
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
        required={required}
        className={cx(control, 'appearance-auto', className)}
        {...rest}
      >
        {children}
      </select>
    </FieldShell>
  );
}

export interface TextAreaFieldProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {
  label: ReactNode;
  error?: string;
  hint?: ReactNode;
  optional?: boolean;
  containerClassName?: string;
}

export function TextAreaField({ label, error, hint, optional, containerClassName, className, ...rest }: TextAreaFieldProps) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} error={error} hint={hint} optional={optional} className={containerClassName}>
      <textarea
        id={id}
        rows={2}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
        className={cx(control, 'py-3', className)}
        {...rest}
      />
    </FieldShell>
  );
}

export function Checkbox({
  label,
  description,
  className,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: ReactNode; description?: ReactNode }) {
  const id = useId();
  return (
    <div className={cx('flex min-h-11 items-start gap-3', className)}>
      <input id={id} type="checkbox" className="mt-0.5 size-5 shrink-0 accent-[#006a6a]" {...rest} />
      <label htmlFor={id} className="text-sm text-ink">
        <span className="font-semibold">{label}</span>
        {description && <span className="block text-xs text-ink-muted">{description}</span>}
      </label>
    </div>
  );
}

export function FormError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <div role="alert" className="rounded-field border border-danger/30 bg-danger-wash/60 px-3.5 py-2.5 text-sm font-medium text-[#7a0f0f]">
      {children}
    </div>
  );
}

export function FormSuccess({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <div role="status" className="rounded-field bg-brand-teal-wash px-3.5 py-2.5 text-sm font-medium text-brand-teal-ink">
      {children}
    </div>
  );
}
