import { describe, expect, it } from 'vitest';
import type { CapacitySummary, TeamQuarter } from '@flowmap/domain';

import {
  arrivingUnits,
  clampUnits,
  defaultDropUnits,
  previewDrop,
  previewRemoval,
  previewResize,
  type DragPayload,
} from './placement.js';
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
  lifecycle: 'COMMITTED',
  footprintCount: 1,
  fromClosed: false,
  intent: 'MOVE',
  addUnits: 10,
};

/** The same placement held for a second team to pick up, rather than moved. */
const alsoTaken: DragPayload = { ...carried, intent: 'ADD' };

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

  it('previews a not-yet-created container at the seeded default, and allows the drop', () => {
    const preview = previewDrop(
      cell({
        teamQuarter: null,
        summary: null,
        blocks: [],
        seed: { effectiveCapacity: 100, reservedTotal: 20, deliverableCapacity: 80 },
      }),
      idea,
    );

    expect(preview.allowed).toBe(true);
    expect(preview.committedLoad).toBe(20);
    expect(preview.percent).toBe(25);
    expect(preview.percentDelta).toBe(25);
    expect(preview.overflow).toBe(0);
  });

  it('still refuses a dependency drawn onto a container with no work', () => {
    const preview = previewDrop(
      cell({
        teamQuarter: null,
        summary: null,
        blocks: [],
        seed: { effectiveCapacity: 100, reservedTotal: 20, deliverableCapacity: 80 },
      }),
      { kind: 'LINK', commitmentId: 'c-1', name: 'SEPA instant payments', units: 0 },
    );
    expect(preview).toMatchObject({ allowed: false, refusal: 'LINK_NEEDS_WORK' });
  });

  it('cannot preview a container that has neither a summary nor a seed', () => {
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

  /**
   * A second team picking the work up is the ordinary case, so it is the plain
   * drag. What arrives is the addition's own size, not the size the team it was
   * dragged from happens to carry — how much of the work this team takes is a
   * new question.
   */
  describe('a second team taking the work as well', () => {
    it('brings its own units, not the ones the first team carries', () => {
      const preview = previewDrop(cell(), alsoTaken);
      expect(preview.committedLoad).toBe(70);
      expect(preview.percent).toBe(70);
      expect(preview.allowed).toBe(true);
    });

    // The lead team is an ownership decision, made by dropping an Idea on a
    // row. A second team helping out is not that decision.
    it('leaves the lead team where it is', () => {
      expect(previewDrop(cell(), alsoTaken).reassignsOwner).toBe(false);
    });

    it('still refuses a container this work already occupies', () => {
      const occupied = previewDrop(cell({ blocks: [block({ commitmentId: 'c-9' })] }), alsoTaken);
      expect(occupied).toMatchObject({ allowed: false, refusal: 'DUPLICATE_FOOTPRINT' });
    });

    it('is refused on the container it was picked up from', () => {
      const home = previewDrop(cell(), {
        ...alsoTaken,
        fromTeamId: 't-1',
        fromQuarterId: '2026-Q3',
      });
      expect(home).toMatchObject({ allowed: false, refusal: 'ALREADY_HERE' });
    });
  });

  /**
   * The gate insists the primary footprint sits on the primary team, so a drop
   * onto any other row has to reassign — and used to fail in silence instead.
   */
  describe('ownership', () => {
    it('says when the drop would move ownership to this team', () => {
      const preview = previewDrop(cell(), { ...idea, primaryTeamId: 't-9' });
      expect(preview.reassignsOwner).toBe(true);
      expect(preview.allowed).toBe(true);
    });

    it('says nothing when the team already owns it', () => {
      expect(previewDrop(cell(), { ...idea, primaryTeamId: 't-1' }).reassignsOwner).toBe(false);
    });

    it('never claims a moved block reassigns anything', () => {
      expect(previewDrop(cell(), carried).reassignsOwner).toBe(false);
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

describe('previewResize', () => {
  it('states the figure the container would show at the new size', () => {
    // 60 committed of 100 deliverable; the block is all 60 of it.
    const preview = previewResize(cell(), 'f-1', 80);
    expect(preview).toMatchObject({ allowed: true, units: 80, percent: 80, overflow: 0 });
  });

  it('allows a resize past the rule, and measures the excess', () => {
    const preview = previewResize(cell(), 'f-1', 130);
    expect(preview).toMatchObject({ allowed: true, percent: 130, overflow: 30 });
  });

  // A footprint of nothing is a removal, which is a different decision.
  it('never goes below one unit, and never takes a fraction', () => {
    expect(previewResize(cell(), 'f-1', 0).units).toBe(1);
    expect(previewResize(cell(), 'f-1', -4).units).toBe(1);
    expect(previewResize(cell(), 'f-1', 12.6).units).toBe(13);
    expect(clampUnits(0.2)).toBe(1);
  });

  it('refuses a closed quarter', () => {
    expect(previewResize(cell({ closed: true }), 'f-1', 80)).toMatchObject({
      allowed: false,
      refusal: 'CLOSED_QUARTER',
    });
  });

  // Work on hold occupies no capacity, so its size changes what it will cost
  // when it resumes, not what the quarter carries today.
  it('does not move the figure for a block that is not counted', () => {
    const held = cell({ blocks: [block({ counted: false, units: 60 })] });
    expect(previewResize(held, 'f-1', 90).percent).toBe(60);
  });

  it('cannot preview a block that is not there', () => {
    expect(previewResize(cell(), 'nope', 10).allowed).toBe(false);
  });
});

describe('previewRemoval', () => {
  it('returns work to the lane when this was its only placement', () => {
    const preview = previewRemoval(carried);
    expect(preview).toMatchObject({ allowed: true, returnsToRail: true, units: 20 });
  });

  // Work placed on several teams is only unplaced from one of them; the
  // commitment is still committed elsewhere and must not reappear as demand.
  it('only unplaces when the commitment has other placements', () => {
    const preview = previewRemoval({ ...carried, footprintCount: 3 });
    expect(preview).toMatchObject({ allowed: true, returnsToRail: false });
  });

  it('refuses to send work in delivery back to the lane', () => {
    const preview = previewRemoval({ ...carried, lifecycle: 'IN_DELIVERY' });
    expect(preview).toMatchObject({ allowed: false, refusal: 'NOT_REVERTIBLE' });
  });

  // Only the last placement is a lifecycle question. Unplacing one of several
  // is just capacity, whatever state the work is in.
  it('still unplaces one of several placements of work in delivery', () => {
    const preview = previewRemoval({ ...carried, lifecycle: 'IN_DELIVERY', footprintCount: 2 });
    expect(preview).toMatchObject({ allowed: true, returnsToRail: false });
  });

  it('has nothing to remove for an Idea, which is already in the lane', () => {
    expect(previewRemoval(idea)).toMatchObject({ allowed: false, refusal: 'IDEA_NOT_PLACED' });
  });

  // A settled quarter is history. The domain refuses to edit it, so the drag
  // must refuse too rather than promising something the command will decline.
  it('refuses to take work out of a closed quarter', () => {
    expect(previewRemoval({ ...carried, fromClosed: true })).toMatchObject({
      allowed: false,
      refusal: 'FROM_CLOSED_QUARTER',
    });
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

describe('arrivingUnits', () => {
  it('is the block itself when the placement moves', () => {
    expect(arrivingUnits(carried)).toBe(20);
  });

  // The ghost the board draws and the figure under it read this same function,
  // so an addition cannot draw one size while the percentage counts another.
  it('is the addition’s own size when a second team takes the work on', () => {
    expect(arrivingUnits(alsoTaken)).toBe(10);
  });

  it('is nothing at all for a dependency', () => {
    expect(arrivingUnits({ kind: 'LINK', commitmentId: 'c-1', name: 'x', units: 20 })).toBe(0);
  });
});
