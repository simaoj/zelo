import { expect, test } from '@playwright/test';
import { signUpViaApi } from './helpers';

test('routine item → mark as taken → undo', async ({ page }) => {
  await signUpViaApi(page);
  await page.goto('/rotina?aba=itens');
  await page.getByRole('button', { name: 'Novo item' }).click();
  const dialog = page.getByRole('dialog', { name: 'Novo item' });
  await dialog.getByLabel('Nome').fill('Vitamina D teste');
  await dialog.getByLabel('Tipo').selectOption('vitamin');
  await dialog.getByLabel('Dose').fill('1');
  await dialog.getByLabel('Unidade').fill('cápsula');
  await dialog.getByLabel('Horário 1').fill('23:59');
  await dialog.getByRole('button', { name: 'Adicionar item' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Vitamina D teste' })).toBeVisible();

  await page.getByRole('tab', { name: 'Hoje' }).click();
  const card = page.getByRole('article', { name: /Vitamina D teste/ });
  await expect(card).toBeVisible();
  await expect(card.getByText('Programado')).toBeVisible();
  await card.getByRole('button', { name: 'Marcar como tomado' }).click();
  await expect(card.getByText(/Tomado às \d\d:\d\d/)).toBeVisible();
  await card.getByRole('button', { name: 'Desfazer' }).click();
  await expect(card.getByRole('button', { name: 'Marcar como tomado' })).toBeVisible();
  await expect(card.getByText('Programado')).toBeVisible();
});
