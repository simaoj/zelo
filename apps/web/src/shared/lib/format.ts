/**
 * pt-BR number/duration formatting for water and activity (explicit units, comma decimals).
 */
import { formatShortDate, localDateOf, localTimeOf, todayIn, addDays, formatFullDate } from './time';

const intFmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

/** 1400 → "1.400" */
export function formatInt(n: number): string {
  return intFmt.format(Math.round(n));
}

/** 1400 → "1.400 ml" */
export function formatMl(ml: number): string {
  return `${formatInt(ml)} ml`;
}

/** 6842 → "6.842 passos"; 1 → "1 passo" */
export function formatSteps(n: number): string {
  return `${formatInt(n)} ${n === 1 ? 'passo' : 'passos'}`;
}

/** meters → "4,2 km" (one decimal ≥ 10 km, two below 1 km). */
export function formatDistance(meters: number): string {
  const km = meters / 1000;
  const digits = km < 1 ? 2 : 1;
  const s = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: digits }).format(km);
  return `${s} km`;
}

/** seconds → "35 min", "1 h 05 min", "2 h", "45 s" (under a minute). */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total} s`;
  const mins = Math.round(total / 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${String(m).padStart(2, '0')} min`;
}

/** kcal → "310 kcal ativas" */
export function formatActiveKcal(kcal: number): string {
  return `${formatInt(kcal)} kcal ativas`;
}

/** Percentage of a goal, rounded, never capped (values above 100% are real). */
export function percentOf(value: number, goal: number): number {
  if (!(goal > 0)) return 0;
  return Math.round((value / goal) * 100);
}

/** "18/10 às 14:30" (or "hoje às 14:30" / "ontem às 14:30") */
export function formatReceivedAt(instant: string, tz: string, now: Date = new Date()): string {
  const date = localDateOf(instant, tz);
  const time = localTimeOf(instant, tz);
  const today = todayIn(tz, now);
  if (date === today) return `hoje às ${time}`;
  if (date === addDays(today, -1)) return `ontem às ${time}`;
  const sameYear = date.slice(0, 4) === today.slice(0, 4);
  return `${sameYear ? formatShortDate(date) : formatFullDate(date)} às ${time}`;
}

const MODALITIES: Record<string, string> = {
  running: 'Corrida',
  'outdoor run': 'Corrida ao ar livre',
  'indoor run': 'Corrida em ambiente fechado',
  walking: 'Caminhada',
  'outdoor walk': 'Caminhada ao ar livre',
  'indoor walk': 'Caminhada em ambiente fechado',
  hiking: 'Trilha',
  cycling: 'Ciclismo',
  'outdoor cycling': 'Ciclismo ao ar livre',
  'indoor cycling': 'Ciclismo indoor',
  swimming: 'Natação',
  'pool swim': 'Natação em piscina',
  'open water swim': 'Natação em águas abertas',
  yoga: 'Yoga',
  pilates: 'Pilates',
  'strength training': 'Treino de força',
  'traditional strength training': 'Treino de força',
  'functional strength training': 'Treino funcional',
  'high intensity interval training': 'Treino intervalado (HIIT)',
  hiit: 'Treino intervalado (HIIT)',
  elliptical: 'Elíptico',
  rowing: 'Remo',
  'stair climbing': 'Escada',
  stairs: 'Escada',
  dance: 'Dança',
  'core training': 'Treino de core',
  'mixed cardio': 'Cardio misto',
  flexibility: 'Flexibilidade',
  'cooldown': 'Desaquecimento',
  'tennis': 'Tênis',
  'soccer': 'Futebol',
  'basketball': 'Basquete',
  'volleyball': 'Vôlei',
  'martial arts': 'Artes marciais',
  'boxing': 'Boxe',
  other: 'Outro',
};

/** Translates common Apple Health workout names to pt-BR; unknown names are shown as exported. */
export function modalityLabel(name: string): string {
  const key = name.trim().toLowerCase().replace(/\s+/g, ' ');
  return MODALITIES[key] ?? name;
}
