import { MEASUREMENT_LABELS, OCCURRENCE_STATE_LABELS, SIDE_LABELS, type MeasurementValue } from '@zelo/contracts';

export const OPERATION_LABELS: Record<string, string> = {
  'weight.create': 'Novo registro de peso',
  'weight.update': 'Edição de peso',
  'weight.delete': 'Exclusão de peso',
  'measurement.create': 'Novas medidas',
  'measurement.update': 'Edição de medidas',
  'measurement.delete': 'Exclusão de medidas',
  'bloodPressure.create': 'Nova medição de pressão',
  'bloodPressure.update': 'Edição de pressão',
  'bloodPressure.delete': 'Exclusão de pressão',
  'occurrence.intake.put': 'Registro de tomada',
  'occurrence.intake.delete': 'Tomada desfeita',
  'intake.create': 'Tomada avulsa',
};

export const FIELD_LABELS: Record<string, string> = {
  weightKg: 'Peso',
  measuredAt: 'Data e hora',
  notes: 'Observações',
  systolic: 'Sistólica',
  diastolic: 'Diastólica',
  pulseBpm: 'Pulso',
  values: 'Medidas',
  status: 'Situação',
  actualTakenAt: 'Horário da tomada',
  nameSnapshot: 'Item',
};

const HIDDEN = new Set(['id', 'version', 'createdAt', 'updatedAt', 'deltaKg', 'timezone', 'operationId', 'expectedVersion', 'intakeId', 'itemId', 'occurrenceId', 'doseSnapshot', 'unitSnapshot', 'confirmedUnusual']);

const dec = (v: string) => v.replace('.', ',');
const dateTime = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
};

export function formatField(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (key === 'weightKg') return `${dec(String(value))} kg`;
  if (key === 'measuredAt' || key === 'actualTakenAt') return dateTime(String(value));
  if (key === 'pulseBpm') return `${value} bpm`;
  if (key === 'systolic' || key === 'diastolic') return `${value} mmHg`;
  if (key === 'status') return OCCURRENCE_STATE_LABELS[value as keyof typeof OCCURRENCE_STATE_LABELS] ?? String(value);
  if (key === 'values' && Array.isArray(value))
    return (value as MeasurementValue[])
      .map((m) => `${MEASUREMENT_LABELS[m.type]}${m.side !== 'unspecified' ? ` (${SIDE_LABELS[m.side]})` : ''}: ${dec(m.valueCm)} cm`)
      .join('; ');
  return String(value);
}

/** Fields worth comparing for a local/remote pair, in a stable order. */
export function comparableFields(...objs: unknown[]): string[] {
  const keys = new Set<string>();
  for (const o of objs) if (o && typeof o === 'object') for (const k of Object.keys(o)) if (!HIDDEN.has(k)) keys.add(k);
  const order = Object.keys(FIELD_LABELS);
  return [...keys].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
}

export function hhmm(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
