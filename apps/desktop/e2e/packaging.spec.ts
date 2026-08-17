/**
 * M7 packaging surfaces: Settings shows where data lives, clear-local-data
 * confirms, and the keyboard shortcut reference is reachable without a mouse.
 */

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function freshApp(page: Page) {
  await page.goto('/');
  await page.evaluate(() => globalThis.localStorage.clear());
  await page.reload();
  await expect(page.getByRole('heading', { name: /flowmap/i })).toBeVisible();
}

async function expectNoAxeViolations(page: Page, context: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const detail = results.violations.flatMap((v) =>
    v.nodes.map(
      (n) => `${v.id} @ ${n.target.join(' ')} — ${n.failureSummary?.split('\n')[1] ?? ''}`,
    ),
  );
  expect(detail, `axe violations in ${context}`).toEqual([]);
}

test('Settings shows the browser data location and how to go portable', async ({ page }) => {
  await freshApp(page);
  await page.getByRole('button', { name: 'Settings' }).click();

  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Browser development target.')).toBeVisible();
  await expect(dialog.getByText(/stored in this browser/i)).toBeVisible();
  await expect(dialog.getByText(/Version /)).toBeVisible();
  await expectNoAxeViolations(page, 'settings');
});

test('clear local data asks first and keeps the work if cancelled', async ({ page }) => {
  await freshApp(page);
  await page.getByRole('button', { name: 'Load sample workspace' }).click();
  await expect(page.getByRole('grid').first().getByRole('rowheader')).toHaveCount(5);

  await page.getByRole('button', { name: 'Clear local data' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Clear local data' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('grid').first().getByRole('rowheader')).toHaveCount(5);

  await page.getByRole('button', { name: 'Clear local data' }).click();
  await page
    .getByRole('alertdialog', { name: 'Clear local data' })
    .getByRole('button', { name: 'Clear local data' })
    .click();
  await expect(page.getByRole('grid').first().getByRole('rowheader')).toHaveCount(0);
});

test('keyboard shortcut reference opens from ? and is accessible', async ({ page }) => {
  await freshApp(page);
  await page.keyboard.press('Shift+?');
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Command palette')).toBeVisible();
  await expectNoAxeViolations(page, 'shortcut reference');
});
