/**
 * The Portfolio Map (M2).
 *
 * Proves the grammar the whole product rests on: quarters as columns, teams as
 * rows, Ideas outside the grid, semantic zoom, focus mode, and filter chips —
 * all reachable by keyboard and clean under axe.
 */

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function freshApp(page: Page) {
  await page.goto('/');
  await page.evaluate(() => globalThis.localStorage.clear());
  await page.reload();
  await expect(page.getByRole('heading', { name: /flowmap/i })).toBeVisible();
}

async function seed(page: Page) {
  await page.getByLabel('Team', { exact: true }).fill('Payments');
  await page.getByRole('button', { name: 'Add team' }).click();
  await page.getByLabel('Team', { exact: true }).fill('Platform');
  await page.getByRole('button', { name: 'Add team' }).click();

  await page.getByLabel('What is it?').fill('SEPA instant');
  await page.getByRole('button', { name: 'Capture idea' }).click();
  await page.getByLabel('What is it?').fill('Ledger migration');
  await page.getByRole('button', { name: 'Capture idea' }).click();
}

/**
 * `t()` returns the key when it cannot resolve one — correct at runtime (a
 * missing string must never blank a planning board) but it means a namespace
 * typo ships silently. This catches the leak where a user would see it.
 */
async function expectNoUnresolvedKeys(page: Page) {
  const leaked = await page.evaluate(() => {
    const pattern = /(?:^|\s)[a-z][a-zA-Z]*\.[a-zA-Z][a-zA-Z0-9.]*(?:$|\s)/;
    const found = new Set<string>();

    for (const el of Array.from(document.querySelectorAll('[aria-label]'))) {
      const label = el.getAttribute('aria-label') ?? '';
      for (const part of label.split('. ')) {
        if (pattern.test(part.trim()) && !part.includes(' ')) found.add(part.trim());
      }
    }
    for (const el of Array.from(document.querySelectorAll('button, td, th, span'))) {
      const text = (el.textContent ?? '').trim();
      if (text && !text.includes(' ') && pattern.test(text)) found.add(text);
    }
    return [...found];
  });

  expect(leaked, 'unresolved i18n keys rendered to the user').toEqual([]);
}

async function expectNoAxeViolations(page: Page, context: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const detail = results.violations.flatMap((v) =>
    v.nodes.map((n) => `${v.id} @ ${n.target.join(' ')}`),
  );
  expect(detail, `axe violations in ${context}`).toEqual([]);
}

test('lays quarters left to right and teams as rows, with now marked', async ({ page }) => {
  await freshApp(page);
  await seed(page);

  // Scoped to the grid: the list companion has column headers of its own.
  const grid = page.getByRole('grid');
  // Six horizon quarters plus the corner header.
  await expect(grid.getByRole('columnheader')).toHaveCount(7);

  await expect(grid.getByRole('rowheader', { name: /Payments/ })).toBeVisible();
  await expect(grid.getByRole('rowheader', { name: /Platform/ })).toBeVisible();

  // The current quarter is named, not merely coloured.
  await expect(grid.getByRole('columnheader', { name: /now/ })).toBeVisible();
});

test('keeps Ideas out of the capacity grid until they are placed', async ({ page }) => {
  await freshApp(page);
  await seed(page);

  const lane = page.getByRole('region', { name: /ideas and demand/i });
  await expect(lane.getByRole('button', { name: /SEPA instant/ })).toBeVisible();

  // No block anywhere on the grid yet.
  await expect(page.getByRole('gridcell', { name: /SEPA instant/ })).toHaveCount(0);
});

test('semantic zoom swaps blocks for aggregates and back', async ({ page }) => {
  await freshApp(page);
  await seed(page);
  await page.getByRole('button', { name: 'Place', exact: true }).click();

  await expect(page.getByRole('gridcell', { name: /SEPA instant/ })).toBeVisible();

  await page.getByRole('button', { name: 'Overview' }).click();
  await expect(page.getByRole('gridcell', { name: /SEPA instant/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'Detail', exact: true }).click();
  await expect(page.getByRole('gridcell', { name: /SEPA instant/ })).toBeVisible();
});

test('focus mode relates a commitment and can be cleared', async ({ page }) => {
  await freshApp(page);
  await seed(page);
  await page.getByRole('button', { name: 'Place', exact: true }).click();

  await page.getByRole('gridcell', { name: /SEPA instant/ }).click();
  await expect(page.getByRole('button', { name: /Clear focus/ })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /Clear focus/ })).toHaveCount(0);
});

test('the grid is navigable by keyboard from a single tab stop', async ({ page }) => {
  await freshApp(page);
  await seed(page);

  const grid = page.getByRole('grid');
  await grid.focus();
  await expect(grid).toBeFocused();

  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');

  // Movement announces where the cursor landed.
  await expect(page.getByRole('status').filter({ hasText: /Platform/ })).toBeVisible();
});

test('filter chips show what is filtered and clear cleanly', async ({ page }) => {
  await freshApp(page);
  await seed(page);
  await page.getByRole('button', { name: 'Place', exact: true }).click();

  await page.getByRole('gridcell').first().click();
  await expect(page.getByRole('button', { name: /Team:/ })).toBeVisible();

  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.getByText('No filters')).toBeVisible();
});

test('the map is accessible at every zoom level', async ({ page }) => {
  await freshApp(page);
  await seed(page);
  await page.getByRole('button', { name: 'Place', exact: true }).click();

  for (const level of ['Overview', 'Areas', 'Detail']) {
    await page.getByRole('button', { name: level, exact: true }).click();
    await expectNoAxeViolations(page, `map at level ${level}`);
  }
});

test('the sample workspace makes the map worth looking at', async ({ page }) => {
  await freshApp(page);
  await page.getByRole('button', { name: 'Load sample workspace' }).click();

  const grid = page.getByRole('grid');

  // Five teams as rows, six quarters as columns.
  await expect(grid.getByRole('rowheader')).toHaveCount(5);
  await expect(grid.getByRole('columnheader')).toHaveCount(7);

  // The engineered conditions are visible, not just present in the data.
  await expect(grid.getByRole('rowheader', { name: /Payments/ })).toContainText('over capacity');

  // One commitment, two teams, same quarter — the multi-team footprint model
  // drawn as two blocks rather than one duplicated commitment.
  await expect(page.getByRole('gridcell', { name: /SEPA instant payments/ })).toHaveCount(2);

  // Carry-over and held capacity are named, not merely styled.
  // Two teams carried work out of the closed quarter.
  await expect(page.getByRole('gridcell', { name: /Carried over from 2026-Q2/ })).toHaveCount(2);
  await expect(
    page.getByRole('gridcell', { name: /Not consuming capacity/ }).first(),
  ).toBeVisible();

  // Ideas stay in the lane, out of the grid.
  const lane = page.getByRole('region', { name: /ideas and demand/i });
  await expect(lane.getByRole('button')).toHaveCount(10);

  await expectNoAxeViolations(page, 'sample workspace');
  await expectNoUnresolvedKeys(page);
});

test('loading the sample twice replaces rather than duplicates', async ({ page }) => {
  await freshApp(page);
  await page.getByRole('button', { name: 'Load sample workspace' }).click();
  await page.getByRole('button', { name: 'Load sample workspace' }).click();

  await expect(page.getByRole('grid').getByRole('rowheader')).toHaveCount(5);
});
