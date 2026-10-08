import { expect, test, type Page } from '@playwright/test';

const shots = process.env.E2E_SCREENSHOTS;
const snap = async (page: Page, name: string) => {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png` });
};

const SAMPLES = [
  '01 High Pick & Roll',
  '02 Elevator Doors',
  '03 Floppy',
  '04 Spain Pick & Roll',
  '05 Horns',
  '06 Backdoor Cut',
  '07 Dribble Handoff',
  '08 Alley-Oop',
];

test('every sample play runs to a result in the browser', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('.panel-left')).toContainText('Generic Guard');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Sideline tactical' }).click();
  await page.getByRole('button', { name: 'Static' }).click();
  for (const [i, name] of SAMPLES.entries()) {
    await page.locator('label', { hasText: 'Library' }).locator('select').selectOption({ label: name });
    await page.waitForTimeout(1600);
    await snap(page, `7${i}-${name.slice(3).replace(/\W+/g, '-').toLowerCase()}`);
    await expect(page.locator('.result-card'), name).toBeVisible({ timeout: 20_000 });
  }
  expect(errors).toEqual([]);
});

test('Demo D: swap a player to a sprite — same play, no DSL change', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('.panel-left')).toContainText('Generic Guard');
  await page.getByRole('button', { name: 'Designer' }).click();
  await expect(page.locator('.timeline .tl-seg').first()).toBeVisible();
  const yamlBefore = await page.locator('.yaml textarea').inputValue();

  // Make the handler and the screener cartoon sprites.
  for (const actor of ['handler', 'screener']) {
    await page.locator('.tl-label', { hasText: new RegExp(`^${actor}$`) }).click();
    await page.locator('.panel-right').getByRole('button', { name: 'Sprite', exact: true }).click();
  }
  expect(await page.locator('.yaml textarea').inputValue()).toBe(yamlBefore);

  // Run it: the play still executes and finishes exactly the same way.
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Broadcast' }).click();
  await page.waitForTimeout(1800);
  await snap(page, '80-sprites-in-pnr');
  await expect(page.locator('.result-card')).toBeVisible({ timeout: 20_000 });
  expect(errors).toEqual([]);
});
