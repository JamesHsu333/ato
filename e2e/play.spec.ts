import { expect, test, type Page } from '@playwright/test';

const shots = process.env.E2E_SCREENSHOTS;
const snap = async (page: Page, name: string) => {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png` });
};

async function openPlay(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('.panel-left')).toContainText('Generic Guard');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('.tabs.modes')).toBeVisible();
  return errors;
}

test('watch: the High PnR runs to a result and the clock stops', async ({ page }) => {
  const errors = await openPlay(page);
  await page.getByRole('button', { name: 'Sideline tactical' }).click();
  await page.getByRole('button', { name: 'Static' }).click();
  await page.getByRole('button', { name: /Inspector/ }).click();
  await expect(page.locator('.event-log')).toContainText('screen.set', { timeout: 10_000 });
  await page.waitForTimeout(150);
  await snap(page, '40-watch-screen');
  await expect(page.locator('.event-log')).toContainText('handler.clears_screen', { timeout: 10_000 });
  await page.waitForTimeout(500);
  await snap(page, '41-watch-drop');
  await expect(page.locator('.result-card')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.result-card')).toContainText('Drop');
  const t1 = await page.locator('.clock').textContent();
  await page.waitForTimeout(800);
  expect(await page.locator('.clock').textContent()).toBe(t1); // the clock stopped
  await snap(page, '42-watch-result');

  // Hedge looks different: the big jumps out.
  await page.locator('label', { hasText: 'Defense' }).locator('select').selectOption('hedge');
  await expect(page.locator('.event-log')).toContainText('handler.clears_screen', { timeout: 10_000 });
  await page.waitForTimeout(200);
  await snap(page, '43-watch-hedge');
  expect(errors).toEqual([]);
});

test('practice: user is the ball handler, guided by cues, gets feedback', async ({ page }) => {
  const errors = await openPlay(page);
  await page.getByRole('button', { name: 'Practice' }).click();
  await expect(page.locator('.cue-title')).toHaveText('WAIT', { timeout: 5000 });
  await page.waitForTimeout(500);
  await snap(page, '50-practice-wait');
  await expect(page.locator('.cue-title')).toContainText('GO', { timeout: 8000 });
  await snap(page, '51-practice-go');
  // Come off the screen to the right, then pull up.
  await page.keyboard.down('d');
  await page.waitForTimeout(500);
  await page.keyboard.down('s');
  await page.waitForTimeout(400);
  await page.keyboard.up('d');
  await page.keyboard.up('s');
  await snap(page, '52-practice-read');
  await page.keyboard.down('Space');
  await page.waitForTimeout(420);
  await page.keyboard.up('Space');
  await expect(page.locator('.result-card')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.result-card .scores')).toContainText('Timing');
  await snap(page, '53-practice-result');
  expect(errors).toEqual([]);
});

test('read & react hides the coverage until the rep is over', async ({ page }) => {
  const errors = await openPlay(page);
  await page.getByRole('button', { name: 'Read & React' }).click();
  await expect(page.locator('label', { hasText: 'Defense' })).toContainText('hidden');
  await expect(page.locator('.cue')).toBeVisible();
  expect(errors).toEqual([]);
});

test('importing an invalid play shows validation errors', async ({ page }) => {
  await openPlay(page);
  await page.locator('input[type=file][accept=".yaml,.yml,.json"]').setInputFiles({
    name: 'broken.yaml',
    mimeType: 'application/yaml',
    buffer: Buffer.from('version: "0.1"\nplay: { id: broken, name: Broken }\nactors: {}\nsetup: {}\ngraph: {}\n'),
  });
  await expect(page.locator('.issues')).toContainText('actors');
});
