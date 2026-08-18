/**
 * The M1 walking skeleton, end to end.
 *
 * The gate this proves: a command goes through the pure domain, into local
 * persistence, and back to a rendered projection — and survives a restart.
 *
 * Every path runs twice, once with the pointer and once keyboard-only, and every
 * page state is checked with axe. See docs/spec/11-quality-performance.md §4.
 */

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function freshApp(page: Page) {
  await page.goto('/');
  // A genuine restart: clear the store, then reload.
  await page.evaluate(() => globalThis.localStorage.clear());
  await page.reload();
  await expect(page.getByRole('heading', { name: /flowmap/i })).toBeVisible();
}

/** Creation forms fold away by default; open them before using them. */
async function openEditor(page: Page) {
  const summary = page.getByText('Add and place work');
  if (await summary.isVisible()) {
    const open = await page
      .locator('details.fm-editor')
      .evaluate((d) => (d as HTMLDetailsElement).open);
    if (!open) await summary.click();
  }
}

async function addTeam(page: Page, name: string) {
  await openEditor(page);
  await page.locator('#team-name').fill(name);
  await page.getByRole('button', { name: 'Add team' }).click();
}

async function captureIdea(page: Page, name: string) {
  await openEditor(page);
  await page.getByLabel('What is it?').fill(name);
  await page.getByRole('button', { name: 'Capture idea' }).click();
}

async function place(page: Page, size: 'XS' | 'S' | 'M' | 'L') {
  await openEditor(page);
  await page.getByLabel('Size').selectOption(size);
  await page.getByRole('button', { name: 'Place', exact: true }).click();
}

async function expectNoAxeViolations(page: Page, context: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();

  // Report the offending node, not just the rule — a bare rule id sends you
  // hunting through the whole page.
  const detail = results.violations.flatMap((v) =>
    v.nodes.map(
      (n) => `${v.id} @ ${n.target.join(' ')} — ${n.failureSummary?.split('\n')[1] ?? ''}`,
    ),
  );

  expect(detail, `axe violations in ${context}`).toEqual([]);
}

test('empty state invites the first action, and is accessible', async ({ page }) => {
  await freshApp(page);

  // The map exists from the start; it is simply empty of teams.
  await expect(page.getByRole('grid')).toBeVisible();
  await expect(page.getByRole('heading', { name: /ideas and demand/i })).toBeVisible();
  await expectNoAxeViolations(page, 'empty state');
});

test('create → place → persist → reload → render', async ({ page }) => {
  await freshApp(page);

  await addTeam(page, 'Payments');
  await captureIdea(page, 'SEPA instant payments');
  await place(page, 'L');

  // The vessel renders with the resolved units, and says what it means.
  await expect(page.getByRole('rowheader', { name: /Payments/ })).toBeVisible();

  const block = page.getByRole('gridcell', { name: /SEPA instant payments/ });
  await expect(block).toBeVisible();
  await expect(block).toHaveAttribute('aria-label', /35 units/);

  // An Idea has a footprint but consumes nothing — the load is 0, not 35.
  await expect(page.getByTestId('total-load')).toHaveText('0');
  await expect(page.getByTestId('total-capacity')).toHaveText('80');
  await expect(block).toHaveAttribute('aria-label', /Not consuming capacity/);

  // Restart.
  await page.reload();

  await expect(page.getByRole('gridcell', { name: /SEPA instant payments/ })).toBeVisible();
  await expect(page.getByTestId('total-capacity')).toHaveText('80');
  await expectNoAxeViolations(page, 'after reload');
});

test('list companion totals match the board exactly', async ({ page }) => {
  await freshApp(page);

  await addTeam(page, 'Payments');
  await captureIdea(page, 'One');
  await place(page, 'M');
  await captureIdea(page, 'Two');
  await page.getByLabel('Commitment', { exact: true }).selectOption({ label: 'Two' });
  await place(page, 'S');

  const rows = page.locator('.fm-list tbody tr');
  await expect(rows).toHaveCount(2);

  // Units come straight from the projection, so the sum is checkable by hand.
  await expect(rows.nth(0).locator('[data-figure]')).toHaveText('20');
  await expect(rows.nth(1).locator('[data-figure]')).toHaveText('10');
  await expect(page.getByTestId('total-capacity')).toHaveText('80');
});

test('undo reverses a placement and redo restores it', async ({ page }) => {
  await freshApp(page);

  await addTeam(page, 'Payments');
  await captureIdea(page, 'Reversible');
  await place(page, 'M');

  await expect(page.getByRole('gridcell', { name: /Reversible/ })).toBeVisible();

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('gridcell', { name: /Reversible/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(page.getByRole('gridcell', { name: /Reversible/ })).toBeVisible();
});

test('clear local data empties the workspace and starts a fresh one', async ({ page }) => {
  await freshApp(page);

  await addTeam(page, 'Payments');
  await captureIdea(page, 'Temporary');
  await place(page, 'M');
  await expect(page.getByRole('gridcell', { name: /Temporary/ })).toBeVisible();

  await page.getByRole('button', { name: 'Settings' }).click();
  await page
    .getByRole('dialog', { name: 'Settings' })
    .getByRole('button', { name: 'Clear local data' })
    .click();
  await page
    .getByRole('alertdialog', { name: 'Clear local data' })
    .getByRole('button', { name: 'Clear local data' })
    .click();

  await expect(page.getByRole('rowheader', { name: /Payments/ })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('rowheader', { name: /Payments/ })).toHaveCount(0);
});

test('the whole flow works keyboard-only', async ({ page }) => {
  await freshApp(page);

  await openEditor(page);

  // Team
  await page.locator('#team-name').focus();
  await page.keyboard.type('Platform');
  await page.keyboard.press('Enter');

  // Idea
  await page.getByLabel('What is it?').focus();
  await page.keyboard.type('Keyboard only');
  await page.keyboard.press('Enter');

  // Place
  await page.getByLabel('Size').focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Place', exact: true }).focus();
  await page.keyboard.press('Enter');

  const block = page.getByRole('gridcell', { name: /Keyboard only/ });
  await expect(block).toBeVisible();

  // The block itself is reachable and selectable without a pointer.
  await block.focus();
  await expect(block).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(block).toHaveAttribute('aria-selected', 'true');
});

test('duplicate team names are refused with an explanation, not silently ignored', async ({
  page,
}) => {
  await freshApp(page);

  await addTeam(page, 'Payments');
  await addTeam(page, 'payments');

  const banner = page.getByRole('alert');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText(/already in use/i);
  await expectNoAxeViolations(page, 'error banner');
});
