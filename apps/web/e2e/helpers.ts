import { expect, type Page } from '@playwright/test';

export const PASSWORD = 'senha-segura-123';

export function uniqueEmail(prefix = 'e2e') {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

/** Creates an account through the API (shares the cookie jar with `page`) and opens /hoje. */
export async function signUpViaApi(page: Page, displayName = 'Teste E2E') {
  const request = page.request;
  const csrfRes = await request.get('/api/v1/auth/csrf');
  expect(csrfRes.ok()).toBeTruthy();
  const state = await page.context().storageState();
  const body = (await csrfRes.json().catch(() => ({}))) as { csrfToken?: string };
  const token = state.cookies.find((c) => c.name === 'zelo_csrf')?.value ?? body.csrfToken ?? '';
  const email = uniqueEmail();
  const res = await request.post('/api/v1/auth/sign-up', {
    headers: { 'x-csrf-token': token },
    data: { email, password: PASSWORD, displayName, timezone: 'America/Sao_Paulo' },
  });
  expect(res.status(), await res.text()).toBeLessThan(300);
  await page.goto('/hoje');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(displayName);
  return email;
}

export const APP_PAGES = ['/hoje', '/corpo', '/corpo?aba=medidas', '/pressao', '/rotina', '/rotina?aba=itens', '/configuracoes'];
export const PUBLIC_PAGES = ['/entrar', '/criar-conta', '/recuperar-acesso'];
