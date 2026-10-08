import { expect, test } from '@playwright/test';

const shots = process.env.E2E_SCREENSHOTS;

test('control a character, dribble, and make a physics shot', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('.scoreboard')).toContainText('0/0 FG');
  await expect(page.locator('.panel-left')).toContainText('Generic Guard');
  await page.waitForTimeout(800);
  if (shots) await page.screenshot({ path: `${shots}/01-start.png` });

  // Move while dribbling.
  await page.mouse.move(640, 300);
  await page.keyboard.down('d');
  await page.waitForTimeout(700);
  await page.keyboard.up('d');
  if (shots) await page.screenshot({ path: `${shots}/02-moved.png` });

  // Forced make so the assertion is about the physics path, not the dice roll.
  await page.locator('select').nth(1).selectOption('make');
  await page.keyboard.down('Space');
  await expect(page.locator('.meter')).toBeVisible();
  await page.waitForTimeout(420);
  await page.keyboard.up('Space');
  await expect(page.locator('.shot-banner')).toBeVisible();
  if (shots) {
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${shots}/03-shot-flight.png` });
  }
  await expect(page.locator('.scoreboard')).toContainText('1/1 FG', { timeout: 8000 });
  await expect(page.locator('.shot-banner .result')).toHaveText('MAKE');

  expect(errors).toEqual([]);
});

test('switch control to the sprite character and view from every camera preset', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('.panel-left')).toContainText('Generic Guard');
  await page.waitForTimeout(500);

  await page.keyboard.press('1'); // pass to the mascot; control follows the ball
  await expect(page.locator('.panel-left')).toContainText('Generic Mascot', { timeout: 5000 });
  await page.keyboard.down('a');
  await page.waitForTimeout(600);
  await page.keyboard.up('a');

  for (const [i, label] of ['Top-down', 'Sideline tactical', 'Broadcast', 'Free orbit'].entries()) {
    await page.getByRole('button', { name: label }).click();
    await page.waitForTimeout(500);
    if (shots) await page.screenshot({ path: `${shots}/1${i}-${label.replace(/\s/g, '-').toLowerCase()}.png` });
  }

  // Appearance swap must not affect behavior: the mascot keeps the ball.
  await page.getByRole('button', { name: 'Humanoid' }).click();
  await page.waitForTimeout(300);
  await expect(page.locator('.panel-left .tag')).toHaveText('ball');
  if (shots) await page.screenshot({ path: `${shots}/20-mascot-as-humanoid.png` });

  expect(errors).toEqual([]);
});
