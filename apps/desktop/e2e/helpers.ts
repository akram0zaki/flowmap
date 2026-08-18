import { expect, type Page } from '@playwright/test';

/** Empty personal workspace plus a switchable sample, then wait for the shell. */
export async function freshApp(page: Page) {
  await page.goto('/');
  await page.evaluate(() => globalThis.localStorage.clear());
  await page.reload();
  await expect(page.getByRole('heading', { name: /flowmap/i })).toBeVisible();
}

/**
 * Open the dedicated sample workspace.
 *
 * First launch uses the first-run action. Later visits switch (or reset if the
 * sample is already open). Never overwrites the personal workspace.
 */
export async function openSampleWorkspace(page: Page) {
  const explore = page.getByRole('button', { name: 'Explore sample workspace' });
  if (await explore.isVisible()) {
    await explore.click();
    return;
  }
  const reset = page.getByRole('button', { name: 'Reset sample workspace' });
  if (await reset.isVisible()) {
    await reset.click();
    return;
  }
  await page.locator('details.fm-workspace-switcher > summary').click();
  await page.getByRole('button', { name: /retail payments & channels \(sample\)/i }).click();
}
