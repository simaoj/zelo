import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

/** Synthetic examples from docs/specs/agua-atividade.md §5 (fictitious data). Fresh deep copy per call. */
export function fixture(name: 'steps' | 'workout-v2' | 'combined'): { data: { metrics?: Record<string, unknown>[]; workouts?: Record<string, unknown>[] } } {
  return JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8'));
}
