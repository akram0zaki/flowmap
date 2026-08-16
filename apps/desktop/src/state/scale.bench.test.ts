/**
 * What the board actually costs at 500 commitments.
 *
 * The e2e budgets in `e2e/scale.spec.ts` include Playwright's own
 * round trips, which dominate them — they catch an order-of-magnitude
 * regression and nothing finer. This measures the work itself: building the
 * board projection, and answering a drop preview for every visible cell, which
 * is what runs on every pointer move during a drag.
 *
 * Thresholds are generous against the spec's figures because CI hardware is not
 * the reference device (spec 11 §6.1). They exist to fail loudly when something
 * turns linear work quadratic, which is the regression that actually happens.
 */

import { describe, expect, it } from 'vitest';
import { scaleFixture } from '@flowmap/fixtures';
import { buildBoard, previewDrop, type DragPayload } from '@flowmap/visual-model';

/** Local, so this file needs no dependency on the test-helper package. */
const byId = <T extends { id: string }>(items: readonly T[]) =>
  new Map(items.map((item) => [item.id, item]));

function boardAt(size: 25 | 100 | 500) {
  const fixture = scaleFixture(size);
  return buildBoard({
    workspace: fixture.workspace,
    teams: byId(fixture.teams),
    teamQuarters: byId(fixture.teamQuarters),
    commitments: byId(fixture.commitments),
    footprints: byId(fixture.footprints),
  });
}

/** Median of several runs: one run on a shared CI box measures the weather. */
function medianMs(run: () => void, samples = 7): number {
  const times: number[] = [];
  for (let i = 0; i < samples; i++) {
    const started = performance.now();
    run();
    times.push(performance.now() - started);
  }
  return times.sort((a, b) => a - b)[Math.floor(samples / 2)]!;
}

describe('board projection at scale', () => {
  it('builds a 500-commitment board well inside a frame budget', () => {
    const elapsed = medianMs(() => boardAt(500));
    expect(elapsed, `buildBoard at 500 took ${elapsed.toFixed(1)} ms`).toBeLessThan(150);
  });

  /**
   * The shape that matters more than the absolute number: twenty times the work
   * must not cost hundreds of times the time. A quadratic lookup inside the
   * layout would sail past a fixed threshold on a fast machine and fail on a
   * laptop; this catches it wherever it runs.
   */
  it('scales roughly with the work, not with its square', () => {
    const small = Math.max(
      medianMs(() => boardAt(25)),
      0.01,
    );
    const large = medianMs(() => boardAt(500));

    // 20x the commitments. Linear would be ~20x; quadratic would be ~400x.
    expect(large / small, `25→500 cost ratio was ${(large / small).toFixed(1)}x`).toBeLessThan(60);
  });

  it('answers a drop preview for every cell faster than a frame', () => {
    const board = boardAt(500);
    const payload: DragPayload = {
      kind: 'IDEA',
      commitmentId: 'i-1',
      name: 'Request to pay',
      units: 10,
      commitmentClass: 'STRATEGIC',
      hasTargetDate: true,
    };

    // What a single pointer move costs: the board re-asks this question for
    // every cell it draws.
    const elapsed = medianMs(() => {
      for (const row of board.rows) for (const cell of row.cells) previewDrop(cell, payload);
    });

    expect(elapsed, `previewDrop across the board took ${elapsed.toFixed(2)} ms`).toBeLessThan(
      16.7,
    );
  });

  it('aggregates every cell, so Level 1 has the numbers without the blocks', () => {
    const board = boardAt(500);
    const cells = board.rows.flatMap((row) => row.cells);

    expect(cells).toHaveLength(120); // 20 teams × 6 quarters
    expect(cells.every((cell) => cell.signals !== undefined)).toBe(true);
    expect(cells.some((cell) => cell.signals.commitmentCount > 0)).toBe(true);
  });
});
