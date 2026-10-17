import { expect, test } from '@playwright/test';
import { signUpViaApi } from './helpers';

test('blood pressure with empty pulse is saved with pulse null', async ({ page }) => {
  await signUpViaApi(page);
  await page.goto('/pressao');
  await expect(page.getByText('Seus registros ajudam no acompanhamento com um profissional de saúde.').first()).toBeVisible();
  const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Registrar pressão' }) });
  await form.getByLabel(/Sistólica/).fill('121');
  await form.getByLabel(/Diastólica/).fill('79');
  await form.getByRole('button', { name: 'Registrar pressão' }).click();
  const history = page.locator('section[aria-labelledby="pa-historico"]');
  await expect(history.getByText('121 / 79')).toBeVisible();
  await expect(history.getByText('Sem pulso')).toBeVisible();

  const res = await page.request.get('/api/v1/blood-pressure');
  const body = (await res.json()) as { items: { systolic: number; pulseBpm: number | null }[] };
  expect(body.items[0]).toMatchObject({ systolic: 121, pulseBpm: null });
});

test('diastolic ≥ systolic asks for confirmation without diagnosis', async ({ page }) => {
  await signUpViaApi(page);
  await page.goto('/pressao');
  const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Registrar pressão' }) });
  await form.getByLabel(/Sistólica/).fill('80');
  await form.getByLabel(/Diastólica/).fill('90');
  await form.getByRole('button', { name: 'Registrar pressão' }).click();
  await expect(page.getByText('Confira os valores')).toBeVisible();
  await page.getByRole('button', { name: 'Os valores estão corretos' }).click();
  await expect(page.locator('section[aria-labelledby="pa-historico"]').getByText('80 / 90')).toBeVisible();
});
