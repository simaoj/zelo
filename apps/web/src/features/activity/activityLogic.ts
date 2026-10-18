import type { StepsDay } from '@zelo/contracts';
import { formatReceivedAt, formatSteps } from '@/shared/lib/format';

export const ACTIVITY_EMPTY_TITLE = 'Nenhum dado de atividade recebido ainda.';
export const ACTIVITY_EMPTY_TEXT = 'Seus passos e exercícios aparecerão aqui após o recebimento dos dados do Auto Export.';
export const STEPS_GOAL_MAX = 200000;

/** Distinguishes "no data" from a reported zero and from today's partial total. */
export function stepsDayStatus(day: Pick<StepsDay, 'count' | 'partial'>): { kind: 'absent' | 'zero' | 'value'; text: string; partial: boolean } {
  if (day.count == null) return { kind: 'absent', text: 'Sem dados', partial: day.partial };
  if (day.count === 0) return { kind: 'zero', text: '0 passos informados', partial: day.partial };
  return { kind: 'value', text: formatSteps(day.count), partial: day.partial };
}

/** "Dados recebidos em 18/10 às 14:30" / "Dados recebidos hoje às 14:30" */
export function receivedLine(instant: string, tz: string, now?: Date): string {
  const s = formatReceivedAt(instant, tz, now);
  return /^(hoje|ontem)/.test(s) ? `Dados recebidos ${s}` : `Dados recebidos em ${s}`;
}

export const PROVIDER_LABEL: Record<string, string> = { 'health-auto-export': 'Health Auto Export' };
