/**
 * Getting a workspace out of one browser and into another.
 *
 * The export button has always written a `.flowmap` package. Nothing could read
 * one back: the decoder existed and was round-trip tested inside the
 * import-export package, but the app never called it, the file picker did not
 * accept the extension, and a file the tabular importer could not read set an
 * empty preview and returned — so choosing one did nothing, and said nothing.
 */

import { expect, test, type Page } from '@playwright/test';

import { freshApp, openSampleWorkspace } from './helpers.js';

/** What the board is showing, as a shape two workspaces can be compared on. */
async function board(page: Page) {
  return page.evaluate(() => ({
    workspace: document.querySelector('.fm-workspace-switcher summary')?.textContent?.trim() ?? '',
    teams: [...document.querySelectorAll('.fm-grid__team')]
      .map((node) => (node.textContent ?? '').trim().split('↑')[0] ?? '')
      .filter(Boolean),
    commitmentIds: [...document.querySelectorAll('[data-commitment]')].map(
      (node) => node.getAttribute('data-commitment') ?? '',
    ),
  }));
}

/**
 * Exports the open workspace and returns the bytes, without going near the
 * download directory — the package is captured as it is handed to the browser.
 */
async function exportedBytes(page: Page): Promise<number[]> {
  await page.evaluate(() => {
    const real = URL.createObjectURL.bind(URL);
    (window as unknown as { __captured?: Blob }).__captured = undefined;
    URL.createObjectURL = (blob: Blob) => {
      (window as unknown as { __captured?: Blob }).__captured = blob;
      return real(blob);
    };
  });

  await page.locator('.fm-portability > summary').click();
  // Exact: the panel also has a "JSON" button labelled "Export workspace data as JSON".
  await page.getByRole('button', { name: 'Export workspace', exact: true }).click();

  return page.evaluate(async () => {
    const blob = (window as unknown as { __captured?: Blob }).__captured;
    if (!blob) throw new Error('the export handed no package to the browser');
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
}

async function importPackage(page: Page, bytes: number[]): Promise<void> {
  await page.evaluate((data) => {
    const file = new File([new Uint8Array(data)], 'workspace.flowmap', {
      type: 'application/octet-stream',
    });
    const input = document.querySelector<HTMLInputElement>('.fm-portability input[type="file"]')!;
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, bytes);
}

async function switchTo(page: Page, name: string): Promise<void> {
  await page.locator('details.fm-workspace-switcher > summary').click();
  await page.getByRole('button', { name, exact: true }).click();
  await expect.poll(async () => (await board(page)).workspace).toContain(name);
}

test('a workspace package can be exported and imported back', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await freshApp(page);
  await openSampleWorkspace(page);

  const before = await board(page);
  expect(before.commitmentIds.length).toBeGreaterThan(0);

  const bytes = await exportedBytes(page);
  expect(bytes.length).toBeGreaterThan(0);
  await importPackage(page, bytes);

  // It opens as a workspace of its own, carrying the portfolio with it.
  await expect.poll(async () => (await board(page)).workspace).toContain('(imported)');
  const imported = await board(page);
  expect(imported.teams).toEqual(before.teams);
  expect(imported.commitmentIds.length).toBe(before.commitmentIds.length);

  /*
   * And it is a copy. Rows are keyed by entity id, so importing a package that
   * came from this machine while keeping its ids does not copy anything — it
   * rewrites the existing rows' workspace and moves the portfolio out of the
   * workspace it was in. The first version of this did exactly that, and the
   * source workspace came back empty.
   */
  expect(imported.commitmentIds).not.toEqual(before.commitmentIds);

  await page.locator('.fm-portability').evaluate((node: HTMLDetailsElement) => {
    node.open = false;
  });
  await switchTo(page, before.workspace);
  const source = await board(page);
  expect(source.teams).toEqual(before.teams);
  expect(source.commitmentIds).toEqual(before.commitmentIds);
});

// Silence was the reported bug: choosing a file the importer could not read
// left the panel looking exactly as it had a moment earlier.
test('a file with nothing to import says so rather than doing nothing', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await freshApp(page);
  await openSampleWorkspace(page);

  await page.locator('.fm-portability > summary').click();
  await page.evaluate(() => {
    // The shape this app's own JSON export used to produce: an envelope whose
    // entities are nested, which the row importer found nothing in.
    const file = new File(
      [JSON.stringify({ _README: {}, notes: 'no rows in here' })],
      'nothing.json',
      {
        type: 'application/json',
      },
    );
    const input = document.querySelector<HTMLInputElement>('.fm-portability input[type="file"]')!;
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });

  await expect(page.locator('.fm-portability')).toContainText('nothing.json');
});
