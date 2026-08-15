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

/** Creation forms fold away by default; open them before using them. */
async function openEditor(page: Page) {
  const summary = page.getByText('Add and place work');
  const open = await page
    .locator('details.fm-editor')
    .evaluate((d) => (d as HTMLDetailsElement).open);
  if (!open) await summary.click();
}

async function seed(page: Page) {
  await openEditor(page);
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

test('headers filter, chips show what is filtered, and clearing works', async ({ page }) => {
  await freshApp(page);
  await seed(page);

  // A header is the obvious place to narrow to one team or one quarter.
  await page.getByRole('grid').getByRole('button', { name: 'Payments' }).click();
  await expect(page.getByRole('button', { name: /Team:/ })).toBeVisible();

  await page
    .getByRole('grid')
    .getByRole('button', { name: /2026-Q4/ })
    .click();
  await expect(page.getByRole('button', { name: /Quarter: 2026-Q4/ })).toBeVisible();

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

test('the map gets the space, not the chrome around it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await freshApp(page);
  await page.getByRole('button', { name: 'Load sample workspace' }).click();
  await expect(page.getByRole('grid').getByRole('rowheader')).toHaveCount(5);

  const shell = (await page.locator('.fm-shell').boundingBox())!;
  const lane = (await page.locator('.fm-ideas').boundingBox())!;
  const map = (await page.locator('.fm-map').boundingBox())!;

  // The lane is a sidebar, not a peer of the map.
  expect(lane.width).toBeLessThanOrEqual(220);
  expect(map.width).toBeGreaterThan(shell.width * 0.6);

  // Editing chrome is collapsed by default; the board is what you land on.
  const controls = (await page.locator('.fm-controlbar').first().boundingBox())!;
  expect(controls.height).toBeLessThan(80);

  // And the board is above the fold.
  expect(map.y).toBeLessThan(300);
});

test('the reasons behind a number are on screen, not only in the data', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await freshApp(page);
  await page.getByRole('button', { name: 'Load sample workspace' }).click();
  await page.getByRole('button', { name: 'Detail', exact: true }).click();

  // The caption no longer repeats the team and quarter — the row and column
  // headers say it — so target the cell by its accessible name.
  const payments = page.getByRole('gridcell', { name: /^Payments\. 2026-Q3/ });

  // Why the container is smaller than a normal quarter.
  await expect(payments).toContainText('One vacancy, recruitment in progress');
  // What the hatched plinth actually is.
  await expect(payments).toContainText('BAU & support');
  await expect(payments).toContainText('Refinement');
  // How much of the load is carried over rather than new.
  await expect(payments).toContainText('carried over');
});

test('held capacity is a labelled band, not invisible headroom', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await freshApp(page);
  await page.getByRole('button', { name: 'Load sample workspace' }).click();
  await page.getByRole('button', { name: 'Detail', exact: true }).click();

  const held = page.getByRole('gridcell', { name: /^Payments\. 2027-Q1/ });
  await expect(held).toContainText('Held: Card tokenisation');
});

test('overflow is drawn as a measured excess, not a red block', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await freshApp(page);
  await page.getByRole('button', { name: 'Load sample workspace' }).click();
  await page.getByRole('button', { name: 'Detail', exact: true }).click();

  const payments = page.getByRole('gridcell', { name: /^Payments\. 2026-Q3/ });

  // The bracket states the quantity. Without it the spill is a texture.
  await expect(payments.locator('.fm-overflow__label')).toHaveText('+13');

  // The hatch must cover 13 units and no more. It once covered whole blocks,
  // which claimed 20 units were over while the bracket said 13.
  const hatched = await payments
    .locator('.fm-block rect[fill*="overflow"]')
    .evaluateAll((rects) =>
      rects.reduce((sum, rect) => sum + rect.getBoundingClientRect().height, 0),
    );
  const bracket = await payments
    .locator('.fm-overflow__bracket')
    .evaluate((path) => path.getBoundingClientRect().height);

  expect(Math.abs(hatched - bracket)).toBeLessThan(2);
});

test('the overview level says where the load is concentrated', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await freshApp(page);
  await page.getByRole('button', { name: 'Load sample workspace' }).click();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();

  const payments = page.getByRole('gridcell', { name: /^Payments\. 2026-Q3/ });

  // A percentage alone cannot distinguish load that can move from load that
  // cannot, which is the whole question at this level.
  await expect(payments).toContainText('55 fixed');
  await expect(payments).toContainText('10 carried in');
  await expect(payments).toContainText('+13 over');

  // Singular, not "1 commitments".
  await expect(page.getByRole('gridcell', { name: /^Payments\. 2026-Q2/ })).toContainText(
    '1 commitment ',
  );

  await expectNoUnresolvedKeys(page);
});

test('the ideas rail is a queue, ordered by how far each idea is worked up', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await freshApp(page);
  await page.getByRole('button', { name: 'Load sample workspace' }).click();

  const rail = page.getByRole('region', { name: /ideas/i });
  await expect(rail.getByText('3 ready to place')).toBeVisible();

  // Ready ones first, then the ones still missing decisions.
  const ideas = rail.locator('.fm-idea');
  await expect(ideas.first()).toHaveAttribute('data-ready', 'true');
  await expect(ideas.last()).not.toHaveAttribute('data-ready', 'true');

  // Colour never carries a state on its own: the gaps are named.
  await expect(ideas.last()).toContainText(/no (team|target|owner|outcome)/);
});

test('a quarter column is never left half-hidden under the pinned team column', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  await freshApp(page);
  await page.getByRole('button', { name: 'Load sample workspace' }).click();
  await page.getByRole('button', { name: 'Detail', exact: true }).click();

  // A partial scroll used to park a column under the pinned column, and the
  // masked half of "2026-Q2 / 13%" read as "26-Q2 / 3%" — as broken text, not
  // as a scroll position.
  await page.locator('.fm-map__scroll').evaluate((node) => {
    node.scrollLeft += 60;
  });
  await page.waitForTimeout(400);

  const straddling = await page.evaluate(() => {
    const header = document.querySelector('.fm-grid__team');
    if (!header) return ['no row header'];
    const edge = header.getBoundingClientRect().right;

    return Array.from(document.querySelectorAll('.fm-grid__cell'))
      .map((cell) => ({ cell, box: cell.getBoundingClientRect() }))
      .filter(({ box }) => box.right > edge + 1 && box.left < edge - 1)
      .map(({ box }) => `cell spans ${Math.round(box.left)}–${Math.round(box.right)}`);
  });

  expect(straddling, 'columns partly masked by the pinned team column').toEqual([]);
});

test('a reduced quarter says which way it moved, in words', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await freshApp(page);
  await page.getByRole('button', { name: 'Load sample workspace' }).click();
  await page.getByRole('button', { name: 'Detail', exact: true }).click();

  const payments = page.getByRole('gridcell', { name: /^Payments\. 2026-Q3/ });
  const reason = payments.locator('.fm-vessel__reason');

  // "-10 units this quarter" opened on a hyphen, which reads as a list bullet.
  await expect(reason).toContainText('10 units fewer this quarter');
  expect(((await reason.textContent()) ?? '').trimStart().startsWith('-')).toBe(false);
});
