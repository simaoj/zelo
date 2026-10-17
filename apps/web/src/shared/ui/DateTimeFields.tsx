'use client';
import { localDateOf, localTimeOf, todayIn, zonedToUtc, isFutureInstant } from '@/shared/lib/time';
import { TextField } from './Field';

export interface DateTimeValue {
  date: string;
  time: string;
}

export function nowInTz(tz: string): DateTimeValue {
  const now = new Date();
  return { date: localDateOf(now, tz), time: localTimeOf(now, tz) };
}

export function fromInstant(iso: string, tz: string): DateTimeValue {
  return { date: localDateOf(iso, tz), time: localTimeOf(iso, tz) };
}

/** Local date+time (profile tz) → UTC ISO; rejects future instants. */
export function resolveInstant(v: DateTimeValue, tz: string): { ok: true; iso: string } | { ok: false; error: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date)) return { ok: false, error: 'Informe a data' };
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v.time)) return { ok: false, error: 'Informe o horário' };
  const instant = zonedToUtc(v.date, v.time, tz);
  if (isFutureInstant(instant)) return { ok: false, error: 'A data e o horário não podem estar no futuro' };
  return { ok: true, iso: instant.toISOString() };
}

export function DateTimeFields({
  value,
  onChange,
  tz,
  error,
  dateLabel = 'Data',
  timeLabel = 'Horário',
}: {
  value: DateTimeValue;
  onChange: (v: DateTimeValue) => void;
  tz: string;
  error?: string;
  dateLabel?: string;
  timeLabel?: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <TextField
        label={dateLabel}
        type="date"
        required
        value={value.date}
        max={todayIn(tz)}
        onChange={(e) => onChange({ ...value, date: e.target.value })}
        error={error}
      />
      <TextField
        label={timeLabel}
        type="time"
        required
        value={value.time}
        onChange={(e) => onChange({ ...value, time: e.target.value })}
        aria-invalid={error ? true : undefined}
      />
    </div>
  );
}
