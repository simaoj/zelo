/**
 * Admin script for Health Auto Export integration tokens (no UI by design).
 *
 *   pnpm --filter @zelo/api integration-token create --email <e-mail> [--label <label>]
 *   pnpm --filter @zelo/api integration-token list   --email <e-mail>
 *   pnpm --filter @zelo/api integration-token revoke --id <token id>
 *   docker compose exec api node apps/api/dist/bootstrap/integration-token.js <same arguments>
 *
 * The raw token is printed ONCE by `create` (only its SHA-256 hash is stored). `list` never shows tokens.
 */
import { loadConfig } from './config.js';
import { createContainer } from './container.js';

const USAGE = `Uso:
  integration-token create --email <e-mail> [--label <rótulo>]
  integration-token list   --email <e-mail>
  integration-token revoke --id <id do token>`;

function args(argv: string[]): { cmd: string | undefined; opts: Record<string, string> } {
  const [cmd, ...rest] = argv;
  const opts: Record<string, string> = {};
  for (let i = 0; i < rest.length; i += 1) {
    const k = rest[i]!;
    if (!k.startsWith('--')) throw new Error(`argumento inesperado: ${k}`);
    const v = rest[i + 1];
    if (v === undefined || v.startsWith('--')) throw new Error(`faltou valor para ${k}`);
    opts[k.slice(2)] = v;
    i += 1;
  }
  return { cmd, opts };
}

function need(opts: Record<string, string>, key: string): string {
  const v = opts[key];
  if (!v) throw new Error(`--${key} é obrigatório\n\n${USAGE}`);
  return v;
}

async function main() {
  const { cmd, opts } = args(process.argv.slice(2));
  if (!cmd || !['create', 'list', 'revoke'].includes(cmd)) {
    console.log(USAGE);
    process.exit(cmd ? 2 : 0);
  }
  const config = { ...loadConfig(), logLevel: 'silent' };
  const container = await createContainer(config);
  try {
    await container.ensureIndexes();
    const t = container.integrationTokens;
    if (cmd === 'create') {
      const { token, credential } = await t.create.execute({ email: need(opts, 'email'), ...(opts.label ? { label: opts.label } : {}) });
      console.log(`Token criado (id ${credential.id}, rótulo "${credential.label}").`);
      console.log('Copie agora — ele NÃO será exibido novamente:\n');
      console.log(token);
      console.log('\nNo Auto Export, adicione o header:  Authorization: Bearer <token>');
    } else if (cmd === 'list') {
      const list = await t.list.execute({ email: need(opts, 'email') });
      if (!list.length) console.log('Nenhum token para este usuário.');
      for (const c of list) {
        const status = c.revokedAt ? `revogado em ${c.revokedAt}` : 'ativo';
        console.log(`${c.id}  ${status}  criado ${c.createdAt}  último uso ${c.lastUsedAt ?? '—'}  "${c.label}"`);
      }
    } else {
      const c = await t.revoke.execute({ id: need(opts, 'id') });
      console.log(`Token ${c.id} revogado em ${c.revokedAt}.`);
    }
  } finally {
    await container.close();
  }
}

main().catch((err) => {
  console.error('integration-token:', err instanceof Error ? err.message : err);
  process.exit(1);
});
