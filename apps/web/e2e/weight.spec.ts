import { expect, test } from '@playwright/test';
import { PASSWORD, uniqueEmail } from './helpers';

test('sign-up → create, edit and delete a weight entry', async ({ page }) => {
  await page.goto('/criar-conta');
  await page.getByLabel('Como quer ser chamado(a)').fill('Maria Teste');
  await page.getByLabel('E-mail').fill(uniqueEmail('peso'));
  await page.getByLabel('Senha').fill(PASSWORD);
  await page.getByLabel('Fuso horário').selectOption('America/Sao_Paulo');
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await expect(page).toHaveURL(/\/hoje/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Maria Teste');

  await page.goto('/corpo');
  const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Salvar registro' }) });
  await form.getByLabel(/Peso \(kg\)/).fill('82,35');
  await form.getByRole('button', { name: 'Salvar registro' }).click();

  const history = page.locator('section[aria-labelledby="peso-historico"]');
  await expect(history.getByText('82,35 kg')).toBeVisible();
  // precision preserved after reload
  await page.reload();
  await expect(history.getByText('82,35 kg')).toBeVisible();

  await history.getByRole('button', { name: /Editar peso/ }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Editar peso' });
  await dialog.getByLabel(/Peso \(kg\)/).fill('81,5');
  await dialog.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(dialog).toBeHidden();
  await expect(history.getByText('81,5 kg')).toBeVisible();
  await expect(history.getByText('82,35 kg')).toHaveCount(0);

  await history.getByRole('button', { name: /Excluir peso/ }).first().click();
  const confirm = page.getByRole('dialog', { name: /Excluir este registro de peso/ });
  await confirm.getByRole('button', { name: 'Excluir' }).click();
  await expect(history.getByText('81,5 kg')).toHaveCount(0);
  await expect(page.getByText('Seus registros aparecerão aqui.')).toBeVisible();
});
