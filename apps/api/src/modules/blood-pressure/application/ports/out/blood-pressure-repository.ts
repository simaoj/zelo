import type { TxContext } from '../../../../../shared/application/ports.js';
import type { HistoryPage, HistoryParams } from '../../../../../shared/application/repository-errors.js';
import type { BloodPressureEntry } from '../../../domain/entities/blood-pressure-entry.js';

export interface BloodPressureRepository {
  findById(userId: string, id: string, tx?: TxContext): Promise<BloodPressureEntry | null>;
  insert(entry: BloodPressureEntry, tx: TxContext): Promise<void>;
  updateIfVersion(entry: BloodPressureEntry, expectedVersion: number, tx: TxContext): Promise<boolean>;
  page(userId: string, params: HistoryParams, tx?: TxContext): Promise<HistoryPage<BloodPressureEntry>>;
  latest(userId: string, limit: number, tx?: TxContext): Promise<BloodPressureEntry[]>;
  listLive(userId: string, tx?: TxContext): Promise<BloodPressureEntry[]>;
}
