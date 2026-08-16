import { expect, test } from '@playwright/test';

/**
 * The upgrade path, end to end: a workspace saved by a build that predates the
 * relation buckets must still open. Every other test starts by clearing
 * storage, which is exactly why this failure reached a user.
 */
test('a workspace saved by an older build still opens', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.goto('/');
  await page.evaluate(() => globalThis.localStorage.clear());
  await page.reload();

  // Build a real workspace, then strip it back to the shape an older build
  // would have written — no relation buckets at all.
  await page.getByRole('button', { name: 'Load sample workspace' }).click();
  await expect(page.getByRole('grid').first().getByRole('rowheader')).toHaveCount(5);

  const key = 'flowmap.dev.workspace';
  await page.evaluate((storageKey) => {
    const raw = globalThis.localStorage.getItem(storageKey);
    if (!raw) throw new Error('nothing was persisted');
    const snapshot = JSON.parse(raw) as Record<string, unknown>;
    for (const bucket of [
      'products',
      'productImpacts',
      'dependencies',
      'decisions',
      'milestones',
      'themes',
      'commitmentThemes',
      'externalLinks',
      'people',
    ]) {
      delete snapshot[bucket];
    }
    globalThis.localStorage.setItem(storageKey, JSON.stringify(snapshot));
  }, key);

  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.reload();

  // The board comes back, with the work it had, and nothing thrown on the way.
  await expect(page.getByRole('grid').first().getByRole('rowheader')).toHaveCount(5);
  await expect(page.getByRole('gridcell', { name: /^Payments\. 2026-Q3/ })).toContainText('121%');
  expect(errors, 'errors while loading an older workspace').toEqual([]);
});
