/**
 * M8 shared-provider surfaces: advisory roles copy and sync status.
 */

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('settings states that roles are advisory', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => globalThis.localStorage.clear());
  await page.reload();
  await expect(page.getByRole('heading', { name: /flowmap/i })).toBeVisible();
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByText(/Flowmap does not verify who you are/)).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
});
