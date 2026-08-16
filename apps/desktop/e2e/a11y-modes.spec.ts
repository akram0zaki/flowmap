/**
 * Reduced motion and high contrast, verified end to end (M2-A11Y-6).
 *
 * Both modes existed in the token file and nothing checked they reached the
 * screen. A token nobody consumes is a comment.
 *
 * The rule from spec 06 §12 that these enforce: no state cue is carried by
 * motion alone, and no state cue is carried by colour alone. Turning either off
 * must leave the board saying the same things.
 */

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function board(page: Page) {
  await page.goto('/');
  await page.evaluate(() => globalThis.localStorage.clear());
  await page.reload();
  await page.getByRole('button', { name: 'Load sample workspace' }).click();
  await expect(page.getByRole('grid').first().getByRole('rowheader')).toHaveCount(5);
}

async function axeClean(page: Page, context: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const detail = results.violations.flatMap((v) =>
    v.nodes.map((n) => `${v.id} @ ${n.target.join(' ')}`),
  );
  expect(detail, `axe violations in ${context}`).toEqual([]);
}

test.describe('reduced motion', () => {
  test('turns every transition off, rather than merely shortening it', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 950 });
    // Explicit rather than `test.use({ reducedMotion })`: the fixture form did
    // not reach the page here, and a preference the page never sees would make
    // this test pass against a build that ignores the preference entirely.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await board(page);

    const durations = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      return {
        fast: root.getPropertyValue('--motion-fast').trim(),
        base: root.getPropertyValue('--motion-base').trim(),
        slow: root.getPropertyValue('--motion-slow').trim(),
      };
    });

    expect(durations).toEqual({ fast: '0ms', base: '0ms', slow: '0ms' });

    // And the tokens are actually consumed: a button's transition resolves to
    // zero, not to whatever the stylesheet hard-coded next to the token.
    const transition = await page
      .getByRole('button', { name: 'Overview', exact: true })
      .evaluate((node) => getComputedStyle(node).transitionDuration);
    expect(transition.replace(/[^0-9a-z, ]/g, '')).toMatch(/^0s(, 0s)*$/);
  });

  test('still says everything it said before, with no motion to carry it', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 950 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await board(page);
    await page.getByRole('button', { name: 'Detail', exact: true }).click();

    const payments = page.getByRole('gridcell', { name: /^Payments\. 2026-Q3/ });
    await expect(payments).toContainText('121%');
    await expect(payments).toContainText('+13 over');
    await expect(payments).toContainText('carried over');

    await axeClean(page, 'reduced motion');
  });
});

test.describe('high contrast', () => {
  test('raises the token values it promises to raise', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 950 });
    await board(page);

    const before = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      return {
        inkMuted: root.getPropertyValue('--ink-muted').trim(),
        focus: parseFloat(root.getPropertyValue('--focus-width')),
      };
    });

    await page.evaluate(() => document.documentElement.setAttribute('data-contrast', 'high'));

    const after = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      return {
        inkMuted: root.getPropertyValue('--ink-muted').trim(),
        ink: root.getPropertyValue('--ink').trim(),
        focus: parseFloat(root.getPropertyValue('--focus-width')),
      };
    });

    // Muted ink stops being muted, and the focus ring gets thicker. Compared
    // rather than pinned: the assertion is about the direction of the override,
    // not about a particular number the token file is free to change.
    expect(after.inkMuted).not.toBe(before.inkMuted);
    expect(after.inkMuted).toBe(after.ink);
    expect(after.focus).toBeGreaterThan(before.focus);
  });

  test('leaves every view accessible, at every zoom level', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 950 });
    await board(page);
    await page.evaluate(() => document.documentElement.setAttribute('data-contrast', 'high'));

    for (const level of ['Overview', 'Areas', 'Detail']) {
      await page.getByRole('button', { name: level, exact: true }).click();
      await axeClean(page, `high contrast at ${level}`);
    }
  });

  test('leaves the detail panel and the gate accessible too', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 950 });
    await board(page);
    await page.evaluate(() => document.documentElement.setAttribute('data-contrast', 'high'));

    // A modal-ish surface is exactly where contrast overrides tend to be missed.
    await page.locator('.fm-idea').first().click();
    await expect(page.getByRole('complementary')).toBeVisible();
    await axeClean(page, 'high contrast, detail panel with the gate open');
  });
});

test.describe('dark mode', () => {
  test.use({ colorScheme: 'dark' });

  test('is accessible, and still states over-capacity in words', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 950 });
    await board(page);
    await page.getByRole('button', { name: 'Detail', exact: true }).click();

    await expect(page.getByRole('gridcell', { name: /^Payments\. 2026-Q3/ })).toContainText(
      '+13 over',
    );
    await axeClean(page, 'dark mode');
  });
});
