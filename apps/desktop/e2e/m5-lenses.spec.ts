/** M5 lenses remain understandable by keyboard and retain their table paths. */

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { openSampleWorkspace } from './helpers.js';

async function sample(page: Page) {
  await page.goto('/');
  await page.evaluate(() => globalThis.localStorage.clear());
  await page.reload();
  await openSampleWorkspace(page);
}

async function axe(page: Page, context: string) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    result.violations.flatMap((item) =>
      item.nodes.map((node) => `${item.id} @ ${node.target.join(' ')}`),
    ),
    context,
  ).toEqual([]);
}

test('timeline uses footprint fragments and keeps its precise table companion', async ({
  page,
}) => {
  await sample(page);
  await page.getByRole('button', { name: /8 Timeline/ }).click();
  await expect(page.getByRole('heading', { name: 'Timeline' })).toBeVisible();
  await expect(page.getByRole('table', { name: /Footprints/ })).toBeVisible();
  await axe(page, 'timeline');
});

test('dependency and product lenses are reachable from their fixed keyboard labels', async ({
  page,
}) => {
  await sample(page);
  await page.getByRole('button', { name: /6 Dependencies/ }).click();
  await expect(page.getByRole('heading', { name: 'Dependency map' })).toBeVisible();
  await expect(page.getByText(/each column is one step along the chain/i)).toBeVisible();
  await expect(page.getByText(/a hub is a commitment, decision, or team/i)).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Waiting', exact: true })).toBeVisible();
  await expect(page.locator('.fm-dependency-map__edges path')).not.toHaveCount(0);
  await expect(page.getByRole('table', { name: /Dependency table/ })).toBeVisible();
  await page.getByRole('button', { name: /3 Products/ }).click();
  await expect(page.getByRole('heading', { name: 'Products and services' })).toBeVisible();
  await axe(page, 'product lens');
});

test('QBR is Demand Flow with team-quarter containers, not the Portfolio map', async ({ page }) => {
  await sample(page);
  await page.getByRole('button', { name: /7 QBR/ }).click();
  await expect(page.getByRole('heading', { name: 'QBR' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Demand Flow' })).toBeVisible();
  await expect(page.getByRole('grid', { name: 'Team-quarter containers' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'QBR team-quarter capacity' })).toBeVisible();
  await expect(page.getByRole('grid', { name: /portfolio map/i })).toHaveCount(0);
  await expect(page.getByLabel('QBR view')).toHaveCount(0);
  await axe(page, 'qbr lens');
});

test('attention lens lists signals instead of the commitment map', async ({ page }) => {
  await sample(page);
  await page.getByRole('button', { name: /5 Attention/ }).click();
  await expect(page.getByRole('heading', { name: 'Attention' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Attention signals' })).toBeVisible();
  await expect(page.getByRole('grid', { name: /portfolio map/i })).toHaveCount(0);
  await axe(page, 'attention lens');
});

test('teams lens shows horizon capacity instead of the commitment map', async ({ page }) => {
  await sample(page);
  await expect(page.getByRole('grid', { name: /portfolio map/i })).toBeVisible();
  await page.getByRole('button', { name: /2 Teams/ }).click();
  await expect(page.getByRole('heading', { name: 'Teams' })).toBeVisible();
  await expect(page.getByText(/can we take this/i)).toBeVisible();
  await expect(page.getByRole('grid', { name: 'Team capacity across the horizon' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Team-quarter capacity' })).toBeVisible();
  await expect(page.getByRole('grid', { name: /portfolio map/i })).toHaveCount(0);
  await axe(page, 'teams lens');

  await page
    .getByRole('button', { name: /Open on the Portfolio map/ })
    .first()
    .click();
  await expect(page.getByRole('grid', { name: /portfolio map/i })).toBeVisible();
});

test('themes retain a precise table companion', async ({ page }) => {
  await sample(page);
  await page.getByRole('button', { name: /4 Themes/ }).click();
  await expect(page.getByRole('heading', { name: 'Themes' })).toBeVisible();
  await expect(page.getByRole('table', { name: /Theme commitments/ })).toBeVisible();
  await axe(page, 'themes lens');
});

test('the command palette finds local work and has no natural-language fallback', async ({
  page,
}) => {
  await sample(page);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible();
  await palette.getByRole('textbox').fill('not a request');
  await expect(
    palette.getByText('No exact local match. Flowmap does not interpret natural language.'),
  ).toBeVisible();
  await palette.getByRole('textbox').fill('filter: quarter 2026-Q3');
  await expect(palette.getByRole('button', { name: /Filter quarter/ })).toBeVisible();
});
