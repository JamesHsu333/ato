import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const shots = process.env.E2E_SCREENSHOTS;
const snap = async (page: Page, name: string) => {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png` });
};

type Hook = {
  screenOf(x: number, z: number): { x: number; y: number };
  positions(): Record<string, { x: number; z: number }>;
};
const screenOf = (page: Page, x: number, z: number) => page.evaluate(([x, z]) => (window as unknown as { __ato: Hook }).__ato.screenOf(x, z), [x, z]);
const positions = (page: Page) => page.evaluate(() => (window as unknown as { __ato: Hook }).__ato.positions());
const yaml = (page: Page) => page.locator('.yaml textarea').inputValue();

async function openDesigner(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('.panel-left')).toContainText('Generic Guard');
  await page.getByRole('button', { name: 'Designer' }).click();
  await expect(page.locator('.timeline .tl-seg').first()).toBeVisible();
  await page.waitForTimeout(400); // camera settles on top-down
  return errors;
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, modifier?: 'Shift' | 'Alt', via?: { x: number; y: number }) {
  if (modifier) await page.keyboard.down(modifier);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  if (via) await page.mouse.move(via.x, via.y, { steps: 8 });
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  if (modifier) await page.keyboard.up(modifier);
}

test('designer: drag, shift-drag, timeline seek, undo/redo', async ({ page }) => {
  const errors = await openDesigner(page);
  await snap(page, '60-designer');

  // Drag the wing's starting spot.
  const wing = (await positions(page)).wing;
  await drag(page, await screenOf(page, wing.x, wing.z), await screenOf(page, -4.0, 6.5));
  await expect.poll(() => yaml(page)).toMatch(/wing:\s*\n\s*position:\s*\n\s*x: -4\.?\d*\s*\n\s*z: 6\.\d+/);
  const after = (await positions(page)).wing;
  expect(Math.hypot(after.x + 4, after.z - 6.5)).toBeLessThan(0.3);

  // Shift-drag from the left corner: a new move in the start node.
  const corner = (await positions(page)).corner_l;
  await drag(page, await screenOf(page, corner.x, corner.z), await screenOf(page, -6.2, 4.8), 'Shift');
  await expect.poll(() => yaml(page)).toContain('actor: corner_l');
  await expect(page.locator('.action.selected')).toBeVisible();
  await snap(page, '61-designer-new-move');

  // Option-drag (curved route) stores a path override.
  const wing2 = (await positions(page)).wing;
  await drag(page, await screenOf(page, wing2.x, wing2.z), await screenOf(page, -1.5, 3.5), 'Alt', await screenOf(page, -4.5, 3.8));
  await expect.poll(() => yaml(page)).toMatch(/mode: override/);
  await snap(page, '62-designer-curve');

  // Timeline: seek moves the players; the clock follows.
  const box = (await page.locator('.tl-track').boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.5, box.y + 5);
  await expect(page.locator('.transport .clock')).not.toContainText('0.00 /');
  await snap(page, '63-designer-seek');

  // Undo / redo.
  const before = await yaml(page);
  await page.locator('.tl-track').click({ position: { x: 2, y: 5 } }); // focus out of inputs
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => yaml(page)).not.toBe(before);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(() => yaml(page)).toBe(before);
  expect(errors).toEqual([]);
});

test('Demo E: YAML round trip — edit in UI, export, modify, import, scene updates', async ({ page }) => {
  const errors = await openDesigner(page);
  // 1. Edit in UI.
  const h = (await positions(page)).handler;
  await drag(page, await screenOf(page, h.x, h.z), await screenOf(page, 1.5, 9.0));
  await expect.poll(() => yaml(page)).toMatch(/handler:\s*\n\s*position:\s*\n\s*x: 1\.\d+/);

  // 2. Export YAML.
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('.library').getByRole('button', { name: 'Export YAML' }).click()]);
  const exported = readFileSync((await download.path())!, 'utf8');
  expect(exported).toContain('handler:');

  // 3. Modify manually: move the corner shooter to the right wing.
  const modified = exported.replace(/corner_r:\n(\s+)position: right_corner/, 'corner_r:\n$1position: right_wing');
  expect(modified).not.toBe(exported);

  // 4. Import.
  await page.getByTestId('designer-import').setInputFiles({ name: 'edited.yaml', mimeType: 'application/yaml', buffer: Buffer.from(modified) });

  // 5. Scene updates correctly.
  await expect.poll(async () => (await positions(page)).corner_r).toEqual({ x: 6.2, z: 4.8 });
  const hp = (await positions(page)).handler;
  expect(hp.x).toBeCloseTo(1.5, 0);

  // Also: typing in the YAML editor applies live.
  const text = await yaml(page);
  await page.locator('.yaml textarea').fill(text.replace(/corner_r:\n(\s+)position: right_wing/, 'corner_r:\n$1position: right_corner'));
  await expect(page.locator('.yaml-status')).toContainText('valid', { timeout: 5000 });
  await page.locator('.tl-track').click({ position: { x: 2, y: 5 } });
  await expect.poll(async () => (await positions(page)).corner_r).toEqual({ x: 7, z: 0.4 });

  // Invalid YAML is reported and not applied.
  await page.locator('.yaml textarea').fill('version: "0.1"\nplay: [');
  await expect(page.locator('.yaml-status')).toContainText('✕', { timeout: 5000 });
  expect(errors).toEqual([]);
});

test('designer autosaves to the browser library', async ({ page }) => {
  await openDesigner(page);
  await page.getByRole('button', { name: 'Duplicate' }).click();
  await expect(page.locator('.lib-row.current')).toContainText('(copy)', { timeout: 5000 });
  await page.reload();
  await page.getByRole('button', { name: 'Designer' }).click();
  await expect(page.locator('.library')).toContainText('High Pick & Roll (copy)', { timeout: 5000 });
});
