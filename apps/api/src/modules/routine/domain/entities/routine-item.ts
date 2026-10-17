import { ValidationError } from '../../../../shared/domain/errors.js';
import { canonicalDose, canonicalUnit } from '../value-objects/dose.js';

export const ROUTINE_ITEM_TYPES = ['medication', 'vitamin', 'supplement'] as const;
export type RoutineItemType = (typeof ROUTINE_ITEM_TYPES)[number];

export interface RoutineItem {
  id: string;
  userId: string;
  name: string;
  type: RoutineItemType;
  /** canonical decimal string */
  currentDose: string;
  currentUnit: string;
  instructions: string | null;
  archivedAt: Date | null;
  currentScheduleVersionId: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export function validateName(raw: string): string {
  const name = raw.trim();
  if (name.length === 0) throw new ValidationError('Nome obrigatório', { name: ['Nome obrigatório'] });
  if (name.length > 120) throw new ValidationError('Nome muito longo', { name: ['Use até 120 caracteres'] });
  return name;
}

export function validateInstructions(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const v = raw.trim();
  if (v.length > 1000) throw new ValidationError('Texto muito longo', { instructions: ['Use até 1000 caracteres'] });
  return v.length === 0 ? null : v;
}

export function validateType(raw: string): RoutineItemType {
  if (!(ROUTINE_ITEM_TYPES as readonly string[]).includes(raw)) {
    throw new ValidationError('Tipo inválido', { type: ['Escolha medicamento, vitamina ou suplemento'] });
  }
  return raw as RoutineItemType;
}

export function createRoutineItem(input: {
  id: string;
  userId: string;
  name: string;
  type: string;
  dose: string;
  unit: string;
  instructions?: string | null;
  now: Date;
}): RoutineItem {
  return {
    id: input.id,
    userId: input.userId,
    name: validateName(input.name),
    type: validateType(input.type),
    currentDose: canonicalDose(input.dose),
    currentUnit: canonicalUnit(input.unit),
    instructions: validateInstructions(input.instructions),
    archivedAt: null,
    currentScheduleVersionId: null,
    version: 0,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function editRoutineItem(
  item: RoutineItem,
  patch: { name?: string | undefined; type?: string | undefined; instructions?: string | null | undefined },
  now: Date,
): RoutineItem {
  return {
    ...item,
    name: patch.name !== undefined ? validateName(patch.name) : item.name,
    type: patch.type !== undefined ? validateType(patch.type) : item.type,
    instructions: patch.instructions !== undefined ? validateInstructions(patch.instructions) : item.instructions,
    version: item.version + 1,
    updatedAt: now,
  };
}

export function assertNotArchived(item: RoutineItem): void {
  if (item.archivedAt) {
    throw new ValidationError('Este item está arquivado', { item: ['Este item está arquivado'] });
  }
}

export function archiveRoutineItem(item: RoutineItem, now: Date): RoutineItem {
  assertNotArchived(item);
  return { ...item, archivedAt: now, version: item.version + 1, updatedAt: now };
}
