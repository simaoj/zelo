import { Logo } from '@/shared/ui/Logo';

export function Splash({ message = 'Carregando…' }: { message?: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background px-4">
      <Logo height={48} priority />
      <p role="status" className="text-sm text-ink-muted">
        {message}
      </p>
    </div>
  );
}
