/**
 * Radar, explanations, dispositions, and rule settings (M3).
 *
 * The properties that matter here are not "does it render" but "does it tell
 * the truth": that a signal explains itself, that suppression is visible, that
 * a health condition cannot be silenced, and that a rejected threshold says why.
 */

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { openSampleWorkspace } from './helpers.js';

async function freshSample(page: Page) {
  await page.goto('/');
  await page.evaluate(() => globalThis.localStorage.clear());
  await page.reload();
  await openSampleWorkspace(page);
  await expect(page.getByRole('button', { name: /^Radar/ })).toBeVisible();
}

async function openRadar(page: Page) {
  await page.getByRole('button', { name: /^Radar/ }).click();
  return page.getByRole('region', { name: 'Radar' });
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

test('the rules produce signals from the sample workspace', async ({ page }) => {
  await freshSample(page);

  // The badge carries a figure, not a bare dot: "something is wrong" without
  // "how much" is not information.
  const badge = page.locator('.fm-radar__badge');
  await expect(badge).toBeVisible();
  expect(Number(await badge.textContent())).toBeGreaterThan(0);

  const radar = await openRadar(page);
  await expect(radar.getByText('Action needed now')).toBeVisible();
  await expectNoAxeViolations(page, 'radar');
});

test('a signal explains itself from data alone', async ({ page }) => {
  await freshSample(page);
  const radar = await openRadar(page);

  const first = radar.locator('.fm-signal__title').first();
  const rule = await first.locator('.fm-signal__rule').textContent();
  const message = await first.locator('.fm-signal__message').textContent();

  // Rendered through the catalogue, so neither may be a raw code.
  expect(rule).not.toMatch(/^[A-Z_]+$/);
  expect(message?.length ?? 0).toBeGreaterThan(10);

  await first.click();
  const detail = radar.locator('.fm-signal__detail').first();

  // Facts, the threshold compared against, why it matters, and the actions.
  await expect(detail.locator('.fm-signal__why')).toBeVisible();
  await expect(detail.locator('.fm-signal__facts')).toBeVisible();
  await expect(detail.locator('.fm-signal__actions button').first()).toBeVisible();

  await expectNoAxeViolations(page, 'expanded signal');
});

test('reviewing a signal hides it and says so', async ({ page }) => {
  await freshSample(page);
  const radar = await openRadar(page);

  const countBefore = Number(await page.locator('.fm-radar__badge').textContent());

  // Expand rows until one offers disposal — health signals deliberately do not.
  const titles = radar.locator('.fm-signal__title');
  let reviewed = false;
  for (let i = 0; i < 12 && !reviewed; i += 1) {
    await titles.nth(i).click();
    const button = radar.getByRole('button', { name: 'Reviewed — no change' });
    if (await button.isVisible().catch(() => false)) {
      await button.click();
      reviewed = true;
    }
  }
  expect(reviewed, 'found an attention signal to review').toBe(true);

  await expect(page.locator('.fm-radar__badge')).toHaveText(String(countBefore - 1));

  // Suppression the user cannot see is suppression they cannot trust.
  await expect(radar.locator('.fm-radar__hidden')).toContainText('hidden until something changes');

  // And it survives a restart, because a disposition is an entity like any other.
  await page.reload();
  await page.getByRole('button', { name: /^Radar/ }).click();
  await expect(page.locator('.fm-radar__badge')).toHaveText(String(countBefore - 1));
});

test('a health signal cannot be disposed of', async ({ page }) => {
  await freshSample(page);
  const radar = await openRadar(page);

  // `LSS_PASSED` surfaces on HEALTH, so it offers Open and nothing else.
  const health = radar.locator('.fm-signal', { hasText: 'Latest safe start passed' }).first();
  await health.locator('.fm-signal__title').click();

  await expect(health.locator('.fm-signal__actions button')).toHaveCount(1);
  await expect(health.getByRole('button', { name: 'Reviewed — no change' })).toHaveCount(0);
});

test('health is a separate answer from attention, and names its conditions', async ({ page }) => {
  await freshSample(page);
  await page.getByRole('button', { name: 'Detail', exact: true }).click();

  const atRisk = page.locator('.fm-block[data-health="AT_RISK"]').first();
  await expect(atRisk).toBeVisible();
  // Never colour alone: the label says it too.
  await expect(atRisk).toHaveAttribute('aria-label', /At risk/);

  await atRisk.click();
  const panel = page.getByRole('complementary', { name: /Details for/ });
  const health = panel.locator('.fm-panel__health');
  await expect(health).toContainText('At risk');
  // The conditions behind the verdict, not just the verdict.
  await expect(health.locator('.fm-panel__hint')).not.toBeEmpty();
});

test('rule settings show live counts and reject out-of-range thresholds', async ({ page }) => {
  await freshSample(page);
  await page.getByRole('button', { name: 'Rules' }).click();

  const settings = page.getByRole('region', { name: 'Rules' });
  const overflow = settings.locator('.fm-rulesettings__rule', { hasText: 'Over capacity' });

  // Evidence-based tuning: what this rule is doing right now.
  await expect(overflow.locator('.fm-rulesettings__count')).toContainText('firing on');
  // Integrity and high-severity capacity rules stay on, and say so.
  await expect(overflow.locator('.fm-rulesettings__locked')).toBeVisible();
  await expect(overflow.locator('input[type="checkbox"]')).toBeDisabled();

  const nearLimit = settings.locator('.fm-rulesettings__rule', { hasText: 'Nearly full' });
  const threshold = nearLimit.locator('input[type="number"]');
  // The permitted range is visible before it is breached, not only after.
  await expect(nearLimit.locator('.fm-rulesettings__range')).toContainText('allowed');

  await threshold.fill('5');
  // Rejected with the range stated, never silently clamped.
  await expect(nearLimit.getByRole('alert')).toContainText('outside the permitted range');

  await expectNoAxeViolations(page, 'rule settings');
});

test('tuning a threshold changes what fires', async ({ page }) => {
  await freshSample(page);
  await page.getByRole('button', { name: 'Rules' }).click();

  const settings = page.getByRole('region', { name: 'Rules' });
  const dueSoon = settings.locator('.fm-rulesettings__rule', { hasText: 'Dependency due soon' });
  const before = await dueSoon.locator('.fm-rulesettings__count').textContent();

  await dueSoon.locator('input[type="number"]').fill('90');
  await expect(dueSoon.locator('.fm-rulesettings__count')).not.toHaveText(before ?? '');
});

test('My Radar holds only work owned individually', async ({ page }) => {
  await freshSample(page);
  const radar = await openRadar(page);

  await radar.getByRole('radio', { name: 'Mine' }).click();
  // The sample has no person linked to this local profile, so My Radar is
  // empty — and says why rather than looking broken.
  await expect(radar.locator('.fm-radar__empty')).toBeVisible();

  await radar.getByRole('radio', { name: 'Portfolio' }).click();
  await expect(radar.locator('.fm-signal').first()).toBeVisible();
});

test("Open scrolls to the signal's cell, not only its quarter column", async ({ page }) => {
  await freshSample(page);
  await page.setViewportSize({ width: 1100, height: 540 });
  const radar = await openRadar(page);

  const titles = radar.locator('.fm-signal__title');
  let opened = false;
  for (let i = 0; i < 16 && !opened; i += 1) {
    await titles.nth(i).click();
    const open = radar.getByRole('button', { name: /^Open/ });
    if (
      await open
        .first()
        .isVisible()
        .catch(() => false)
    ) {
      await open.first().click();
      opened = true;
    }
  }
  expect(opened, 'found a signal with Open').toBe(true);

  const cell = page.locator('.fm-grid__cell[data-cursor]');
  await expect(cell).toBeVisible();
  await expect
    .poll(async () =>
      cell.evaluate((el) => {
        const box = el.getBoundingClientRect();
        const view = el.closest('.fm-map__scroll')?.getBoundingClientRect();
        if (!view) return false;
        const x = box.left + box.width / 2;
        const y = box.top + box.height / 2;
        return x >= view.left && x <= view.right && y >= view.top && y <= view.bottom;
      }),
    )
    .toBe(true);
});

test('Radar and Rules are a single toggle — opening one closes the other', async ({ page }) => {
  await freshSample(page);
  await openRadar(page);
  await expect(page.getByRole('region', { name: 'Radar' })).toBeVisible();

  await page.getByRole('button', { name: 'Rules', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Rules' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Radar' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Rules', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Rules' })).toHaveCount(0);
});

test('the radar is reachable and operable by keyboard', async ({ page }) => {
  await freshSample(page);
  const button = page.getByRole('button', { name: /^Radar/ });
  await button.focus();
  await button.press('Enter');

  const radar = page.getByRole('region', { name: 'Radar' });
  await expect(radar).toBeVisible();

  const first = radar.locator('.fm-signal__title').first();
  await first.focus();
  await first.press('Enter');
  await expect(radar.locator('.fm-signal__detail').first()).toBeVisible();
});
