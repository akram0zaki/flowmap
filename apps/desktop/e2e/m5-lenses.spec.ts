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
  await expect(page.getByRole('table', { name: /Dependency table/ })).toBeVisible();
  await page.getByRole('button', { name: /3 Products/ }).click();
  await expect(page.getByRole('heading', { name: 'Products and services' })).toBeVisible();
  await axe(page, 'product lens');
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
