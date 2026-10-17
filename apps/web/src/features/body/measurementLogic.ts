import { MEASUREMENT_LABELS, SIDED_TYPES, SIDE_LABELS, type MeasurementSession, type MeasurementType, type MeasurementValue, type Side } from '@zelo/contracts';
import { normalizeDecimal } from '@/shared/lib/decimal';

export interface MeasurementRow {
  key: string;
  type: MeasurementType;
  side: Side;
  /** raw user input (may use comma) */
  value: string;
}

export const ORDERED_TYPES: MeasurementType[] = ['waist', 'abdomen', 'hip', 'chest', 'arm', 'thigh'];

export function isSided(type: MeasurementType) {
  return SIDED_TYPES.includes(type);
}

export function defaultRows(): MeasurementRow[] {
  return ORDERED_TYPES.map((type) => ({ key: type, type, side: 'unspecified', value: '' }));
}

export function rowsFromSession(session: MeasurementSession): MeasurementRow[] {
  const rows = defaultRows();
  for (const v of session.values) {
    const blank = rows.find((r) => r.type === v.type && r.value === '');
    const valueStr = v.valueCm.replace('.', ',');
    if (blank) {
      blank.side = v.side;
      blank.value = valueStr;
    } else {
      rows.push({ key: `${v.type}-${v.side}-${rows.length}`, type: v.type, side: v.side, value: valueStr });
    }
  }
  return sortRows(rows);
}

export function sortRows(rows: MeasurementRow[]) {
  return [...rows].sort((a, b) => ORDERED_TYPES.indexOf(a.type) - ORDERED_TYPES.indexOf(b.type));
}

export type BuildResult =
  | { ok: true; values: MeasurementValue[] }
  | { ok: false; formError?: string; rowErrors: Record<string, string> };

/**
 * Builds the contract `values` array. Empty fields are OMITTED (never sent as 0);
 * at least one measurement is required; type+side must be unique.
 */
export function buildMeasurementValues(rows: MeasurementRow[]): BuildResult {
  const rowErrors: Record<string, string> = {};
  const values: MeasurementValue[] = [];
  const seen = new Map<string, string>();
  for (const r of rows) {
    if (r.value.trim() === '') continue;
    const n = normalizeDecimal(r.value, 2);
    if (!n.ok) {
      rowErrors[r.key] = n.error;
      continue;
    }
    const side: Side = isSided(r.type) ? r.side : 'unspecified';
    const k = `${r.type}:${side}`;
    if (seen.has(k)) {
      rowErrors[r.key] = 'Esta medida e lado já foram informados';
      continue;
    }
    seen.set(k, r.key);
    values.push({ type: r.type, side, valueCm: n.value });
  }
  if (Object.keys(rowErrors).length) return { ok: false, rowErrors };
  if (values.length === 0) return { ok: false, formError: 'Informe pelo menos uma medida.', rowErrors };
  return { ok: true, values };
}

export function measurementLabel(type: MeasurementType, side: Side): string {
  return side === 'unspecified' ? MEASUREMENT_LABELS[type] : `${MEASUREMENT_LABELS[type]} ${SIDE_LABELS[side]}`;
}

/**
 * For a chosen type+side, returns the series ascending by measuredAt (only sessions
 * that contain exactly that type and side — never mixes waist/abdomen or sides).
 */
export function seriesFor(sessions: MeasurementSession[], type: MeasurementType, side: Side) {
  return sessions
    .flatMap((s) => {
      const v = s.values.find((x) => x.type === type && x.side === side);
      return v ? [{ id: s.id, measuredAt: s.measuredAt, valueCm: v.valueCm }] : [];
    })
    .sort((a, b) => a.measuredAt.localeCompare(b.measuredAt));
}

/** Distinct type+side combos present in sessions, in display order. */
export function availableCombos(sessions: MeasurementSession[]): { type: MeasurementType; side: Side }[] {
  const set = new Map<string, { type: MeasurementType; side: Side }>();
  for (const s of sessions) for (const v of s.values) set.set(`${v.type}:${v.side}`, { type: v.type, side: v.side });
  const sideOrder: Side[] = ['unspecified', 'left', 'right'];
  return [...set.values()].sort(
    (a, b) => ORDERED_TYPES.indexOf(a.type) - ORDERED_TYPES.indexOf(b.type) || sideOrder.indexOf(a.side) - sideOrder.indexOf(b.side),
  );
}
