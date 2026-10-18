import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { signUpViaApi } from './helpers';

const TZ = 'America/Sao_Paulo';
const ACTIVITY_EMPTY_TITLE = 'Nenhum dado de atividade recebido ainda.';
const ACTIVITY_EMPTY_TEXT = 'Seus passos e exercícios aparecerão aqui após o recebimento dos dados do Auto Export.';

function localDate(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

async function noHorizontalScroll(page: Page, label: string) {
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
    expect(scrollWidth, `${label} @ ${width}px`).toBeLessThanOrEqual(innerWidth);
  }
}

test('old /pressao link opens Saúde → Pressão', async ({ page }) => {
  await signUpViaApi(page);
  await page.goto('/pressao');
  await expect(page).toHaveURL(/\/saude\/pressao$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Pressão arterial' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Seções de saúde' }).getByRole('link', { name: 'Água' })).toBeVisible();
});

test('water quick add saves immediately and can be undone', async ({ page }) => {
  await signUpViaApi(page);
  await page.goto('/saude/agua');
  await expect(page.getByText('Sem registros de água neste dia.')).toBeVisible();
  await page.getByRole('button', { name: 'Registrar 300 ml agora' }).click();
  await expect(page.getByText('+300 ml registrado')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Registros de hoje' })).toBeVisible();
  await expect(page.locator('li', { hasText: '300 ml' }).first()).toBeVisible();
  await expect(page.locator('span', { hasText: 'Total: 300 ml' })).toBeVisible();

  await page.getByRole('button', { name: 'Desfazer' }).click();
  await expect(page.getByText('Registro desfeito')).toBeVisible();
  await expect(page.getByText('Sem registros de água neste dia.')).toBeVisible();
  await expect(page.getByText('Total: 300 ml')).toHaveCount(0);
});

test('custom water entry: create, edit, delete; personal goal set and removed', async ({ page }) => {
  await signUpViaApi(page);
  await page.goto('/saude/agua');

  await page.getByRole('button', { name: 'Outra quantidade ou horário' }).click();
  const dialog = page.getByRole('dialog', { name: 'Registrar água' });
  await dialog.getByLabel(/Quantidade/).fill('250,5');
  await dialog.getByRole('button', { name: 'Registrar água' }).click();
  await expect(dialog.getByText(/número inteiro de ml/)).toBeVisible();
  await dialog.getByLabel(/Quantidade/).fill('450');
  await dialog.getByRole('button', { name: 'Registrar água' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('span', { hasText: 'Total: 450 ml' })).toBeVisible();

  await page.getByRole('button', { name: /^Editar 450 ml/ }).click();
  const edit = page.getByRole('dialog', { name: 'Editar registro de água' });
  await edit.getByLabel(/Quantidade/).fill('600');
  await edit.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(edit).toBeHidden();
  await expect(page.locator('span', { hasText: 'Total: 600 ml' })).toBeVisible();

  await page.getByRole('button', { name: /^Excluir 600 ml/ }).click();
  await page.getByRole('dialog', { name: /Excluir este registro de água/ }).getByRole('button', { name: 'Excluir' }).click();
  await expect(page.getByText('Sem registros de água neste dia.')).toBeVisible();

  // goal: optional, user-defined, removable
  await page.getByRole('button', { name: 'Definir meta' }).click();
  const goal = page.getByRole('dialog', { name: /Definir meta pessoal de água/ });
  await goal.getByLabel(/Meta diária/).fill('2000');
  await goal.getByRole('button', { name: 'Salvar meta' }).click();
  await expect(goal).toBeHidden();
  await expect(page.getByText('Meta pessoal: 2.000 ml').first()).toBeVisible();
  await page.getByRole('button', { name: 'Ajustar' }).click();
  const adjust = page.getByRole('dialog', { name: /Ajustar meta pessoal de água/ });
  await adjust.getByRole('button', { name: 'Remover meta' }).click();
  await adjust.getByRole('button', { name: 'Remover meta' }).click();
  await expect(adjust).toBeHidden();
  await expect(page.getByText('Nenhuma meta pessoal definida')).toBeVisible();
  await expect(page.getByText(/recomendad/i)).toHaveCount(0);
});

test('Atividade shows the empty state for a fresh user and has no import/sync controls', async ({ page }) => {
  await signUpViaApi(page);
  for (const p of ['/atividade/resumo', '/atividade/passos', '/atividade/exercicios']) {
    await page.goto(p);
    await expect(page.getByText(ACTIVITY_EMPTY_TITLE), p).toBeVisible();
    await expect(page.getByText(ACTIVITY_EMPTY_TEXT), p).toBeVisible();
    await expect(page.getByRole('button', { name: /importar|sincronizar|testar conex/i }), p).toHaveCount(0);
  }
  await page.goto('/hoje');
  await expect(page.getByText(ACTIVITY_EMPTY_TITLE)).toBeVisible();
  await expect(page.getByText(/iPhone/)).toHaveCount(0);
});

function createIntegrationToken(email: string): string | { skip: string } {
  let root = process.cwd();
  while (!existsSync(path.join(root, 'docker-compose.yml')) && path.dirname(root) !== root) root = path.dirname(root);
  try {
    const out = execFileSync('docker', ['compose', 'exec', '-T', 'api', 'node', 'apps/api/dist/bootstrap/integration-token.js', 'create', '--email', email], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
    });
    const token = out
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length >= 20 && !/\s/.test(l));
    return token ?? { skip: `integration-token script printed no token: ${out.slice(0, 200)}` };
  } catch (e) {
    return { skip: `could not run the integration-token script via docker compose: ${(e as Error).message.split('\n')[0]}` };
  }
}

test('received Auto Export data (steps + workout v2) renders read-only in Atividade and Hoje', async ({ page }) => {
  const email = await signUpViaApi(page);
  const token = createIntegrationToken(email);
  test.skip(typeof token !== 'string', typeof token === 'string' ? '' : token.skip);
  const auth = { Authorization: `Bearer ${token as string}` };
  const today = localDate();
  const yesterday = localDate(-1);
  const workoutId = randomUUID();

  const steps = { data: { metrics: [{ name: 'step_count', units: 'count', data: [{ date: `${today} 00:00:00 -0300`, qty: 6842 }] }] } };
  const workouts = {
    data: {
      workouts: [
        {
          id: workoutId,
          name: 'Running',
          start: `${yesterday} 07:00:00 -0300`,
          end: `${yesterday} 07:30:00 -0300`,
          duration: 1800,
          distance: { qty: 4.2, units: 'km' },
          activeEnergyBurned: { qty: 310, units: 'kcal' },
        },
      ],
    },
  };
  const r1 = await page.request.post('/api/v1/imports/health', { headers: auth, data: steps });
  expect(r1.status(), await r1.text()).toBe(200);
  expect((await r1.json()).steps.inserted).toBe(1);
  const r2 = await page.request.post('/api/v1/imports/health', { headers: auth, data: workouts });
  expect(r2.status(), await r2.text()).toBe(200);
  expect((await r2.json()).workouts.inserted).toBe(1);
  // re-sending is safe
  const r3 = await page.request.post('/api/v1/imports/health', { headers: auth, data: workouts });
  expect((await r3.json()).workouts).toEqual({ inserted: 0, updated: 0, unchanged: 1 });
  // invalid token
  const bad = await page.request.post('/api/v1/imports/health', { headers: { Authorization: 'Bearer invalido' }, data: steps });
  expect(bad.status()).toBe(401);

  await page.goto('/atividade/passos');
  await expect(page.getByText('Parcial (hoje)')).toBeVisible();
  await expect(page.locator('li', { hasText: 'Parcial (hoje)' })).toContainText('6.842 passos');
  await expect(page.getByText('Sem dados').first()).toBeVisible();
  await expect(page.getByText(/Dados recebidos hoje às \d\d:\d\d/)).toBeVisible();
  await noHorizontalScroll(page, '/atividade/passos (with data)');
  await page.setViewportSize({ width: 1280, height: 800 });

  await page.goto('/atividade/exercicios');
  const card = page.getByRole('link', { name: /Corrida/ });
  await expect(card).toContainText('30 min');
  await expect(card).toContainText('4,2 km');
  await expect(card).toContainText('310 kcal ativas');
  await card.click();
  // Zelo assigns its own id; the exported id is only the dedup key
  await expect(page).toHaveURL(/\/atividade\/exercicios\/detalhe\?id=[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Corrida' })).toBeVisible();
  await expect(page.getByText('Origem: Health Auto Export')).toBeVisible();
  await expect(page.getByText(/Recebido em \d\d\/\d\d\/\d{4} às/)).toBeVisible();
  await noHorizontalScroll(page, 'workout details');
  await page.setViewportSize({ width: 1280, height: 800 });

  await page.goto('/hoje');
  await expect(page.getByText('6.842')).toBeVisible();
  await expect(page.getByText(/Dados recebidos hoje às \d\d:\d\d • Parcial do dia/)).toBeVisible();
});
