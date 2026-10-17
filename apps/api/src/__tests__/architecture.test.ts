import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Hexagonal boundaries (spec §2): modules/<m>/domain and modules/<m>/application must not
 * depend on frameworks, drivers, adapters, the composition root, or other modules.
 */
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MODULES = join(SRC, 'modules');

const FRAMEWORK = [/^fastify/, /^@fastify\//, /^mongodb/, /^fastify-type-provider-zod/, /^nodemailer/, /^argon2/, /^web-push/, /^pino/];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') && !p.endsWith('.test.ts') ? [p] : [];
  });
}

function imports(file: string): { spec: string; typeOnly: boolean }[] {
  const src = readFileSync(file, 'utf8');
  const out: { spec: string; typeOnly: boolean }[] = [];
  const re = /(?:^|\n)\s*(import|export)\s+(type\s+)?[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g;
  for (const m of src.matchAll(re)) {
    const spec = m[3] ?? m[4] ?? m[5];
    if (spec) out.push({ spec, typeOnly: !!m[2] });
  }
  return out;
}

const layers: { module: string; layer: 'domain' | 'application'; files: string[] }[] = [];
for (const mod of readdirSync(MODULES)) {
  for (const layer of ['domain', 'application'] as const) {
    const dir = join(MODULES, mod, layer);
    try {
      if (statSync(dir).isDirectory()) layers.push({ module: mod, layer, files: walk(dir) });
    } catch {
      /* layer absent */
    }
  }
}

function violations(module: string, layer: 'domain' | 'application', file: string): string[] {
  const errs: string[] = [];
  for (const { spec } of imports(file)) {
    const where = `${relative(SRC, file)} → ${spec}`;
    if (FRAMEWORK.some((r) => r.test(spec))) errs.push(`framework/driver import: ${where}`);
    if (layer === 'domain' && (spec === 'zod' || spec.startsWith('@zelo/contracts'))) errs.push(`domain imports transport schemas: ${where}`);
    if (!spec.startsWith('.')) continue;
    const target = resolve(dirname(file), spec);
    const rel = relative(SRC, target).split(sep);
    if (rel.includes('adapters')) errs.push(`adapter import: ${where}`);
    if (rel[0] === 'bootstrap') errs.push(`composition-root import: ${where}`);
    if (rel[0] === 'shared' && rel[1] === 'http') errs.push(`HTTP layer import: ${where}`);
    if (rel[0] === 'modules' && rel[1] !== module) errs.push(`other module import: ${where}`);
    if (layer === 'domain' && rel[0] === 'modules' && rel[2] === 'application') errs.push(`domain → application: ${where}`);
  }
  return errs;
}

describe('architecture boundaries', () => {
  it('finds layers to check', () => {
    expect(layers.length).toBeGreaterThan(5);
  });
  for (const { module, layer, files } of layers) {
    it(`${module}/${layer} is free of frameworks, adapters and other modules`, () => {
      expect(files.flatMap((f) => violations(module, layer, f))).toEqual([]);
    });
  }
});
