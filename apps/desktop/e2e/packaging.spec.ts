/**
 * M7 packaging surfaces: Settings shows where data lives, clear-local-data
 * confirms, and the keyboard shortcut reference is reachable without a mouse.
 */

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { openSampleWorkspace } from './helpers.js';

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

test('the appearance toggle switches the document between light and dark', async ({ page }) => {
  await freshApp(page);
  const toggle = page.getByRole('button', { name: /use (light|dark) appearance/i });
  await expect(toggle).toBeVisible();
  const before = await toggle.getAttribute('aria-label');
  await toggle.click();
  await expect(toggle).not.toHaveAttribute('aria-label', before ?? '');
  const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  expect(theme === 'light' || theme === 'dark').toBe(true);
});

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
  await page.getByText('Add and place work').click();
  await page.locator('#team-name').fill('Payments');
  await page.getByRole('button', { name: 'Add team' }).click();
  await expect(page.getByRole('grid').first().getByRole('rowheader')).toHaveCount(1);

  await page.getByRole('button', { name: 'Settings' }).click();
  await page
    .getByRole('dialog', { name: 'Settings' })
    .getByRole('button', { name: 'Clear local data' })
    .click();
  const confirm = page.getByRole('alertdialog', { name: 'Clear local data' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('grid').first().getByRole('rowheader')).toHaveCount(1);

  await page.getByRole('button', { name: 'Settings' }).click();
  await page
    .getByRole('dialog', { name: 'Settings' })
    .getByRole('button', { name: 'Clear local data' })
    .click();
  await page
    .getByRole('alertdialog', { name: 'Clear local data' })
    .getByRole('button', { name: 'Clear local data' })
    .click();
  await expect(page.getByRole('grid').first().getByRole('rowheader')).toHaveCount(0);
});

test('the sample workspace stays in the switcher and does not overwrite the empty portfolio', async ({
  page,
}) => {
  await freshApp(page);
  await expect(page.getByRole('grid').first().getByRole('rowheader')).toHaveCount(0);

  await page.locator('details.fm-workspace-switcher > summary').click();
  await expect(
    page.getByRole('button', { name: 'Retail Payments & Channels (sample)' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Retail Payments & Channels (sample)' }).click();
  await expect(page.getByRole('grid').first().getByRole('rowheader')).toHaveCount(5);

  await page.locator('details.fm-workspace-switcher > summary').click();
  await page.getByRole('button', { name: 'My portfolio' }).click();
  await expect(page.getByRole('grid').first().getByRole('rowheader')).toHaveCount(0);

  await openSampleWorkspace(page);
  await expect(page.getByRole('grid').first().getByRole('rowheader')).toHaveCount(5);
});

test('keyboard shortcut reference opens from ? and is accessible', async ({ page }) => {
  await freshApp(page);
  await page.keyboard.press('Shift+?');
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Command palette')).toBeVisible();
  await expectNoAxeViolations(page, 'shortcut reference');
});
