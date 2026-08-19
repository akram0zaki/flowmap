/** M4 scenarios remain explicit, comparable, and fully operable without a drag. */

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

test('a QBR placement stays a private scenario ghost until its explicit apply', async ({
  page,
}) => {
  await sample(page);

  const newScenario = page.getByRole('button', { name: 'New scenario' });
  await newScenario.focus();
  await newScenario.press('Enter');
  await expect(page.getByRole('region', { name: 'Scenario workspace' })).toContainText('Draft');

  await page.getByRole('button', { name: /7 QBR/ }).click();
  await page.getByLabel('QBR view').selectOption('Demand');
  const ideas = page.getByRole('listbox', { name: 'Ideas and demand' });
  await ideas.focus();
  await ideas.press('m');
  await expect(
    page.getByRole('region', { name: 'Demand Flow' }).locator('.fm-visually-hidden'),
  ).toContainText('Move mode. Arrow keys choose a team and quarter');
  await ideas.press('Enter');

  const dock = page.getByRole('region', { name: 'Scenario workspace' });
  await expect(dock).toContainText('3 planning changes');
  await expect(dock.getByRole('region', { name: 'Scenario change list' })).not.toContainText(
    'No management-level changes yet',
  );

  await dock.getByRole('button', { name: 'Apply scenario' }).click();
  const preview = page.getByRole('dialog', { name: 'Consequence preview' });
  await expect(preview).toBeVisible();
  await expect(
    preview.getByText('Applying this scenario creates a snapshot and clears undo history.'),
  ).toBeVisible();
  await axe(page, 'scenario consequence preview');
  await preview.getByRole('button', { name: 'Cancel' }).click();
});
