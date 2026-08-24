import { describe, expect, it } from 'vitest';

import { previewSpan, spanOf, type SpanDrag } from './span.js';
import type { BlockModel, BoardModel, CellModel } from './layout.js';

const QUARTERS = ['2026-Q2', '2026-Q3', '2026-Q4', '2027-Q1'] as const;

function block(commitmentId: string, over: Partial<BlockModel> = {}): BlockModel {
  return {
    footprintId: `fp-${commitmentId}`,
    commitmentId,
    name: 'Payments hub migration',
    units: 30,
    lifecycle: 'COMMITTED',
    commitmentClass: 'STRATEGIC',
    counted: true,
    isPrimary: false,
    bottomUnits: 0,
    topUnits: 30,
    overflowing: false,
    continuesBefore: false,
    continuesAfter: false,
    ...over,
  };
}

function summary() {
  return {
    teamId: 't-1',
    quarterId: '2026-Q3' as const,
    effectiveCapacity: 100,
    reservedTotal: 20,
    deliverableCapacity: 80,
    committedLoad: 30,
    headroom: 50,
    overflow: 0,
    utilisation: 0.375,
  };
}

/**
 * One team row. `held` names the quarters carrying `c-1`; anything in `closed`
 * is settled, and anything in `bare` has no container and no seed.
 */
function board(
  held: readonly string[],
  opts: { closed?: readonly string[]; bare?: readonly string[] } = {},
): BoardModel {
  const cells: CellModel[] = QUARTERS.map((quarterId) => ({
    key: `t-1:${quarterId}`,
    teamId: 't-1',
    teamName: 'Platform',
    quarterId,
    teamQuarter: null,
    summary: opts.bare?.includes(quarterId) ? null : summary(),
    blocks: held.includes(quarterId) ? [block('c-1')] : [],
    signals: {
      mandatoryUnits: 0,
      carriedUnits: 0,
      uncountedUnits: 0,
      commitmentCount: held.includes(quarterId) ? 1 : 0,
      mandatoryShare: 0,
    },
    closed: opts.closed?.includes(quarterId) ?? false,
  })) as unknown as CellModel[];

  return {
    quarters: [...QUARTERS],
    rows: [{ teamId: 't-1', teamName: 'Platform', cells, overflowingCells: 0 }],
    ideas: [],
    totals: { load: 0, capacity: 0, overflowingCells: 0 },
  } as unknown as BoardModel;
}

const drag = (over: Partial<SpanDrag> = {}): SpanDrag => ({
  footprintId: 'fp-c-1',
  commitmentId: 'c-1',
  name: 'Payments hub migration',
  teamId: 't-1',
  quarterId: '2026-Q3',
  units: 30,
  edge: 'END',
  ...over,
});

describe('the quarters a commitment already runs across', () => {
  it('is the unbroken run containing the block you grabbed', () => {
    const model = board(['2026-Q3', '2026-Q4']);
    expect(spanOf(model, 't-1', 'c-1', '2026-Q3')).toEqual(['2026-Q3', '2026-Q4']);
  });

  // A footprint with a gap in between is a separate placement, not the far end
  // of this span, and dragging an edge must not silently adopt it.
  it('stops at a gap rather than reaching across it', () => {
    const model = board(['2026-Q2', '2026-Q4']);
    expect(spanOf(model, 't-1', 'c-1', '2026-Q4')).toEqual(['2026-Q4']);
  });
});

describe('stretching a block into the next quarter', () => {
  it('adds the quarters it reaches, and charges each of them', () => {
    const preview = previewSpan(board(['2026-Q3']), drag(), '2027-Q1');
    expect(preview).toMatchObject({ allowed: true, added: ['2026-Q4', '2027-Q1'], removed: [] });
    // A footprint is what this team spends on this work in THIS quarter, so
    // running for three quarters costs three quarters.
    expect(preview.unitsDelta).toBe(60);
    expect(preview.covered).toEqual(['2026-Q3', '2026-Q4', '2027-Q1']);
  });

  it('retracts when the edge is dragged back', () => {
    const model = board(['2026-Q3', '2026-Q4', '2027-Q1']);
    const preview = previewSpan(model, drag(), '2026-Q4');
    expect(preview).toMatchObject({ allowed: true, added: [], removed: ['2027-Q1'] });
    expect(preview.unitsDelta).toBe(-30);
  });

  it('stretches backwards from the other edge', () => {
    const preview = previewSpan(board(['2026-Q3']), drag({ edge: 'START' }), '2026-Q2');
    expect(preview).toMatchObject({
      allowed: true,
      added: ['2026-Q2'],
      covered: ['2026-Q2', '2026-Q3'],
    });
  });

  /*
   * The end of a run is dragged from the last block in it — that is where the
   * grip is — and dragging it inwards is how a run gets shorter. Anchoring on
   * the block instead of the span made exactly that gesture impossible.
   */
  it('shortens the run when its last block’s end edge is dragged inwards', () => {
    const model = board(['2026-Q2', '2026-Q3', '2026-Q4']);
    const preview = previewSpan(model, drag({ quarterId: '2026-Q4' }), '2026-Q3');
    expect(preview).toMatchObject({ allowed: true, removed: ['2026-Q4'] });
    expect(preview.covered).toEqual(['2026-Q2', '2026-Q3']);
  });

  // Emptying it would be unplacing the work: a different decision, with a
  // different record, made by dragging it to the rail.
  it('never empties the run, however far the edge is dragged back', () => {
    const model = board(['2026-Q3', '2026-Q4']);
    const preview = previewSpan(model, drag({ quarterId: '2026-Q4' }), '2026-Q2');
    expect(preview.covered).toEqual(['2026-Q3']);
    expect(preview.removed).toEqual(['2026-Q4']);
  });

  it('does nothing when the edge has not left its own quarter', () => {
    expect(previewSpan(board(['2026-Q3']), drag(), '2026-Q3')).toMatchObject({
      allowed: false,
      added: [],
      removed: [],
    });
  });

  // A settled quarter is history at either end: it cannot be occupied, and work
  // already recorded in it cannot be taken out.
  it('refuses to reach into a closed quarter', () => {
    const model = board(['2026-Q3'], { closed: ['2026-Q4'] });
    expect(previewSpan(model, drag(), '2026-Q4')).toMatchObject({
      allowed: false,
      refusal: 'CLOSED_QUARTER',
    });
  });

  it('refuses to retract out of a closed quarter', () => {
    const model = board(['2026-Q3', '2026-Q4'], { closed: ['2026-Q4'] });
    expect(previewSpan(model, drag(), '2026-Q3')).toMatchObject({
      allowed: false,
      refusal: 'CLOSED_QUARTER',
    });
  });

  // A stretch that cannot state its consequence is a guess, and the whole
  // argument for dragging is that you see the consequence first.
  it('refuses a container that can say nothing about itself', () => {
    const model = board(['2026-Q3'], { bare: ['2026-Q4'] });
    expect(previewSpan(model, drag(), '2026-Q4')).toMatchObject({
      allowed: false,
      refusal: 'NOT_MATERIALISED',
    });
  });

  it('is nowhere outside the drawn horizon', () => {
    expect(previewSpan(board(['2026-Q3']), drag(), '2030-Q1')).toMatchObject({
      allowed: false,
      refusal: 'OUTSIDE_HORIZON',
    });
  });
});
