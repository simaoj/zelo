import { expect, test } from '@playwright/test';
import { APP_PAGES, PUBLIC_PAGES, signUpViaApi } from './helpers';

const WIDTHS = [320, 390, 768, 1440];
// Water/hydration and "kcal ativas" of received workouts are allowed (increment água/atividade);
// meals and diet stay forbidden. Whole words only.
const FORBIDDEN = /(?<!\p{L})(refei[çc][ãa]o|refei[çc][õo]es|dieta|calorias?|almo[çc]o|jantar|caf[ée] da manh[ãa])(?!\p{L})/iu;

test('no horizontal scroll at 320/390/768/1440 and nothing hidden behind the bottom nav', async ({ page }) => {
  await signUpViaApi(page);
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 800 });
    for (const path of [...APP_PAGES, ...PUBLIC_PAGES]) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const { scrollWidth, innerWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      expect(scrollWidth, `${path} @ ${width}px`).toBeLessThanOrEqual(innerWidth);

      if (width < 1024 && APP_PAGES.includes(path)) {
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        const overlap = await page.evaluate(() => {
          const nav = document.querySelector('nav[aria-label="Principal"].fixed');
          const main = document.getElementById('conteudo');
          const last = main?.lastElementChild?.getBoundingClientRect();
          const navTop = nav?.getBoundingClientRect().top ?? Infinity;
          return last ? last.bottom - navTop : -1;
        });
        expect(overlap, `${path} @ ${width}px content covered by nav`).toBeLessThanOrEqual(0);
      }
    }
  }
});

test('no meal/diet text on any screen (water is allowed)', async ({ page }) => {
  await signUpViaApi(page);
  for (const path of [...APP_PAGES, ...PUBLIC_PAGES]) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const text = await page.locator('body').innerText();
    expect(text, path).not.toMatch(FORBIDDEN);
  }
  await page.goto('/hoje');
  await page.getByRole('button', { name: 'Registrar' }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await page.getByRole('dialog').innerText()).not.toMatch(FORBIDDEN);
});
