/**
 * Portfolio Map layout.
 *
 * Pure geometry and grouping — no DOM, no React, no measurement. The canvas
 * renders what this returns, which is what makes the layout testable at 500
 * commitments without a browser.
 *
 * Grammar (docs/spec/06-views-interaction.md §3.1):
 *   · Quarters run left to right as columns.
 *   · Teams are rows.
 *   · Commitment blocks sit inside team-quarter containers.
 *   · The Ideas/Demand lane is pinned left, outside the capacity grid.
 *   · Team order is alphabetical by default and never reshuffled by pressure —
 *     a map that rearranges itself cannot be learned.
 */

import {
  isCounted,
  summariseCapacity,
  type CapacityFootprint,
  type CapacitySummary,
  type CapacityUnits,
  type Commitment,
  type EntityId,
  type QuarterId,
  type Team,
  type TeamQuarter,
  type Workspace,
} from '@flowmap/domain';
import {
  compareQuarters,
  horizonWindow,
  isActive,
  nextQuarter,
  previousQuarter,
  type HorizonPreset,
} from '@flowmap/domain';

export type BlockModel = {
  readonly footprintId: EntityId;
  readonly commitmentId: EntityId;
  readonly name: string;
  readonly units: number;
  readonly lifecycle: Commitment['lifecycle'];
  readonly commitmentClass: Commitment['class'];
  /** Consuming capacity right now. Uncounted blocks are shown, never hidden. */
  readonly counted: boolean;
  readonly carriedFromQuarterId?: QuarterId;
  readonly isPrimary: boolean;
  /** A draft placement for an Idea; rendered as a scenario ghost. */
  readonly scenarioGhost?: boolean;
  /** Stacking position, in units from the top of the reserve plinth. */
  readonly bottomUnits: number;
  readonly topUnits: number;
  /** Sits above the deliverable-capacity rule. */
  readonly overflowing: boolean;
  /**
   * The same work also sits on this team in the quarter before / after.
   *
   * Drawn as a mark on that edge rather than by joining the shapes: a block's
   * height depends on what else is stacked in its own cell, so the same work
   * sits at a different height in each quarter whenever the neighbours differ.
   * A joined bar would be a stepped ribbon far more often than a rectangle.
   */
  readonly continuesBefore: boolean;
  readonly continuesAfter: boolean;
};

/**
 * What a cell concentrates, beyond how full it is.
 *
 * These are the signals level 1 shows instead of individual blocks. They are
 * derived from capacity alone — the rule-based signals (dependency hubs,
 * staleness, attention) arrive with the rules engine in M3.
 */
export type CellSignals = {
  /** Units that cannot move: mandatory work already committed. */
  readonly mandatoryUnits: number;
  readonly carriedUnits: number;
  /** Present but not consuming — held or not yet committed. */
  readonly uncountedUnits: number;
  readonly commitmentCount: number;
  /** Share of the counted load that is mandatory, 0–1. */
  readonly mandatoryShare: number;
};

/**
 * What `EnsureTeamQuarter` would seed this cell with. Present only when no
 * container exists yet. Board totals ignore it — a TeamQuarter is never
 * implicit in calculations (spec 01 §4).
 */
export type CellSeedCapacity = {
  readonly effectiveCapacity: CapacityUnits;
  readonly reservedTotal: CapacityUnits;
  readonly deliverableCapacity: CapacityUnits;
};

export type CellModel = {
  readonly key: string;
  readonly teamId: EntityId;
  readonly teamName: string;
  readonly quarterId: QuarterId;
  readonly teamQuarter: TeamQuarter | null;
  readonly summary: CapacitySummary | null;
  /**
   * Seeded defaults for a cell that has not been materialised. Drop preview
   * uses this; row and board aggregates do not.
   */
  readonly seed?: CellSeedCapacity;
  readonly blocks: readonly BlockModel[];
  readonly signals: CellSignals;
  readonly closed: boolean;
};

export type RowModel = {
  readonly teamId: EntityId;
  readonly teamName: string;
  readonly cells: readonly CellModel[];
  /** Row aggregate, for zoom level 1. */
  readonly load: number;
  readonly capacity: number;
  readonly overflowingCells: number;
  readonly mandatoryUnits: number;
  readonly carriedUnits: number;
};

export type BoardModel = {
  readonly quarters: readonly QuarterId[];
  readonly currentQuarterId: QuarterId;
  /** Index of the current quarter in `quarters`, for centring. */
  readonly currentQuarterIndex: number;
  readonly rows: readonly RowModel[];
  readonly ideas: readonly IdeaModel[];
  readonly totals: { load: number; capacity: number; overflowingCells: number };
};

export type IdeaModel = {
  readonly commitmentId: EntityId;
  readonly name: string;
  readonly commitmentClass: Commitment['class'];
  /** The rail orders by preparation first, then by this. */
  readonly importance: Commitment['importance'];
  readonly targetQuarterId?: QuarterId;
  /** Refinement-reserve links: the only way an Idea touches the grid. */
  readonly refinementLinks: ReadonlyArray<{ teamId: EntityId; quarterId: QuarterId }>;
};

export type BoardInput = {
  readonly workspace: Workspace;
  readonly teams: ReadonlyMap<EntityId, Team>;
  readonly teamQuarters: ReadonlyMap<EntityId, TeamQuarter>;
  readonly commitments: ReadonlyMap<EntityId, Commitment>;
  readonly footprints: ReadonlyMap<EntityId, CapacityFootprint>;
  readonly horizon?: HorizonPreset;
  readonly filter?: BlockFilter;
  /** Scenario projections retain Idea lifecycle while showing ghost footprints. */
  readonly scenario?: boolean;
};

/** Filters fade rather than remove, so the predicate is carried, not applied. */
export type BlockFilter = (
  block: BlockModel,
  cell: { teamId: EntityId; quarterId: QuarterId },
) => boolean;

export function buildBoard(input: BoardInput): BoardModel {
  const { workspace, teams, teamQuarters, commitments, footprints } = input;

  const quarters = horizonWindow(workspace.currentQuarterId, input.horizon ?? 'HORIZON');
  const liveFootprints = [...footprints.values()].filter(isActive);

  const orderedTeams = [...teams.values()]
    .filter((team) => isActive(team) && team.active)
    // Explicit order first; alphabetical is only the seed. Pressure never
    // reorders rows.
    .sort((a, b) =>
      a.displayOrder === b.displayOrder
        ? a.name.localeCompare(b.name)
        : a.displayOrder - b.displayOrder,
    );

  const containerByKey = new Map<string, TeamQuarter>();
  for (const tq of teamQuarters.values()) {
    if (isActive(tq)) containerByKey.set(`${tq.teamId}:${tq.quarterId}`, tq);
  }

  /*
   * Which commitments each team-quarter carries, indexed once.
   *
   * Blocks need to know whether the same work continues either side, and asking
   * that per cell by scanning every footprint is quadratic — at 500
   * commitments it took the board past its own budget, which is what the scale
   * test is for. One pass here, three lookups per cell there.
   */
  const carriedByKey = new Map<string, Set<EntityId>>();
  for (const footprint of liveFootprints) {
    const key = `${footprint.teamId}:${footprint.quarterId}`;
    const carried = carriedByKey.get(key) ?? new Set<EntityId>();
    carried.add(footprint.commitmentId);
    carriedByKey.set(key, carried);
  }

  const rows = orderedTeams.map((team): RowModel => {
    const cells = quarters.map((quarterId): CellModel => {
      const teamQuarter = containerByKey.get(`${team.id}:${quarterId}`) ?? null;

      const summary = teamQuarter
        ? summariseCapacity({
            teamQuarter,
            footprints: liveFootprints,
            commitmentsById: commitments,
            currentQuarterId: workspace.currentQuarterId,
          })
        : null;

      const blocks = teamQuarter
        ? layOutBlocks(
            team.id,
            quarterId,
            liveFootprints,
            commitments,
            workspace,
            summary!,
            input.scenario ?? false,
            carriedByKey,
          )
        : [];

      return {
        key: `${team.id}:${quarterId}`,
        teamId: team.id,
        teamName: team.name,
        quarterId,
        teamQuarter,
        summary,
        ...(teamQuarter ? {} : { seed: seedCapacity(team, workspace) }),
        blocks,
        signals: summariseSignals(blocks, summary),
        closed: teamQuarter?.closedAt !== undefined,
      };
    });

    return {
      teamId: team.id,
      teamName: team.name,
      cells,
      load: cells.reduce((sum, c) => sum + (c.summary?.committedLoad ?? 0), 0),
      capacity: cells.reduce((sum, c) => sum + (c.summary?.deliverableCapacity ?? 0), 0),
      overflowingCells: cells.filter((c) => (c.summary?.overflow ?? 0) > 0).length,
      mandatoryUnits: cells.reduce((sum, c) => sum + c.signals.mandatoryUnits, 0),
      carriedUnits: cells.reduce((sum, c) => sum + c.signals.carriedUnits, 0),
    };
  });

  return {
    quarters,
    currentQuarterId: workspace.currentQuarterId,
    currentQuarterIndex: quarters.indexOf(workspace.currentQuarterId),
    rows,
    ideas: collectIdeas(commitments, teamQuarters),
    totals: {
      load: rows.reduce((sum, r) => sum + r.load, 0),
      capacity: rows.reduce((sum, r) => sum + r.capacity, 0),
      overflowingCells: rows.reduce((sum, r) => sum + r.overflowingCells, 0),
    },
  };
}

/**
 * Stacks blocks from the top of the reserve plinth upward.
 *
 * Order is mandatory-first, then largest — the same order everywhere, so a
 * block does not move when an unrelated one changes.
 */
function layOutBlocks(
  teamId: EntityId,
  quarterId: QuarterId,
  footprints: readonly CapacityFootprint[],
  commitments: ReadonlyMap<EntityId, Commitment>,
  workspace: Workspace,
  summary: CapacitySummary,
  scenario: boolean,
  carriedByKey: ReadonlyMap<string, ReadonlySet<EntityId>>,
): BlockModel[] {
  const own = footprints
    .filter((f) => f.teamId === teamId && f.quarterId === quarterId)
    .map((footprint) => ({ footprint, commitment: commitments.get(footprint.commitmentId) }))
    .filter(
      (entry): entry is { footprint: CapacityFootprint; commitment: Commitment } =>
        entry.commitment !== undefined && isActive(entry.commitment),
    )
    .sort((a, b) => {
      const mandatory =
        Number(b.commitment.class === 'MANDATORY') - Number(a.commitment.class === 'MANDATORY');
      if (mandatory !== 0) return mandatory;
      if (b.footprint.units !== a.footprint.units) return b.footprint.units - a.footprint.units;
      return a.commitment.name.localeCompare(b.commitment.name);
    });

  const ceiling = summary.reservedTotal + summary.deliverableCapacity;
  let cursor = summary.reservedTotal;

  // Which commitments this team also carries either side. A span is nothing
  // more than footprints in consecutive quarters; the model has always allowed
  // it, and this is what lets the board say so.
  const EMPTY: ReadonlySet<EntityId> = new Set();
  const before = carriedByKey.get(`${teamId}:${previousQuarter(quarterId)}`) ?? EMPTY;
  const after = carriedByKey.get(`${teamId}:${nextQuarter(quarterId)}`) ?? EMPTY;

  return own.map(({ footprint, commitment }) => {
    const counted = isCounted(footprint, commitment, workspace.currentQuarterId);
    const bottomUnits = cursor;
    const topUnits = bottomUnits + footprint.units;
    // Only counted work advances the stack; uncounted blocks are drawn where
    // they would sit, without displacing anything.
    if (counted) cursor = topUnits;

    return {
      footprintId: footprint.id,
      commitmentId: commitment.id,
      name: commitment.name,
      units: footprint.units,
      lifecycle: commitment.lifecycle,
      commitmentClass: commitment.class,
      counted,
      isPrimary: footprint.isPrimary,
      ...(scenario && commitment.lifecycle === 'IDEA' ? { scenarioGhost: true } : {}),
      bottomUnits,
      topUnits,
      overflowing: counted && topUnits > ceiling,
      continuesBefore: before.has(commitment.id),
      continuesAfter: after.has(commitment.id),
      ...(footprint.carryOverFromQuarterId !== undefined
        ? { carriedFromQuarterId: footprint.carryOverFromQuarterId }
        : {}),
    };
  });
}

function summariseSignals(
  blocks: readonly BlockModel[],
  summary: CapacitySummary | null,
): CellSignals {
  let mandatoryUnits = 0;
  let carriedUnits = 0;
  let uncountedUnits = 0;

  for (const block of blocks) {
    if (block.counted && block.commitmentClass === 'MANDATORY') mandatoryUnits += block.units;
    if (block.carriedFromQuarterId !== undefined) carriedUnits += block.units;
    if (!block.counted) uncountedUnits += block.units;
  }

  const load = summary?.committedLoad ?? 0;
  return {
    mandatoryUnits,
    carriedUnits,
    uncountedUnits,
    commitmentCount: blocks.length,
    mandatoryShare: load === 0 ? 0 : mandatoryUnits / load,
  };
}

/** Matches `EnsureTeamQuarter`: baseline from the team, reserves from workspace settings. */
function seedCapacity(team: Team, workspace: Workspace): CellSeedCapacity {
  const reservedTotal = workspace.settings.capacity.defaultReserves.reduce(
    (sum, reserve) => sum + reserve.amount,
    0,
  );
  const effectiveCapacity = Math.max(0, team.defaultQuarterCapacity);
  return {
    effectiveCapacity,
    reservedTotal,
    deliverableCapacity: Math.max(0, effectiveCapacity - reservedTotal),
  };
}

/**
 * Ideas live in their own lane and never occupy a team-quarter block. They touch
 * the grid only as connector markers from a refinement reserve.
 */
function collectIdeas(
  commitments: ReadonlyMap<EntityId, Commitment>,
  teamQuarters: ReadonlyMap<EntityId, TeamQuarter>,
): IdeaModel[] {
  const linksByIdea = new Map<EntityId, Array<{ teamId: EntityId; quarterId: QuarterId }>>();

  for (const tq of teamQuarters.values()) {
    if (!isActive(tq)) continue;
    for (const reserve of tq.reserves) {
      if (reserve.type !== 'REFINEMENT') continue;
      for (const ideaId of reserve.linkedIdeaIds ?? []) {
        const list = linksByIdea.get(ideaId) ?? [];
        list.push({ teamId: tq.teamId, quarterId: tq.quarterId });
        linksByIdea.set(ideaId, list);
      }
    }
  }

  return [...commitments.values()]
    .filter((c) => isActive(c) && c.lifecycle === 'IDEA')
    .sort((a, b) => {
      const at = a.targetQuarterId;
      const bt = b.targetQuarterId;
      if (at && bt && at !== bt) return compareQuarters(at, bt);
      if (at && !bt) return -1;
      if (!at && bt) return 1;
      return a.name.localeCompare(b.name);
    })
    .map((commitment) => ({
      commitmentId: commitment.id,
      name: commitment.name,
      commitmentClass: commitment.class,
      importance: commitment.importance,
      refinementLinks: linksByIdea.get(commitment.id) ?? [],
      ...(commitment.targetQuarterId !== undefined
        ? { targetQuarterId: commitment.targetQuarterId }
        : {}),
    }));
}

/** Flat list of every block on the board, for list companions and keyboard order. */
export function allBlocks(board: BoardModel): Array<BlockModel & { cell: CellModel }> {
  return board.rows.flatMap((row) =>
    row.cells.flatMap((cell) => cell.blocks.map((block) => ({ ...block, cell }))),
  );
}

export function findCell(
  board: BoardModel,
  teamId: EntityId,
  quarterId: QuarterId,
): CellModel | undefined {
  return board.rows.find((r) => r.teamId === teamId)?.cells.find((c) => c.quarterId === quarterId);
}
