/**
 * M5 lens projections.
 *
 * These deliberately stop before pixels: the timeline, dependency map,
 * products lens and command palette all read the same deterministic models.
 * React is then free to change presentation without changing what the user is
 * being shown.
 */

import {
  addQuarters,
  aggregateCapacity,
  compareQuarters,
  horizonWindow,
  isActive,
  quarterOfDate,
  utilisationPercent,
  type EntityId,
  type HorizonPreset,
  type QuarterId,
  type WorkspaceState,
} from '@flowmap/domain';

import { buildBoard } from './layout.js';

export type TimelineGroupBy = 'TEAM' | 'PRODUCT' | 'THEME';

export type TimelineFragment = {
  readonly footprintId: EntityId;
  readonly commitmentId: EntityId;
  readonly commitment: string;
  readonly groupId: EntityId | 'UNASSIGNED';
  readonly group: string;
  readonly teamId: EntityId;
  readonly quarterId: QuarterId;
  readonly units: number;
  readonly lifecycle: string;
  readonly carriedFrom?: QuarterId;
};

export type TimelineMilestone = {
  readonly id: EntityId;
  readonly commitmentId: EntityId;
  readonly name: string;
  readonly quarterId: QuarterId;
  readonly status: string;
};

export type TimelineRow = {
  readonly id: EntityId | 'UNASSIGNED';
  readonly label: string;
  readonly fragments: readonly TimelineFragment[];
  readonly milestones: readonly TimelineMilestone[];
};

export type TimelineModel = {
  readonly preset: HorizonPreset;
  readonly quarters: readonly QuarterId[];
  readonly groupBy: TimelineGroupBy;
  readonly rows: readonly TimelineRow[];
};

/** One fragment per footprint; a commitment is never duplicated as a row. */
export function buildTimeline(
  state: WorkspaceState,
  preset: HorizonPreset,
  groupBy: TimelineGroupBy,
): TimelineModel {
  const quarters = horizonWindow(state.workspace.currentQuarterId, preset);
  const visible = new Set(quarters);
  const teams = state.teams;
  const products = state.products ?? new Map();
  const impacts = state.productImpacts ?? new Map();
  const themes = state.themes ?? new Map();
  const joins = state.commitmentThemes ?? new Map();
  const grouped = new Map<
    EntityId | 'UNASSIGNED',
    { label: string; fragments: TimelineFragment[] }
  >();

  const groupFor = (commitmentId: EntityId, teamId: EntityId) => {
    if (groupBy === 'TEAM') {
      const team = teams.get(teamId);
      return { id: teamId, label: team?.name ?? teamId } as const;
    }
    if (groupBy === 'PRODUCT') {
      const impact =
        [...impacts.values()].find(
          (item) => isActive(item) && item.commitmentId === commitmentId && item.type === 'PRIMARY',
        ) ??
        [...impacts.values()].find((item) => isActive(item) && item.commitmentId === commitmentId);
      const product = impact ? products.get(impact.productServiceId) : undefined;
      return product && isActive(product)
        ? ({ id: product.id, label: product.name } as const)
        : ({ id: 'UNASSIGNED', label: 'Unassigned' } as const);
    }
    const join = [...joins.values()].find(
      (item) => isActive(item) && item.commitmentId === commitmentId,
    );
    const theme = join ? themes.get(join.themeId) : undefined;
    return theme && isActive(theme)
      ? ({ id: theme.id, label: theme.name } as const)
      : ({ id: 'UNASSIGNED', label: 'Unassigned' } as const);
  };

  for (const footprint of state.footprints.values()) {
    if (!isActive(footprint) || !visible.has(footprint.quarterId)) continue;
    const commitment = state.commitments.get(footprint.commitmentId);
    if (!commitment || !isActive(commitment)) continue;
    const group = groupFor(commitment.id, footprint.teamId);
    const bucket: { label: string; fragments: TimelineFragment[] } = grouped.get(group.id) ?? {
      label: group.label,
      fragments: [],
    };
    bucket.fragments.push({
      footprintId: footprint.id,
      commitmentId: commitment.id,
      commitment: commitment.name,
      groupId: group.id,
      group: group.label,
      teamId: footprint.teamId,
      quarterId: footprint.quarterId,
      units: footprint.units,
      lifecycle: commitment.lifecycle,
      ...(footprint.carryOverFromQuarterId
        ? { carriedFrom: footprint.carryOverFromQuarterId }
        : {}),
    });
    grouped.set(group.id, bucket);
  }

  const milestones = [...(state.milestones?.values() ?? [])].filter(
    (milestone) => isActive(milestone) && milestone.targetDate !== undefined,
  );
  const rows = [...grouped.entries()]
    .map(([id, bucket]) => ({
      id,
      label: bucket.label,
      fragments: bucket.fragments.sort(
        (a, b) =>
          compareQuarters(a.quarterId, b.quarterId) ||
          a.commitment.localeCompare(b.commitment) ||
          a.footprintId.localeCompare(b.footprintId),
      ),
      milestones: milestones
        .filter((milestone) => {
          const quarterId = quarterOfDate(milestone.targetDate!).id;
          return (
            visible.has(quarterId) &&
            bucket.fragments.some((item) => item.commitmentId === milestone.commitmentId)
          );
        })
        .map((milestone) => ({
          id: milestone.id,
          commitmentId: milestone.commitmentId,
          name: milestone.name,
          quarterId: quarterOfDate(milestone.targetDate!).id,
          status: milestone.status,
        })),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return { preset, quarters, groupBy, rows };
}

export type DependencyNodeKind =
  'COMMITMENT' | 'TEAM' | 'PRODUCT_SERVICE' | 'DECISION' | 'MILESTONE';
export type DependencyNode = {
  readonly id: EntityId;
  readonly kind: DependencyNodeKind;
  readonly label: string;
  readonly unresolvedInDegree: number;
  readonly layer: number;
  readonly isHub: boolean;
  readonly cycleId?: number;
};
export type DependencyEdge = {
  readonly id: EntityId;
  readonly sourceId: EntityId;
  readonly targetId: EntityId;
  readonly type: string;
  readonly status: string;
  readonly isHard: boolean;
};
export type DependencyGraph = {
  readonly nodes: readonly DependencyNode[];
  readonly edges: readonly DependencyEdge[];
  readonly cycles: readonly (readonly EntityId[])[];
};

function targetNode(
  state: WorkspaceState,
  kind: string,
  id: EntityId,
): { kind: DependencyNodeKind; label: string } | null {
  if (kind === 'COMMITMENT') {
    const item = state.commitments.get(id);
    return item && isActive(item) ? { kind, label: item.name } : null;
  }
  if (kind === 'TEAM') {
    const item = state.teams.get(id);
    return item && isActive(item) ? { kind, label: item.name } : null;
  }
  if (kind === 'DECISION') {
    const item = state.decisions?.get(id);
    return item && isActive(item) ? { kind, label: item.name } : null;
  }
  if (kind === 'MILESTONE') {
    const item = state.milestones?.get(id);
    return item && isActive(item) ? { kind, label: item.name } : null;
  }
  return null;
}

/**
 * A deterministic layered layout input. Rendering may happen in a worker, but
 * choosing what is connected and what counts as a hub must stay pure.
 */
export function buildDependencyGraph(state: WorkspaceState): DependencyGraph {
  const rawEdges: DependencyEdge[] = [];
  const labels = new Map<EntityId, { kind: DependencyNodeKind; label: string }>();
  for (const dependency of state.dependencies?.values() ?? []) {
    if (!isActive(dependency)) continue;
    const source = state.commitments.get(dependency.sourceCommitmentId);
    const target = targetNode(state, dependency.target.kind, dependency.target.id);
    if (!source || !isActive(source) || !target) continue;
    labels.set(source.id, { kind: 'COMMITMENT', label: source.name });
    labels.set(dependency.target.id, target);
    rawEdges.push({
      id: dependency.id,
      sourceId: source.id,
      targetId: dependency.target.id,
      type: dependency.type,
      status: dependency.status,
      isHard: dependency.isHard,
    });
  }
  const inbound = new Map<EntityId, number>();
  const outbound = new Map<EntityId, EntityId[]>();
  for (const edge of rawEdges) {
    if (edge.status !== 'RESOLVED')
      inbound.set(edge.targetId, (inbound.get(edge.targetId) ?? 0) + 1);
    outbound.set(edge.sourceId, [...(outbound.get(edge.sourceId) ?? []), edge.targetId]);
  }
  const cycles = findCycles([...labels.keys()], outbound);
  const cycleByNode = new Map<EntityId, number>();
  cycles.forEach((cycle, index) => cycle.forEach((id) => cycleByNode.set(id, index)));
  const layers = layersFor([...labels.keys()], rawEdges, cycleByNode);
  const nodes = [...labels.entries()]
    .map(([id, node]) => ({
      id,
      ...node,
      unresolvedInDegree: inbound.get(id) ?? 0,
      layer: layers.get(id) ?? 0,
      isHub: (inbound.get(id) ?? 0) >= 3,
      ...(cycleByNode.has(id) ? { cycleId: cycleByNode.get(id)! } : {}),
    }))
    .sort((a, b) => a.layer - b.layer || a.label.localeCompare(b.label));
  return { nodes, edges: rawEdges.sort((a, b) => a.id.localeCompare(b.id)), cycles };
}

function findCycles(
  nodes: readonly EntityId[],
  outbound: ReadonlyMap<EntityId, readonly EntityId[]>,
): EntityId[][] {
  const seen = new Set<EntityId>();
  const stack = new Set<EntityId>();
  const path: EntityId[] = [];
  const cycles: EntityId[][] = [];
  const visit = (id: EntityId) => {
    if (stack.has(id)) {
      const start = path.indexOf(id);
      if (start >= 0) cycles.push(path.slice(start));
      return;
    }
    if (seen.has(id)) return;
    seen.add(id);
    stack.add(id);
    path.push(id);
    for (const next of outbound.get(id) ?? []) visit(next);
    path.pop();
    stack.delete(id);
  };
  [...nodes].sort().forEach(visit);
  return cycles;
}

function layersFor(
  nodes: readonly EntityId[],
  edges: readonly DependencyEdge[],
  cycles: ReadonlyMap<EntityId, number>,
): Map<EntityId, number> {
  const layer = new Map<EntityId, number>(nodes.map((id) => [id, 0]));
  // A bounded relaxation remains deterministic even in cycles. Direction is
  // source (waiting work) left → target (prerequisite) right.
  for (let pass = 0; pass < nodes.length; pass += 1) {
    let changed = false;
    for (const edge of edges) {
      if (
        cycles.has(edge.sourceId) &&
        cycles.has(edge.targetId) &&
        cycles.get(edge.sourceId) === cycles.get(edge.targetId)
      )
        continue;
      const next = Math.max(layer.get(edge.sourceId) ?? 0, (layer.get(edge.targetId) ?? 0) - 1);
      if (next !== layer.get(edge.sourceId)) {
        layer.set(edge.sourceId, next);
        changed = true;
      }
      const target = Math.max(layer.get(edge.targetId) ?? 0, next + 1);
      if (target !== layer.get(edge.targetId)) {
        layer.set(edge.targetId, target);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return layer;
}

export type DependencyPlacement = {
  readonly columns: number;
  readonly positions: ReadonlyMap<EntityId, { readonly column: number; readonly row: number }>;
};

/**
 * Spec 06 §6: default is hubs (and cycles), plus an N-hop neighbourhood so a
 * card that says it has unresolved dependencies still has a line to them.
 */
export function expandDependencyNeighbourhood(
  graph: DependencyGraph,
  seeds: ReadonlySet<EntityId>,
  hops: number,
): ReadonlySet<EntityId> {
  const include = new Set(seeds);
  let frontier = [...seeds];
  for (let hop = 0; hop < hops; hop += 1) {
    const next: EntityId[] = [];
    for (const id of frontier) {
      for (const edge of graph.edges) {
        const other =
          edge.sourceId === id ? edge.targetId : edge.targetId === id ? edge.sourceId : null;
        if (other === null || include.has(other)) continue;
        include.add(other);
        next.push(other);
      }
    }
    frontier = next;
  }
  return include;
}

export function dependencyHubSeeds(graph: DependencyGraph): ReadonlySet<EntityId> {
  const seeds = new Set(
    graph.nodes.filter((node) => node.isHub || node.cycleId !== undefined).map((node) => node.id),
  );
  if (seeds.size > 0) return seeds;
  return new Set(graph.nodes.filter((node) => node.unresolvedInDegree > 0).map((node) => node.id));
}

/**
 * Pack visible nodes into consecutive columns. Hidden hops collapse so the
 * default hub view is a chain, not a six-column wrapping gallery.
 */
export function placeDependencyNodes(nodes: readonly DependencyNode[]): DependencyPlacement {
  const layers = [...new Set(nodes.map((node) => node.layer))].sort((a, b) => a - b);
  const columnOf = new Map(layers.map((layer, index) => [layer, index + 1]));
  const rowInColumn = new Map<number, number>();
  const positions = new Map<EntityId, { column: number; row: number }>();
  const sorted = [...nodes].sort(
    (a, b) => a.layer - b.layer || a.label.localeCompare(b.label) || a.id.localeCompare(b.id),
  );
  for (const node of sorted) {
    const column = columnOf.get(node.layer) ?? 1;
    const row = (rowInColumn.get(column) ?? 0) + 1;
    rowInColumn.set(column, row);
    positions.set(node.id, { column, row });
  }
  return { columns: Math.max(1, layers.length), positions };
}

export type SearchResult = {
  readonly kind: string;
  readonly id: EntityId;
  readonly label: string;
  readonly detail?: string;
};

/** Explicit, local, deterministic palette search — never natural language. */
export function searchWorkspace(state: WorkspaceState, query: string): SearchResult[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  const result: SearchResult[] = [];
  const include = (kind: string, id: EntityId, label: string, detail?: string) => {
    if (`${label} ${detail ?? ''}`.toLocaleLowerCase().includes(needle))
      result.push({ kind, id, label, ...(detail ? { detail } : {}) });
  };
  for (const item of state.commitments.values())
    if (isActive(item)) include('COMMITMENT', item.id, item.name, item.lifecycle);
  for (const item of state.teams.values()) if (isActive(item)) include('TEAM', item.id, item.name);
  for (const item of state.products?.values() ?? [])
    if (isActive(item)) include('PRODUCT_SERVICE', item.id, item.name);
  for (const item of state.people?.values() ?? [])
    if (isActive(item)) include('PERSON', item.id, item.displayName);
  for (const item of state.themes?.values() ?? [])
    if (isActive(item)) include('THEME', item.id, item.name);
  for (const item of state.milestones?.values() ?? [])
    if (isActive(item)) include('MILESTONE', item.id, item.name);
  for (const item of state.externalLinks?.values() ?? [])
    if (isActive(item) && item.label) include('EXTERNAL_LINK', item.id, item.label);
  return result.sort((a, b) => a.label.localeCompare(b.label) || a.kind.localeCompare(b.kind));
}

export function timelineHorizonEnd(current: QuarterId, preset: HorizonPreset): QuarterId {
  return horizonWindow(current, preset).at(-1) ?? addQuarters(current, 0);
}

// ── Teams lens ─────────────────────────────────────────────────────────────
//
// Spec 02 §3: the Teams lens uses the same aggregates as Portfolio Map L1 —
// teamLoad, teamCapacity, quarterOverflowCount, portfolioPressure — computed
// from the same counted predicate. buildBoard already owns that arithmetic;
// this projection only rearranges it so the canvas can drop commitment blocks
// without inventing a second source of capacity truth.

export type TeamsCell = {
  readonly teamId: EntityId;
  readonly teamName: string;
  readonly quarterId: QuarterId;
  /** False when the team has no TeamQuarter in this column. */
  readonly planned: boolean;
  readonly load: number;
  readonly capacity: number;
  readonly headroom: number | null;
  readonly overflow: number;
  readonly utilisation: number | null;
  readonly utilisationPercent: number | null;
};

export type TeamsRow = {
  readonly teamId: EntityId;
  readonly teamName: string;
  readonly cells: readonly TeamsCell[];
  /** teamLoad(team, horizon) */
  readonly load: number;
  /** teamCapacity(team, horizon) */
  readonly capacity: number;
  readonly overflowingCells: number;
  readonly utilisation: number | null;
  readonly utilisationPercent: number | null;
};

export type TeamsQuarter = {
  readonly quarterId: QuarterId;
  readonly isCurrent: boolean;
  readonly load: number;
  readonly capacity: number;
  /** quarterOverflowCount(q) */
  readonly overflowCount: number;
  /** portfolioPressure(q) */
  readonly pressure: number | null;
  readonly pressurePercent: number | null;
};

export type TeamsModel = {
  readonly preset: HorizonPreset;
  readonly currentQuarterId: QuarterId;
  readonly quarters: readonly QuarterId[];
  readonly rows: readonly TeamsRow[];
  readonly quartersSummary: readonly TeamsQuarter[];
  readonly totals: {
    readonly load: number;
    readonly capacity: number;
    readonly overflowingCells: number;
    readonly pressure: number | null;
    readonly pressurePercent: number | null;
  };
};

function ratioPercent(load: number, capacity: number): number | null {
  return capacity === 0 ? null : Math.round((load / capacity) * 100);
}

/**
 * Team × horizon capacity pressure. Same numbers as L1; different emphasis.
 *
 * Lenses change emphasis, never data (spec 06 §3.5).
 */
export function buildTeamsLens(state: WorkspaceState, preset: HorizonPreset): TeamsModel {
  const board = buildBoard({
    workspace: state.workspace,
    teams: state.teams,
    teamQuarters: state.teamQuarters,
    commitments: state.commitments,
    footprints: state.footprints,
    horizon: preset,
  });

  const rows = board.rows.map((row): TeamsRow => {
    const cells = row.cells.map((cell): TeamsCell => {
      const summary = cell.summary;
      return {
        teamId: cell.teamId,
        teamName: cell.teamName,
        quarterId: cell.quarterId,
        planned: summary !== null,
        load: summary?.committedLoad ?? 0,
        capacity: summary?.deliverableCapacity ?? 0,
        headroom: summary?.headroom ?? null,
        overflow: summary?.overflow ?? 0,
        utilisation: summary?.utilisation ?? null,
        utilisationPercent: summary === null ? null : utilisationPercent(summary),
      };
    });

    return {
      teamId: row.teamId,
      teamName: row.teamName,
      cells,
      load: row.load,
      capacity: row.capacity,
      overflowingCells: row.overflowingCells,
      utilisation: row.capacity === 0 ? null : row.load / row.capacity,
      utilisationPercent: ratioPercent(row.load, row.capacity),
    };
  });

  const quartersSummary = board.quarters.map((quarterId): TeamsQuarter => {
    const summaries = board.rows
      .flatMap((row) => row.cells)
      .filter((cell) => cell.quarterId === quarterId && cell.summary !== null)
      .map((cell) => cell.summary!);
    const aggregate = aggregateCapacity(summaries);
    return {
      quarterId,
      isCurrent: quarterId === board.currentQuarterId,
      load: aggregate.load,
      capacity: aggregate.capacity,
      overflowCount: aggregate.overflowingCells,
      pressure: aggregate.pressure,
      pressurePercent: ratioPercent(aggregate.load, aggregate.capacity),
    };
  });

  return {
    preset,
    currentQuarterId: board.currentQuarterId,
    quarters: board.quarters,
    rows,
    quartersSummary,
    totals: {
      load: board.totals.load,
      capacity: board.totals.capacity,
      overflowingCells: board.totals.overflowingCells,
      pressure: board.totals.capacity === 0 ? null : board.totals.load / board.totals.capacity,
      pressurePercent: ratioPercent(board.totals.load, board.totals.capacity),
    },
  };
}

// ── QBR / Demand Flow ──────────────────────────────────────────────────────
//
// Spec 05 §6: Ideas → pipe → Commit Gate → team-quarter containers.
// Carry-over and new demand (scenario ghosts) stay separate groups.

export type QbrCell = {
  readonly teamId: EntityId;
  readonly teamName: string;
  readonly quarterId: QuarterId;
  readonly planned: boolean;
  readonly capacity: number;
  readonly committed: number;
  readonly carryOver: number;
  readonly ghost: number;
  readonly overflow: number;
};

export type QbrRow = {
  readonly teamId: EntityId;
  readonly teamName: string;
  readonly cells: readonly QbrCell[];
};

export type QbrModel = {
  readonly quarters: readonly QuarterId[];
  readonly currentQuarterId: QuarterId;
  readonly rows: readonly QbrRow[];
  readonly summary: {
    readonly committed: number;
    readonly carryOver: number;
    readonly ghost: number;
    readonly overflowingCells: number;
  };
};

/**
 * QBR window only. Ghosts are Idea footprints on a scenario projection.
 */
export function buildQbrLens(state: WorkspaceState, scenario = false): QbrModel {
  const board = buildBoard({
    workspace: state.workspace,
    teams: state.teams,
    teamQuarters: state.teamQuarters,
    commitments: state.commitments,
    footprints: state.footprints,
    horizon: 'QBR',
    scenario,
  });

  const rows = board.rows.map((row): QbrRow => ({
    teamId: row.teamId,
    teamName: row.teamName,
    cells: row.cells.map((cell): QbrCell => {
      let committed = 0;
      let carryOver = 0;
      let ghost = 0;
      for (const block of cell.blocks) {
        if (block.scenarioGhost) ghost += block.units;
        else if (block.carriedFromQuarterId !== undefined) carryOver += block.units;
        else if (block.counted) committed += block.units;
      }
      return {
        teamId: cell.teamId,
        teamName: cell.teamName,
        quarterId: cell.quarterId,
        planned: cell.summary !== null,
        capacity: cell.summary?.deliverableCapacity ?? 0,
        committed,
        carryOver,
        ghost,
        overflow: cell.summary?.overflow ?? 0,
      };
    }),
  }));

  const cells = rows.flatMap((row) => row.cells);
  return {
    quarters: board.quarters,
    currentQuarterId: board.currentQuarterId,
    rows,
    summary: {
      committed: cells.reduce((sum, cell) => sum + cell.committed, 0),
      carryOver: cells.reduce((sum, cell) => sum + cell.carryOver, 0),
      ghost: cells.reduce((sum, cell) => sum + cell.ghost, 0),
      overflowingCells: cells.filter((cell) => cell.overflow > 0).length,
    },
  };
}
