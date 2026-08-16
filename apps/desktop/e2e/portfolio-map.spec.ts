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
  // Scoped by id: several forms in the bar have a "Team" field, and the one
  // that creates a team is not the one that places work.
  await page.locator('#team-name').fill('Payments');
  await page.getByRole('button', { name: 'Add team' }).click();
  await page.locator('#team-name').fill('Platform');
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

  // The tint must cover 13 units and no more. It once covered whole blocks,
  // which claimed 20 units were over while the bracket said 13.
  const hatched = await payments
    .locator('.fm-block__over')
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

/**
 * Placing work by dragging it.
 *
 * The premise of the product: you pick work up, every container tells you what
 * it would become, and the drop is the decision. If these break, Flowmap is a
 * form with a chart next to it.
 */

async function dragTo(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // Past the threshold first, or the press is read as a click.
  await page.mouse.move(from.x + 40, from.y + 20, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 10 });
}

test('an Idea dragged onto a quarter shows what it would do before it does it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await freshApp(page);
  await page.getByRole('button', { name: 'Load sample workspace' }).click();
  await page.getByRole('button', { name: 'Detail', exact: true }).click();

  const idea = page.locator('.fm-idea').filter({ hasText: 'Request to pay' });
  const cell = page.locator('[data-drop-team][data-drop-quarter="2026-Q4"]').first();

  const from = await idea.boundingBox();
  const to = await cell.boundingBox();
  if (!from || !to) throw new Error('missing geometry');

  await expect(cell).toContainText('47%');

  await dragTo(
    page,
    { x: from.x + 40, y: from.y + 15 },
    { x: to.x + to.width / 2, y: to.y + to.height / 2 },
  );

  // The consequence is on the board while the pointer is still down.
  await expect(cell).toHaveAttribute('data-drop', 'ok');
  await expect(cell.locator('.fm-incoming__band')).toBeVisible();
  await expect(cell).toContainText('60%');
  await expect(cell).toContainText('was 47%');

  await page.mouse.up();

  // The drop is the Commit Gate: it supplies the team, the footprint, and the
  // primary footprint, so the Idea leaves the rail as committed work.
  await expect(cell).toContainText('Request to pay');
  await expect(page.locator('.fm-idea').filter({ hasText: 'Request to pay' })).toHaveCount(0);
});

test('a drop the model would refuse is refused during the drag, with the reason', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await freshApp(page);
  await page.getByRole('button', { name: 'Load sample workspace' }).click();
  await page.getByRole('button', { name: 'Detail', exact: true }).click();

  // Instant payments regulation already holds a block in Payments 2026-Q4, so
  // dragging its 2026-Q3 block there would be a second footprint in one cell.
  const source = page
    .getByRole('gridcell', { name: /^Payments\. 2026-Q3/ })
    .getByRole('gridcell', { name: /^Instant payments regulation/ });
  const target = page.locator('[data-drop-team][data-drop-quarter="2026-Q4"]').first();

  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error('missing geometry');

  // Mid-block: the top edge is the resize grip, not a place to grab and move.
  await dragTo(
    page,
    { x: from.x + 40, y: from.y + from.height / 2 },
    { x: to.x + to.width / 2, y: to.y + to.height / 2 },
  );

  await expect(target).toHaveAttribute('data-drop', 'no');
  await expect(target).toContainText('already has a block here');

  await page.mouse.up();
  // Refused means unchanged, not partially applied.
  await expect(page.getByRole('gridcell', { name: /^Payments\. 2026-Q3/ })).toContainText('121%');
});

test('work can be placed with the keyboard alone', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await freshApp(page);
  await page.getByRole('button', { name: 'Load sample workspace' }).click();
  await page.getByRole('button', { name: 'Detail', exact: true }).click();

  const idea = page.locator('.fm-idea').filter({ hasText: 'Request to pay' });
  await idea.focus();
  await page.keyboard.press(' ');

  // Space picks it up; the board says so rather than leaving it to the cursor.
  await expect(page.locator('.fm-carry--keyboard')).toContainText('Request to pay');

  // The grid's own arrows carry it — no second cursor to learn.
  await page.locator('.fm-grid').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');

  await expect(page.locator('.fm-carry--keyboard')).toHaveCount(0);
  await expect(page.locator('.fm-idea').filter({ hasText: 'Request to pay' })).toHaveCount(0);
});

test('Escape abandons a drag without changing anything', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await freshApp(page);
  await page.getByRole('button', { name: 'Load sample workspace' }).click();

  const before = await page.locator('.fm-idea').count();
  await page.locator('.fm-idea').first().focus();
  await page.keyboard.press(' ');
  await expect(page.locator('.fm-carry--keyboard')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.locator('.fm-carry--keyboard')).toHaveCount(0);
  expect(await page.locator('.fm-idea').count()).toBe(before);
});

/**
 * The shipped bug: a drag fast enough to produce one `pointermove` before the
 * release. With the drag held in React state, the release read `null` because
 * the render had not committed — nothing was placed and the carry chip stuck to
 * the cursor. `steps: 1` is that drag.
 */
test('a drag with a single move event still places the work', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await freshApp(page);
  await page.getByRole('button', { name: 'Load sample workspace' }).click();
  await page.getByRole('button', { name: 'Detail', exact: true }).click();

  const idea = page.locator('.fm-idea').filter({ hasText: 'Request to pay' });
  const cell = page.locator('[data-drop-team][data-drop-quarter="2026-Q4"]').first();
  const from = await idea.boundingBox();
  const to = await cell.boundingBox();
  if (!from || !to) throw new Error('missing geometry');

  await page.mouse.move(from.x + 40, from.y + 15);
  await page.mouse.down();
  // One move, straight to the target, then release.
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 1 });
  await page.mouse.up();

  await expect(cell).toContainText('Request to pay');
  await expect(page.locator('.fm-carry')).toHaveCount(0);
});

test('a drag held against the edge scrolls the board to reach the far quarters', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await freshApp(page);
  await page.getByRole('button', { name: 'Load sample workspace' }).click();

  const scroller = page.locator('.fm-map__scroll');
  await scroller.evaluate((n) => {
    n.scrollLeft = 0;
  });

  const idea = page.locator('.fm-idea').first();
  const from = await idea.boundingBox();
  const box = await scroller.boundingBox();
  if (!from || !box) throw new Error('missing geometry');

  await page.mouse.move(from.x + 40, from.y + 15);
  await page.mouse.down();
  await page.mouse.move(from.x + 90, from.y + 40, { steps: 3 });
  // Hold near the right edge. Without this the last quarters cannot be reached
  // by pointer at all — a hit test only sees what is on screen.
  await page.mouse.move(box.x + box.width - 20, from.y + 60, { steps: 3 });
  await page.waitForTimeout(500);

  const scrolled = await scroller.evaluate((n) => n.scrollLeft);
  await page.mouse.up();

  expect(scrolled).toBeGreaterThan(0);
  // Snapping stands down for the drag and comes back after it.
  await expect(scroller).not.toHaveAttribute('data-dragging', 'true');
});

/**
 * The bug the user hit: dropping an Idea onto any team other than the one it
 * already named. The Commit Gate refused, the rollback wiped the explanation,
 * and the whole gesture did nothing at all — with the preview still saying it
 * was fine. Dropping on a row now means that team owns the work.
 */
test('an Idea can be dropped on a team that does not already own it', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await freshApp(page);
  await page.getByRole('button', { name: 'Load sample workspace' }).click();
  await page.getByRole('button', { name: 'Detail', exact: true }).click();

  // "Request to pay" belongs to Payments. Platform is the second row.
  const idea = page.locator('.fm-idea').filter({ hasText: 'Request to pay' });
  const platformRow = page.locator('.fm-grid [role="row"]').filter({ hasText: 'Platform' });
  const target = platformRow.locator('[data-drop-quarter="2026-Q4"]').first();

  // Detail is a real zoom now, so the second row can sit below the fold — and a
  // hit test only sees what is on screen.
  await target.scrollIntoViewIfNeeded();
  const from = await idea.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error('missing geometry');

  await page.mouse.move(from.x + 40, from.y + 15);
  await page.mouse.down();
  await page.mouse.move(from.x + 90, from.y + 40, { steps: 3 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });

  // The reassignment is stated before it happens, not discovered afterwards.
  await expect(target).toHaveAttribute('data-drop', 'ok');
  await expect(target).toContainText('becomes the owner');

  await page.mouse.up();

  await expect(target).toContainText('Request to pay');
  await expect(page.locator('.fm-idea').filter({ hasText: 'Request to pay' })).toHaveCount(0);
});

/**
 * Taking work back off the board — the same gesture as putting it on, run
 * backwards. Not a delete: the commitment survives and returns to demand.
 */
test('a block dragged back to the lane returns to demand', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await freshApp(page);
  await page.getByRole('button', { name: 'Load sample workspace' }).click();
  await page.getByRole('button', { name: 'Detail', exact: true }).click();

  // Place an Idea first, so there is something with exactly one placement.
  const idea = page.locator('.fm-idea').filter({ hasText: 'Request to pay' });
  const cell = page.locator('[data-drop-team][data-drop-quarter="2026-Q4"]').first();
  const from = await idea.boundingBox();
  const to = await cell.boundingBox();
  if (!from || !to) throw new Error('missing geometry');

  await page.mouse.move(from.x + 40, from.y + 15);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(cell).toContainText('Request to pay');

  // Now drag it back.
  const block = cell.getByRole('gridcell', { name: /^Request to pay/ });
  const rail = page.locator('.fm-ideas');
  const blockBox = await block.boundingBox();
  const railBox = await rail.boundingBox();
  if (!blockBox || !railBox) throw new Error('missing geometry');

  await page.mouse.move(blockBox.x + 40, blockBox.y + blockBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(blockBox.x - 60, blockBox.y + 20, { steps: 4 });
  await page.mouse.move(railBox.x + railBox.width / 2, railBox.y + 200, { steps: 8 });

  // The lane says what it will do before it does it.
  await expect(rail).toHaveAttribute('data-drop', 'ok');
  await expect(rail).toContainText('Return Request to pay to the demand lane');

  await page.mouse.up();

  await expect(page.locator('.fm-idea').filter({ hasText: 'Request to pay' })).toHaveCount(1);
  await expect(cell).not.toContainText('Request to pay');
});

test('work already in delivery is refused, with the reason, not silently', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await freshApp(page);
  await page.getByRole('button', { name: 'Load sample workspace' }).click();
  await page.getByRole('button', { name: 'Detail', exact: true }).click();

  // "Legacy gateway decommission" is IN_DELIVERY in the fixture.
  const block = page
    .getByRole('gridcell', { name: /^Payments\. 2026-Q3/ })
    .getByRole('gridcell', { name: /^Legacy gateway decommission/ });
  const rail = page.locator('.fm-ideas');
  const blockBox = await block.boundingBox();
  const railBox = await rail.boundingBox();
  if (!blockBox || !railBox) throw new Error('missing geometry');

  await page.mouse.move(blockBox.x + 40, blockBox.y + blockBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(blockBox.x - 60, blockBox.y + 20, { steps: 4 });
  await page.mouse.move(railBox.x + railBox.width / 2, railBox.y + 200, { steps: 8 });

  await expect(rail).toHaveAttribute('data-drop', 'no');
  await expect(rail).toContainText('cannot go back to the lane');

  await page.mouse.up();
  // Refused means unchanged.
  await expect(page.getByRole('gridcell', { name: /^Payments\. 2026-Q3/ })).toContainText(
    'Legacy gateway decommission',
  );
});

/**
 * Delete unplaces from *this* quarter. "Core ledger consolidation" runs across
 * Platform and Data, so taking it off one is a capacity change, not a lifecycle
 * one — it stays in delivery on the other team and must not reappear as demand.
 */
test('Delete on a focused block unplaces it from that quarter only', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await freshApp(page);
  await page.getByRole('button', { name: 'Load sample workspace' }).click();
  await page.getByRole('button', { name: 'Detail', exact: true }).click();

  const platform = page.getByRole('gridcell', { name: /^Platform\. 2026-Q3/ });
  const data = page.getByRole('gridcell', { name: /^Data\. 2026-Q3/ });
  await expect(platform).toContainText('92%');

  await platform.getByRole('gridcell', { name: /^Core ledger consolidation/ }).focus();
  await page.keyboard.press('Delete');

  await expect(platform).not.toContainText('Core ledger consolidation');
  // The capacity it was using comes back.
  await expect(platform).toContainText('54%');
  // The other placement is untouched, and it is not demand again.
  await expect(data).toContainText('Core ledger consolidation');
  await expect(
    page.locator('.fm-idea').filter({ hasText: 'Core ledger consolidation' }),
  ).toHaveCount(0);
});

test('Delete returns work to demand when it was its last placement', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await freshApp(page);
  await page.getByRole('button', { name: 'Load sample workspace' }).click();
  await page.getByRole('button', { name: 'Detail', exact: true }).click();

  // "TLS and cipher currency" is COMMITTED on Security alone.
  const cell = page.getByRole('gridcell', { name: /^Security\. 2026-Q4/ });
  await cell.getByRole('gridcell', { name: /^TLS and cipher currency/ }).focus();
  await page.keyboard.press('Delete');

  await expect(cell).not.toContainText('TLS and cipher currency');
  await expect(page.locator('.fm-idea').filter({ hasText: 'TLS and cipher currency' })).toHaveCount(
    1,
  );
});

test('a closed quarter refuses to give work up, and says so', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await freshApp(page);
  await page.getByRole('button', { name: 'Load sample workspace' }).click();
  await page.getByRole('button', { name: 'Detail', exact: true }).click();

  // 2026-Q2 is settled history; the domain will not edit it.
  const cell = page.getByRole('gridcell', { name: /^Payments\. 2026-Q2/ });
  const block = cell.getByRole('gridcell', { name: /^Payment reference enrichment/ });
  const rail = page.locator('.fm-ideas');

  const blockBox = await block.boundingBox();
  const railBox = await rail.boundingBox();
  if (!blockBox || !railBox) throw new Error('missing geometry');

  await page.mouse.move(blockBox.x + 40, blockBox.y + blockBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(blockBox.x - 40, blockBox.y + 20, { steps: 4 });
  await page.mouse.move(railBox.x + railBox.width / 2, railBox.y + 200, { steps: 8 });

  await expect(rail).toHaveAttribute('data-drop', 'no');
  await expect(rail).toContainText('that quarter is closed');

  await page.mouse.up();
  await expect(cell).toContainText('Payment reference enrichment');
});

/**
 * Taking work off the board is a revert *and* a removal. Undoing only half of
 * it left the work visible as a block on the board and in the demand lane at
 * once — an Idea occupying a capacity block, which the model forbids. One user
 * action is one undo.
 */
test('one undo puts unplaced work back, not half of it', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await freshApp(page);
  await page.getByRole('button', { name: 'Load sample workspace' }).click();
  await page.getByRole('button', { name: 'Detail', exact: true }).click();

  const cell = page.getByRole('gridcell', { name: /^Security\. 2026-Q4/ });
  await cell.getByRole('gridcell', { name: /^TLS and cipher currency/ }).focus();
  await page.keyboard.press('Delete');

  await expect(page.locator('.fm-idea').filter({ hasText: 'TLS and cipher currency' })).toHaveCount(
    1,
  );

  await page.getByRole('button', { name: 'Undo' }).click();

  // Back on the board as committed work, and gone from the lane — never both.
  await expect(cell).toContainText('TLS and cipher currency');
  await expect(page.locator('.fm-idea').filter({ hasText: 'TLS and cipher currency' })).toHaveCount(
    0,
  );
  await expect(cell.getByRole('gridcell', { name: /^TLS and cipher currency/ })).toHaveAttribute(
    'aria-label',
    /Committed/,
  );
});

/**
 * Size is the only thing about a footprint anyone argues about, so it has to
 * be adjustable where the consequence is already drawn — on the block, against
 * the rule. Before this there was no way to change it at all: a dropped Idea
 * landed at S and stayed there.
 */
test('a block can be resized by dragging its top edge', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await freshApp(page);
  await page.getByRole('button', { name: 'Load sample workspace' }).click();
  await page.getByRole('button', { name: 'Detail', exact: true }).click();

  const cell = page.getByRole('gridcell', { name: /^Security\. 2026-Q4/ });
  const block = cell.getByRole('gridcell', { name: /^TLS and cipher currency/ });
  await expect(block).toHaveAttribute('aria-label', /20 units/);

  // A hit test only sees what is on screen, and this row is below the fold.
  await block.scrollIntoViewIfNeeded();
  const box = await block.boundingBox();
  if (!box) throw new Error('missing geometry');

  // Grab the top edge and pull upward: the block grows towards the rule.
  await page.mouse.move(box.x + box.width / 2, box.y + 1);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y - 30, { steps: 8 });
  await page.mouse.up();

  await expect(block).not.toHaveAttribute('aria-label', /20 units/);
  const label = (await block.getAttribute('aria-label')) ?? '';
  const units = Number(/(\d+) units/.exec(label)?.[1] ?? 0);
  expect(units).toBeGreaterThan(20);
});

test('a block can be resized from the keyboard, and undone', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await freshApp(page);
  await page.getByRole('button', { name: 'Load sample workspace' }).click();
  await page.getByRole('button', { name: 'Detail', exact: true }).click();

  const cell = page.getByRole('gridcell', { name: /^Security\. 2026-Q4/ });
  const block = cell.getByRole('gridcell', { name: /^TLS and cipher currency/ });

  await block.focus();
  await page.keyboard.press('Shift+ArrowUp');
  await expect(block).toHaveAttribute('aria-label', /25 units/);

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(cell.getByRole('gridcell', { name: /^TLS and cipher currency/ })).toHaveAttribute(
    'aria-label',
    /20 units/,
  );
});

test('a resize is never allowed to reach zero units', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await freshApp(page);
  await page.getByRole('button', { name: 'Load sample workspace' }).click();
  await page.getByRole('button', { name: 'Detail', exact: true }).click();

  const block = page
    .getByRole('gridcell', { name: /^Security\. 2026-Q4/ })
    .getByRole('gridcell', { name: /^TLS and cipher currency/ });

  await block.focus();
  // Far more presses than there are units. A footprint of nothing would be a
  // removal, which is a different decision with a different record.
  for (let i = 0; i < 30; i++) await page.keyboard.press('Shift+ArrowDown');

  await expect(block).toHaveAttribute('aria-label', /\b1 units?\b/);
});

/**
 * The detail panel (M2-COM-2). Before this there was nowhere at all to see or
 * edit an entity: owner, outcome, target, confidence, notes — all unreachable,
 * though the sample workspace held them.
 */
test('selecting work opens a panel that can edit it', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await freshApp(page);
  await page.getByRole('button', { name: 'Load sample workspace' }).click();
  await page.getByRole('button', { name: 'Detail', exact: true }).click();

  await page
    .getByRole('gridcell', { name: /^Payments\. 2026-Q3/ })
    .getByRole('gridcell', { name: /^SEPA instant payments/ })
    .click();

  const panel = page.getByRole('complementary', { name: /SEPA instant payments/ });
  await expect(panel).toBeVisible();

  // The sections the spec names, in the order it names them.
  for (const section of ['Identity', 'Planning', 'Outcome', 'Attention', 'Management context']) {
    await expect(panel.getByRole('heading', { name: section })).toBeVisible();
  }

  // An edit is a command: it survives a reload.
  const outcome = panel.getByPlaceholder('What will be true once this is done?');
  await outcome.fill('Instant payments live for retail clients');
  await outcome.blur();

  await page.reload();
  await page
    .getByRole('gridcell', { name: /^Payments\. 2026-Q3/ })
    .getByRole('gridcell', { name: /^SEPA instant payments/ })
    .click();
  await expect(page.getByRole('complementary')).toContainText(
    'Instant payments live for retail clients',
  );
});

/**
 * Spec 06 §8 makes the tooltip format a hard requirement: a definition, what
 * the thing is *not*, and an example where one helps. The second part is what
 * stops five teams inventing five meanings for "size".
 */
test('every explained field says what it is not, as well as what it is', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await freshApp(page);
  await page.getByRole('button', { name: 'Load sample workspace' }).click();
  await page.getByRole('button', { name: 'Detail', exact: true }).click();

  await page
    .getByRole('gridcell', { name: /^Payments\. 2026-Q3/ })
    .getByRole('gridcell', { name: /^SEPA instant payments/ })
    .click();

  const panel = page.getByRole('complementary');
  await panel.getByRole('button', { name: /What does Units mean/ }).click();

  const tip = panel.locator('.fm-field__tip').filter({ hasText: 'share of one team' });
  await expect(tip).toBeVisible();
  await expect(tip).toContainText('It is not');
  await expect(tip).toContainText('story-point');
  await expect(tip).toContainText('For example');
});

test('the target quarter is chosen on a strip, not typed', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await freshApp(page);
  await page.getByRole('button', { name: 'Load sample workspace' }).click();
  await page.getByRole('button', { name: 'Detail', exact: true }).click();

  await page
    .getByRole('gridcell', { name: /^Payments\. 2026-Q3/ })
    .getByRole('gridcell', { name: /^SEPA instant payments/ })
    .click();

  const strip = page.getByRole('radiogroup', { name: 'Target quarter' });
  await expect(strip.getByRole('radio')).toHaveCount(6);

  await strip.getByRole('radio', { name: /2027-Q1/ }).click();
  await expect(strip.getByRole('radio', { name: /2027-Q1/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );

  // Clicking the chosen quarter again clears it: a target is a statement, and
  // there has to be a way to stop making one.
  await strip.getByRole('radio', { name: /2027-Q1/ }).click();
  await expect(strip.getByRole('radio', { name: /2027-Q1/ })).toHaveAttribute(
    'aria-checked',
    'false',
  );
});

/**
 * Relations (M2-COM-6/7/8/9). The sample workspace has always held product
 * impacts, dependencies, milestones and links; until schema v2 they were
 * dropped at seed time and nothing could show them.
 */
test('the panel shows the relations the workspace actually holds', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await freshApp(page);
  await page.getByRole('button', { name: 'Load sample workspace' }).click();
  await page.getByRole('button', { name: 'Detail', exact: true }).click();

  await page
    .getByRole('gridcell', { name: /^Payments\. 2026-Q3/ })
    .getByRole('gridcell', { name: /^Instant payments regulation/ })
    .click();

  const panel = page.getByRole('complementary');
  for (const section of ['Impact', 'Dependencies', 'Milestones', 'Links']) {
    await expect(panel.getByRole('heading', { name: section })).toBeVisible();
  }

  // A typed impact, from the fixture.
  await expect(panel).toContainText('Payments Hub');
  await expect(
    panel.getByRole('radio', { name: 'Primary' }).and(panel.locator('[aria-checked="true"]')),
  ).toBeVisible();
});

test('a link must be https, and says so before it is refused', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await freshApp(page);
  await page.getByRole('button', { name: 'Load sample workspace' }).click();
  await page.getByRole('button', { name: 'Detail', exact: true }).click();

  await page
    .getByRole('gridcell', { name: /^Payments\. 2026-Q3/ })
    .getByRole('gridcell', { name: /^Instant payments regulation/ })
    .click();

  const panel = page.getByRole('complementary');
  const url = panel.getByRole('textbox', { name: 'Link' });
  await url.fill('http://insecure.test/ticket');

  await expect(panel.getByText('Links must start with https://')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Add link' })).toBeDisabled();

  await url.fill('https://secure.test/ticket');
  await expect(panel.getByRole('button', { name: 'Add link' })).toBeEnabled();
  await panel.getByRole('button', { name: 'Add link' }).click();

  await expect(panel.getByRole('link', { name: 'https://secure.test/ticket' })).toBeVisible();
});

test('milestones stop at six, and say why', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await freshApp(page);
  await page.getByRole('button', { name: 'Load sample workspace' }).click();
  await page.getByRole('button', { name: 'Detail', exact: true }).click();

  await page
    .getByRole('gridcell', { name: /^Payments\. 2026-Q3/ })
    .getByRole('gridcell', { name: /^Instant payments regulation/ })
    .click();

  const panel = page.getByRole('complementary');
  const add = panel.getByRole('textbox', { name: 'Add milestone' });

  for (let i = 0; i < 8; i++) {
    if (!(await add.isVisible())) break;
    await add.fill(`Milestone ${i}`);
    await add.press('Enter');
  }

  await expect(panel.getByText('Six is the limit')).toBeVisible();
});

test('a focused commitment draws its dependencies on the board', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await freshApp(page);
  await page.getByRole('button', { name: 'Load sample workspace' }).click();
  await page.getByRole('button', { name: 'Detail', exact: true }).click();

  // Nothing focused: no connectors, because drawing the whole graph at once is
  // noise rather than information.
  await expect(page.locator('.fm-deps__edge')).toHaveCount(0);

  await page
    .getByRole('gridcell', { name: /^Payments\. 2026-Q3/ })
    .getByRole('gridcell', { name: /^Instant payments regulation/ })
    .click();

  const edges = page.locator('.fm-deps__edge');
  await expect(edges.first()).toBeVisible();
  // Never colour alone: the type is written along the line.
  await expect(page.locator('.fm-deps')).toContainText(/Requires|Needs|Blocked|Depends/);
});

/**
 * The Commit Gate, shown rather than merely enforced (M2-COM-10). Blockers
 * stop the transition and name the specific missing thing; advisories never
 * stop anything. Overflow is in neither list.
 */
test('the gate names what is blocking, and what is merely worth asking', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await freshApp(page);
  await page.getByRole('button', { name: 'Load sample workspace' }).click();

  // An Idea, which by definition has not been placed.
  await page.locator('.fm-idea').filter({ hasText: 'FX pricing transparency' }).click();

  const gate = page.getByRole('region', { name: /Commit Gate for FX pricing/ });
  await expect(gate).toBeVisible();

  // A blocker names the specific missing thing, never "not ready".
  await expect(gate).toContainText('needs at least one capacity footprint');
  await expect(gate.getByRole('button', { name: 'Commit' })).toBeDisabled();

  // Advisories are listed and do not block.
  await expect(gate).toContainText('none of these will stop you');
  await expect(gate).toContainText('No outcome is stated');
});

test('the gate stops blocking once the work is placed', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await freshApp(page);
  await page.getByRole('button', { name: 'Load sample workspace' }).click();
  await page.getByRole('button', { name: 'Detail', exact: true }).click();

  const idea = page.locator('.fm-idea').filter({ hasText: 'Request to pay' });
  const cell = page.locator('[data-drop-team][data-drop-quarter="2026-Q4"]').first();
  const from = await idea.boundingBox();
  const to = await cell.boundingBox();
  if (!from || !to) throw new Error('missing geometry');

  await page.mouse.move(from.x + 40, from.y + 15);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 6 });
  await page.mouse.up();

  // Dropping it takes it through the gate, so it is committed and the gate is
  // no longer the question.
  await expect(cell).toContainText('Request to pay');
  await expect(page.getByRole('region', { name: /Commit Gate/ })).toHaveCount(0);
});

/**
 * Unplanned work (M2-COM-11): one action, and never straight into delivery —
 * work created in IN_DELIVERY would be consuming capacity nobody agreed to.
 */
test('unplanned work is captured, placed and committed in one action', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await freshApp(page);
  await page.getByRole('button', { name: 'Load sample workspace' }).click();
  await page.getByRole('button', { name: 'Detail', exact: true }).click();
  await openEditor(page);

  const form = page.getByRole('form', { name: 'Capture unplanned work' });
  await form.getByLabel('Capture unplanned work').fill('Incident follow-up');
  await form.getByRole('button', { name: 'Capture and commit' }).click();

  const block = page
    .getByRole('gridcell', { name: /^Payments\. 2026-Q3/ })
    .getByRole('gridcell', { name: /^Incident follow-up/ });
  await expect(block).toBeVisible();
  // Committed, not in delivery.
  await expect(block).toHaveAttribute('aria-label', /Committed/);
  // And it is not left sitting in the demand lane as well.
  await expect(page.locator('.fm-idea').filter({ hasText: 'Incident follow-up' })).toHaveCount(0);
});

/**
 * Drawing a dependency (M2-COM-9, and the keyboard half of M2-A11Y-3). The
 * gesture is the same as moving work — pick up, pass over, release — because a
 * dependency is the same question asked of two pieces of work instead of one.
 */
test('shift-dragging between two blocks draws a dependency', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await freshApp(page);
  await page.getByRole('button', { name: 'Load sample workspace' }).click();
  await page.getByRole('button', { name: 'Detail', exact: true }).click();

  const source = page
    .getByRole('gridcell', { name: /^Payments\. 2026-Q3/ })
    .getByRole('gridcell', { name: /^SEPA instant payments/ });
  const target = page
    .getByRole('gridcell', { name: /^Platform\. 2026-Q3/ })
    .getByRole('gridcell', { name: /^Container platform upgrade/ });

  // Both ends have to be on screen: a hit test only sees what is rendered, and
  // the columns size to the window now rather than to the longest caption.
  await target.scrollIntoViewIfNeeded();
  await source.scrollIntoViewIfNeeded();
  const a = await source.boundingBox();
  const b = await target.boundingBox();
  if (!a || !b) throw new Error('missing geometry');

  await page.keyboard.down('Shift');
  await page.mouse.move(a.x + 60, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + 100, a.y + a.height / 2 + 20, { steps: 3 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Shift');

  // Visual creation defaults to REQUIRES, and the panel now lists it.
  await source.click();
  const panel = page.getByRole('complementary');
  await expect(panel.getByRole('heading', { name: 'Dependencies' })).toBeVisible();
  await expect(panel).toContainText('Container platform upgrade');

  // And it is drawn on the board, since the source is now focused.
  await expect(page.locator('.fm-deps__edge').first()).toBeVisible();
});

test('work cannot be made to depend on itself', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await freshApp(page);
  await page.getByRole('button', { name: 'Load sample workspace' }).click();
  await page.getByRole('button', { name: 'Detail', exact: true }).click();

  const block = page
    .getByRole('gridcell', { name: /^Payments\. 2026-Q4/ })
    .getByRole('gridcell', { name: /^Instant payments regulation/ });
  await block.scrollIntoViewIfNeeded();

  // This work already has dependencies, so the question is whether the count
  // grows — an empty-section check would prove nothing here.
  await block.click();
  const rows = page.getByRole('complementary').locator('.fm-panel__list li');
  const before = await rows.count();
  await page.getByRole('button', { name: 'Close' }).click();

  const box = await block.boundingBox();
  if (!box) throw new Error('missing geometry');

  await page.keyboard.down('Shift');
  await page.mouse.move(box.x + 60, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 100, box.y + box.height / 2 + 10, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Shift');

  // Press-and-release on one block also selects it, so the panel reopens on
  // the very work the link was refused for.
  await expect(page.getByRole('complementary')).toBeVisible();
  expect(await rows.count(), 'a self-dependency was created').toBe(before);
});
