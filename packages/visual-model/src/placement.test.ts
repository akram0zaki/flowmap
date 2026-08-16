import { describe, expect, it } from 'vitest';
import type { CapacitySummary, TeamQuarter } from '@flowmap/domain';

import { defaultDropUnits, previewDrop, type DragPayload } from './placement.js';
import type { BlockModel, CellModel } from './layout.js';

const NOW = '2026-08-15T09:00:00Z';

function teamQuarter(over: Partial<TeamQuarter> = {}): TeamQuarter {
  return {
    id: 'tq-1',
    workspaceId: 'ws',
    schemaVersion: 1,
    entityVersion: 1,
    createdAt: NOW,
    createdBy: 'a',
    updatedAt: NOW,
    updatedBy: 'a',
    teamId: 't-1',
    quarterId: '2026-Q3',
    capacityBaseline: 100,
    capacityAdjustment: 0,
    reserves: [],
    ...over,
  };
}

/** deliverable 100, committed 60 — 40 of headroom to play with. */
function summary(over: Partial<CapacitySummary> = {}): CapacitySummary {
  const committedLoad = over.committedLoad ?? 60;
  const deliverable = over.deliverableCapacity ?? 100;
  return {
    teamId: 't-1',
    quarterId: '2026-Q3',
    effectiveCapacity: 100,
    reservedTotal: 0,
    deliverableCapacity: deliverable,
    committedLoad,
    headroom: deliverable - committedLoad,
    overflow: Math.max(0, committedLoad - deliverable),
    utilisation: deliverable === 0 ? null : committedLoad / deliverable,
    ...over,
  };
}

function block(over: Partial<BlockModel> = {}): BlockModel {
  return {
    footprintId: 'f-1',
    commitmentId: 'c-1',
    name: 'SEPA instant payments',
    units: 60,
    lifecycle: 'COMMITTED',
    commitmentClass: 'STRATEGIC',
    counted: true,
    isPrimary: true,
    bottomUnits: 0,
    topUnits: 60,
    overflowing: false,
    ...over,
  };
}

function cell(over: Partial<CellModel> = {}): CellModel {
  return {
    key: 't-1:2026-Q3',
    teamId: 't-1',
    teamName: 'Payments',
    quarterId: '2026-Q3',
    teamQuarter: teamQuarter(),
    summary: summary(),
    blocks: [block()],
    signals: {
      mandatoryUnits: 0,
      carriedUnits: 0,
      uncountedUnits: 0,
      commitmentCount: 1,
      mandatoryShare: 0,
    },
    closed: false,
    ...over,
  };
}

const idea: DragPayload = {
  kind: 'IDEA',
  commitmentId: 'i-1',
  name: 'Request to pay',
  units: 20,
  commitmentClass: 'STRATEGIC',
  hasTargetDate: true,
};

const carried: DragPayload = {
  kind: 'BLOCK',
  footprintId: 'f-9',
  commitmentId: 'c-9',
  name: 'Legacy gateway decommission',
  units: 20,
  fromTeamId: 't-2',
  fromQuarterId: '2026-Q4',
};

describe('previewDrop', () => {
  it('states what the container would become', () => {
    const preview = previewDrop(cell(), idea);

    expect(preview.allowed).toBe(true);
    expect(preview.committedLoad).toBe(80);
    expect(preview.percent).toBe(80);
    expect(preview.percentDelta).toBe(20);
    expect(preview.overflow).toBe(0);
    expect(preview.tipsOver).toBe(false);
  });

  // Overflow never blocks. The whole argument is that you may overload a team
  // as long as you can see that you did.
  it('allows a drop that goes over capacity, and says by how much', () => {
    const preview = previewDrop(cell({ summary: summary({ committedLoad: 95 }) }), idea);

    expect(preview.allowed).toBe(true);
    expect(preview.overflow).toBe(15);
    expect(preview.percent).toBe(115);
    expect(preview.tipsOver).toBe(true);
  });

  it('does not claim to tip over a container that was already over', () => {
    const preview = previewDrop(cell({ summary: summary({ committedLoad: 120 }) }), idea);
    expect(preview.overflow).toBe(40);
    expect(preview.tipsOver).toBe(false);
  });

  it('refuses a closed quarter', () => {
    const preview = previewDrop(cell({ closed: true }), idea);
    expect(preview).toMatchObject({ allowed: false, refusal: 'CLOSED_QUARTER' });
  });

  it('refuses a second footprint for the same commitment in one container', () => {
    const preview = previewDrop(cell({ blocks: [block({ commitmentId: 'i-1' })] }), idea);
    expect(preview).toMatchObject({ allowed: false, refusal: 'DUPLICATE_FOOTPRINT' });
  });

  it('refuses mandatory work that has no target date, as the gate would', () => {
    const preview = previewDrop(cell(), {
      ...idea,
      commitmentClass: 'MANDATORY',
      hasTargetDate: false,
    });
    expect(preview).toMatchObject({ allowed: false, refusal: 'MANDATORY_NEEDS_TARGET_DATE' });
  });

  it('allows mandatory work that has one', () => {
    const preview = previewDrop(cell(), { ...idea, commitmentClass: 'MANDATORY' });
    expect(preview.allowed).toBe(true);
  });

  it('cannot preview a container that does not exist yet', () => {
    const preview = previewDrop(cell({ teamQuarter: null, summary: null }), idea);
    expect(preview).toMatchObject({ allowed: false, refusal: 'NOT_MATERIALISED', percent: null });
  });

  describe('moving an existing block', () => {
    it('adds the load to the container it would arrive in', () => {
      const preview = previewDrop(cell(), carried);
      expect(preview.committedLoad).toBe(80);
      expect(preview.allowed).toBe(true);
    });

    // Dropping a block back where it came from is not a move, and must not
    // read as one — otherwise the preview shows the block's load twice.
    it('does not double-count a block dropped on its own container', () => {
      const home = previewDrop(cell(), {
        ...carried,
        fromTeamId: 't-1',
        fromQuarterId: '2026-Q3',
      });

      expect(home.committedLoad).toBe(60);
      expect(home.percentDelta).toBe(0);
      expect(home).toMatchObject({ allowed: false, refusal: 'ALREADY_HERE' });
    });
  });

  it('reports no percentage when there is no deliverable capacity', () => {
    const preview = previewDrop(
      cell({ summary: summary({ deliverableCapacity: 0, committedLoad: 0 }) }),
      idea,
    );
    expect(preview.percent).toBeNull();
    expect(preview.percentDelta).toBeNull();
    expect(preview.allowed).toBe(true);
  });
});

describe('defaultDropUnits', () => {
  it('uses S, so a dropped Idea lands small enough to resize', () => {
    expect(defaultDropUnits({ XS: 5, S: 10, M: 20, L: 40, XL: 80 })).toBe(10);
  });

  it('falls back rather than dropping a zero-unit block', () => {
    expect(defaultDropUnits({ M: 20 })).toBe(20);
    expect(defaultDropUnits({})).toBe(10);
  });
});
