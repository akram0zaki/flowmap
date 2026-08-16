/**
 * Dependency rules — docs/spec/04-rules-radar.md §4.2.
 *
 * Direction is invariant everywhere here: `source` waits, `target` unblocks.
 * Getting that backwards would invert every one of these rules, so nothing in
 * this file re-derives it — it reads the field.
 */

import { compareQuarters, type Dependency, type EntityId, type QuarterId } from '@flowmap/domain';

import type { Rule, RuleFinding } from '../types.js';
import {
  commitmentName,
  daysBetween,
  decisions,
  dependencies,
  isUnresolved,
  ref,
  summaryFor,
  targetEntity,
  targetName,
  teamQuarters,
} from '../helpers.js';

const openDependency = (id: EntityId) =>
  ({ kind: 'OPEN', ref: ref('DEPENDENCY', id), labelKey: 'action.openDependency' }) as const;

function dependencyFacts(
  state: Parameters<typeof targetName>[0],
  dependency: Dependency,
): Record<string, string | number | boolean> {
  return {
    dependencyId: dependency.id,
    sourceName: commitmentName(state, dependency.sourceCommitmentId),
    sourceCommitmentId: dependency.sourceCommitmentId,
    targetName: targetName(state, dependency.target),
    targetRef: `${dependency.target.kind}:${dependency.target.id}`,
    type: dependency.type,
    status: dependency.status,
    isHard: dependency.isHard,
  };
}

export const DEP_OVERDUE: Rule = {
  code: 'DEP_OVERDUE',
  category: 'DEPENDENCY',
  severity: 'HIGH',
  surfaces: ['RADAR', 'HEALTH'],
  reads: ['dependencyGraph', 'commitment:*'],
  canDisable: false,
  // `daysOverdue` is a fact but not material: it climbs every midnight, and
  // including it would resurrect every reviewed signal overnight.
  materialFacts: ['dependencyId', 'neededBy', 'status', 'targetRef'],
  evaluate: ({ state, today }) =>
    dependencies(state).flatMap((dependency): RuleFinding[] => {
      if (!isUnresolved(dependency.status) || !dependency.neededBy) return [];
      if (dependency.neededBy >= today) return [];

      return [
        {
          entityRef: ref('DEPENDENCY', dependency.id),
          facts: {
            ...dependencyFacts(state, dependency),
            neededBy: dependency.neededBy,
            daysOverdue: daysBetween(dependency.neededBy, today),
          },
          dueOn: dependency.neededBy,
          actions: [openDependency(dependency.id)],
        },
      ];
    }),
};

export const DEP_DUE_SOON: Rule = {
  code: 'DEP_DUE_SOON',
  category: 'DEPENDENCY',
  severity: 'MEDIUM',
  surfaces: ['RADAR'],
  reads: ['dependencyGraph', 'commitment:*'],
  defaults: { days: 14 },
  ranges: { days: [1, 90] },
  canDisable: true,
  materialFacts: ['dependencyId', 'neededBy', 'status', 'targetRef'],
  evaluate: ({ state, today, threshold }) =>
    dependencies(state).flatMap((dependency): RuleFinding[] => {
      if (!isUnresolved(dependency.status) || !dependency.neededBy) return [];

      const days = daysBetween(today, dependency.neededBy);
      if (days < 0 || days > (threshold['days'] ?? 14)) return [];

      return [
        {
          entityRef: ref('DEPENDENCY', dependency.id),
          facts: {
            ...dependencyFacts(state, dependency),
            neededBy: dependency.neededBy,
            daysUntil: days,
          },
          dueOn: dependency.neededBy,
          actions: [openDependency(dependency.id)],
        },
      ];
    }),
};

export const DEP_AT_RISK: Rule = {
  code: 'DEP_AT_RISK',
  category: 'DEPENDENCY',
  severity: 'MEDIUM',
  surfaces: ['RADAR', 'HEALTH'],
  reads: ['dependencyGraph'],
  canDisable: false,
  materialFacts: ['dependencyId', 'status', 'targetRef'],
  evaluate: ({ state }) =>
    dependencies(state).flatMap((dependency): RuleFinding[] =>
      dependency.status !== 'AT_RISK'
        ? []
        : [
            {
              entityRef: ref('DEPENDENCY', dependency.id),
              facts: dependencyFacts(state, dependency),
              ...(dependency.neededBy ? { dueOn: dependency.neededBy } : {}),
              actions: [openDependency(dependency.id)],
            },
          ],
    ),
};

export const DEP_NO_NEEDED_BY: Rule = {
  code: 'DEP_NO_NEEDED_BY',
  category: 'DEPENDENCY',
  severity: 'LOW',
  surfaces: ['INLINE', 'GATE'],
  reads: ['dependencyGraph', 'commitment:*'],
  canDisable: true,
  materialFacts: ['dependencyId', 'targetRef'],
  evaluate: ({ state }) =>
    dependencies(state).flatMap((dependency): RuleFinding[] => {
      if (!dependency.isHard || dependency.neededBy) return [];
      // Only once the waiting side is a commitment, not an idea: a hard
      // prerequisite with no date is only a problem once someone is counting on it.
      const source = state.commitments.get(dependency.sourceCommitmentId);
      if (!source || source.lifecycle === 'IDEA') return [];

      return [
        {
          entityRef: ref('DEPENDENCY', dependency.id),
          facts: dependencyFacts(state, dependency),
          actions: [
            {
              kind: 'COMMAND',
              command: 'SetDependencyNeededBy',
              payload: { dependencyId: dependency.id },
              labelKey: 'action.setNeededBy',
            },
          ],
        },
      ];
    }),
};

export const DEP_TARGET_MOVED_LATE: Rule = {
  code: 'DEP_TARGET_MOVED_LATE',
  category: 'DEPENDENCY',
  severity: 'HIGH',
  surfaces: ['RADAR', 'HEALTH'],
  reads: ['dependencyGraph', 'commitment:*'],
  canDisable: false,
  materialFacts: ['dependencyId', 'sourceQuarter', 'targetQuarter'],
  evaluate: ({ state }) =>
    dependencies(state).flatMap((dependency): RuleFinding[] => {
      if (!isUnresolved(dependency.status) || dependency.target.kind !== 'COMMITMENT') return [];

      const source = state.commitments.get(dependency.sourceCommitmentId);
      const target = state.commitments.get(dependency.target.id);
      if (!source?.targetQuarterId || !target?.targetQuarterId) return [];

      // The thing being waited on now lands no earlier than the thing waiting.
      if (compareQuarters(target.targetQuarterId, source.targetQuarterId) < 0) return [];

      return [
        {
          entityRef: ref('DEPENDENCY', dependency.id),
          facts: {
            ...dependencyFacts(state, dependency),
            sourceQuarter: source.targetQuarterId,
            targetQuarter: target.targetQuarterId,
          },
          actions: [openDependency(dependency.id)],
        },
      ];
    }),
};

export const DEP_TARGET_AFTER_NEEDED_BY: Rule = {
  code: 'DEP_TARGET_AFTER_NEEDED_BY',
  category: 'DEPENDENCY',
  severity: 'MEDIUM',
  surfaces: ['RADAR'],
  reads: ['dependencyGraph', 'commitment:*'],
  canDisable: true,
  materialFacts: ['dependencyId', 'neededBy', 'targetDate'],
  evaluate: ({ state }) =>
    dependencies(state).flatMap((dependency): RuleFinding[] => {
      if (!isUnresolved(dependency.status) || !dependency.neededBy) return [];
      if (dependency.target.kind !== 'COMMITMENT') return [];

      const target = state.commitments.get(dependency.target.id);
      if (!target?.targetDate || target.targetDate <= dependency.neededBy) return [];

      return [
        {
          entityRef: ref('DEPENDENCY', dependency.id),
          facts: {
            ...dependencyFacts(state, dependency),
            neededBy: dependency.neededBy,
            targetDate: target.targetDate,
            daysLate: daysBetween(dependency.neededBy, target.targetDate),
          },
          dueOn: dependency.neededBy,
          actions: [openDependency(dependency.id)],
        },
      ];
    }),
};

/**
 * Cycles.
 *
 * Cycles are *allowed* in the model — two pieces of work can genuinely each
 * need something from the other — so this reports rather than refuses. Tarjan's
 * algorithm, iterative: at 500 commitments a recursive walk risks the stack,
 * and the budget is 100 ms at 600 dependencies.
 */
export const DEP_CYCLE: Rule = {
  code: 'DEP_CYCLE',
  category: 'DEPENDENCY',
  severity: 'MEDIUM',
  surfaces: ['RADAR', 'INLINE'],
  reads: ['dependencyGraph', 'commitment:*'],
  canDisable: false,
  materialFacts: ['commitmentId', 'cycle'],
  evaluate: ({ state }) => {
    const edges = new Map<EntityId, EntityId[]>();
    for (const dependency of dependencies(state)) {
      if (dependency.target.kind !== 'COMMITMENT') continue;
      const from = dependency.sourceCommitmentId;
      edges.set(from, [...(edges.get(from) ?? []), dependency.target.id]);
    }

    return stronglyConnected(edges).flatMap((component): RuleFinding[] => {
      // A component of one is only a cycle if it points at itself.
      if (component.length < 2) return [];
      const members = [...component].sort();
      const names = members.map((id) => commitmentName(state, id));

      return members.map((id) => ({
        entityRef: ref('COMMITMENT', id),
        // The whole component identifies the cycle, so every member of the same
        // cycle keeps its signal across evaluations even as members are added.
        discriminator: members.join(','),
        facts: {
          commitment: commitmentName(state, id),
          commitmentId: id,
          cycle: names.join(' → '),
          size: members.length,
        },
        actions: [
          {
            kind: 'NAVIGATE',
            lens: 'DEPENDENCIES',
            labelKey: 'action.openCycle',
            focus: ref('COMMITMENT', id),
          },
        ],
      }));
    });
  },
};

/** Tarjan, iterative. Returns every strongly connected component of size ≥ 2. */
function stronglyConnected(edges: ReadonlyMap<EntityId, readonly EntityId[]>): EntityId[][] {
  const index = new Map<EntityId, number>();
  const low = new Map<EntityId, number>();
  const onStack = new Set<EntityId>();
  const stack: EntityId[] = [];
  const components: EntityId[][] = [];
  let counter = 0;

  // Sorted, so the component order is stable run to run.
  const nodes = [...new Set([...edges.keys(), ...[...edges.values()].flat()])].sort();

  for (const root of nodes) {
    if (index.has(root)) continue;

    const work: Array<{ node: EntityId; edge: number }> = [{ node: root, edge: 0 }];
    index.set(root, counter);
    low.set(root, counter);
    counter += 1;
    stack.push(root);
    onStack.add(root);

    while (work.length > 0) {
      const frame = work[work.length - 1]!;
      const neighbours = edges.get(frame.node) ?? [];

      if (frame.edge < neighbours.length) {
        const next = neighbours[frame.edge]!;
        frame.edge += 1;

        if (!index.has(next)) {
          index.set(next, counter);
          low.set(next, counter);
          counter += 1;
          stack.push(next);
          onStack.add(next);
          work.push({ node: next, edge: 0 });
        } else if (onStack.has(next)) {
          low.set(frame.node, Math.min(low.get(frame.node)!, index.get(next)!));
        }
        continue;
      }

      work.pop();
      const parent = work[work.length - 1];
      if (parent) low.set(parent.node, Math.min(low.get(parent.node)!, low.get(frame.node)!));

      if (low.get(frame.node) === index.get(frame.node)) {
        const component: EntityId[] = [];
        for (;;) {
          const popped = stack.pop()!;
          onStack.delete(popped);
          component.push(popped);
          if (popped === frame.node) break;
        }
        components.push(component);
      }
    }
  }

  return components;
}

/** Incoming unresolved dependencies per target, the shared input of both hub rules. */
function incomingByTarget(
  state: Parameters<typeof targetName>[0],
): Map<string, { target: Dependency['target']; sources: Dependency[] }> {
  const byTarget = new Map<string, { target: Dependency['target']; sources: Dependency[] }>();
  for (const dependency of dependencies(state)) {
    if (!isUnresolved(dependency.status)) continue;
    const key = `${dependency.target.kind}:${dependency.target.id}`;
    const entry = byTarget.get(key) ?? { target: dependency.target, sources: [] };
    entry.sources.push(dependency);
    byTarget.set(key, entry);
  }
  return byTarget;
}

export const DEP_HUB: Rule = {
  code: 'DEP_HUB',
  category: 'DEPENDENCY',
  severity: 'MEDIUM',
  surfaces: ['RADAR'],
  reads: ['dependencyGraph'],
  defaults: { incoming: 5 },
  ranges: { incoming: [2, 50] },
  canDisable: true,
  materialFacts: ['targetRef', 'incoming'],
  evaluate: ({ state, threshold }) =>
    [...incomingByTarget(state).entries()].flatMap(([key, entry]): RuleFinding[] => {
      if (entry.sources.length < (threshold['incoming'] ?? 5)) return [];

      return [
        {
          entityRef: ref(entry.target.kind, entry.target.id),
          facts: {
            targetRef: key,
            targetName: targetName(state, entry.target),
            incoming: entry.sources.length,
          },
          actions: [
            {
              kind: 'NAVIGATE',
              lens: 'DEPENDENCIES',
              labelKey: 'action.openNeighbourhood',
              focus: ref(entry.target.kind, entry.target.id),
            },
          ],
        },
      ];
    }),
};

/**
 * A bottleneck that is also out of capacity.
 *
 * The compound is what matters: a team many things wait on, which also has no
 * room to do them, is the single most useful thing a portfolio view can point at.
 */
export const DEP_HUB_CONSTRAINED: Rule = {
  code: 'DEP_HUB_CONSTRAINED',
  category: 'DEPENDENCY',
  severity: 'HIGH',
  surfaces: ['RADAR'],
  reads: ['dependencyGraph', 'capacity:*'],
  defaults: { incoming: 5 },
  ranges: { incoming: [2, 50] },
  canDisable: false,
  materialFacts: ['targetRef', 'incoming', 'quarterId'],
  evaluate: ({ state, threshold }) => {
    const overloaded = new Map<string, QuarterId[]>();
    for (const tq of teamQuarters(state)) {
      if (summaryFor(state, tq).overflow <= 0) continue;
      overloaded.set(tq.teamId, [...(overloaded.get(tq.teamId) ?? []), tq.quarterId]);
    }

    return [...incomingByTarget(state).entries()].flatMap(([key, entry]): RuleFinding[] => {
      if (entry.target.kind !== 'TEAM') return [];
      if (entry.sources.length < (threshold['incoming'] ?? 5)) return [];

      const quarters = overloaded.get(entry.target.id);
      if (!quarters || quarters.length === 0) return [];

      const quarterId = [...quarters].sort(compareQuarters)[0]!;
      return [
        {
          entityRef: ref('TEAM', entry.target.id),
          discriminator: quarterId,
          facts: {
            targetRef: key,
            targetName: targetName(state, entry.target),
            incoming: entry.sources.length,
            quarterId,
            overloadedQuarters: quarters.length,
          },
          actions: [
            {
              kind: 'NAVIGATE',
              lens: 'DEPENDENCIES',
              labelKey: 'action.openNeighbourhood',
              focus: ref('TEAM', entry.target.id),
            },
          ],
        },
      ];
    });
  },
};

export const DEP_DECISION_OVERDUE: Rule = {
  code: 'DEP_DECISION_OVERDUE',
  category: 'DEPENDENCY',
  severity: 'HIGH',
  surfaces: ['RADAR', 'HEALTH'],
  reads: ['dependencyGraph'],
  canDisable: false,
  materialFacts: ['decisionId', 'neededBy', 'status'],
  evaluate: ({ state, today }) =>
    decisions(state).flatMap((decision): RuleFinding[] => {
      if (!isUnresolved(decision.status) || !decision.neededBy) return [];
      if (decision.neededBy >= today) return [];

      return [
        {
          entityRef: ref('DECISION', decision.id),
          facts: {
            decisionId: decision.id,
            decision: decision.name,
            kind: decision.kind,
            neededBy: decision.neededBy,
            status: decision.status,
            daysOverdue: daysBetween(decision.neededBy, today),
          },
          dueOn: decision.neededBy,
          actions: [
            { kind: 'OPEN', ref: ref('DECISION', decision.id), labelKey: 'action.openDecision' },
          ],
        },
      ];
    }),
};

export const DEP_DECISION_UNOWNED: Rule = {
  code: 'DEP_DECISION_UNOWNED',
  category: 'DEPENDENCY',
  severity: 'MEDIUM',
  surfaces: ['RADAR'],
  reads: ['dependencyGraph'],
  canDisable: true,
  materialFacts: ['decisionId', 'neededBy'],
  evaluate: ({ state }) =>
    decisions(state).flatMap((decision): RuleFinding[] => {
      if (!decision.neededBy || decision.ownerRef || !isUnresolved(decision.status)) return [];

      return [
        {
          entityRef: ref('DECISION', decision.id),
          facts: {
            decisionId: decision.id,
            decision: decision.name,
            neededBy: decision.neededBy,
          },
          dueOn: decision.neededBy,
          actions: [
            {
              kind: 'COMMAND',
              command: 'SetDecisionOwner',
              payload: { decisionId: decision.id },
              labelKey: 'action.setDecisionOwner',
            },
          ],
        },
      ];
    }),
};

export const DEP_TARGET_ARCHIVED: Rule = {
  code: 'DEP_TARGET_ARCHIVED',
  category: 'INTEGRITY',
  severity: 'MEDIUM',
  surfaces: ['INTEGRITY', 'INLINE'],
  reads: ['dependencyGraph'],
  canDisable: false,
  materialFacts: ['dependencyId', 'targetRef'],
  evaluate: ({ state }) =>
    dependencies(state).flatMap((dependency): RuleFinding[] => {
      const { exists, archived } = targetEntity(state, dependency.target);
      // A missing target is INT_DANGLING_REF's business, not this rule's.
      if (!exists || !archived) return [];

      return [
        {
          entityRef: ref('DEPENDENCY', dependency.id),
          facts: dependencyFacts(state, dependency),
          actions: [
            {
              kind: 'COMMAND',
              command: 'RemoveDependency',
              payload: { dependencyId: dependency.id },
              labelKey: 'action.removeDependency',
            },
          ],
        },
      ];
    }),
};

export const DEP_BLOCKED_IN_DELIVERY: Rule = {
  code: 'DEP_BLOCKED_IN_DELIVERY',
  category: 'DEPENDENCY',
  severity: 'HIGH',
  surfaces: ['RADAR', 'HEALTH'],
  reads: ['dependencyGraph', 'commitment:*'],
  canDisable: false,
  materialFacts: ['dependencyId', 'sourceCommitmentId', 'neededBy'],
  evaluate: ({ state, today }) =>
    dependencies(state).flatMap((dependency): RuleFinding[] => {
      if (!dependency.isHard || !isUnresolved(dependency.status) || !dependency.neededBy) return [];
      if (dependency.neededBy >= today) return [];

      const source = state.commitments.get(dependency.sourceCommitmentId);
      if (source?.lifecycle !== 'IN_DELIVERY') return [];

      return [
        {
          entityRef: ref('COMMITMENT', source.id),
          discriminator: dependency.id,
          facts: {
            ...dependencyFacts(state, dependency),
            neededBy: dependency.neededBy,
            daysOverdue: daysBetween(dependency.neededBy, today),
          },
          dueOn: dependency.neededBy,
          actions: [openDependency(dependency.id)],
        },
      ];
    }),
};

export const DEPENDENCY_RULES: readonly Rule[] = [
  DEP_OVERDUE,
  DEP_DUE_SOON,
  DEP_AT_RISK,
  DEP_NO_NEEDED_BY,
  DEP_TARGET_MOVED_LATE,
  DEP_TARGET_AFTER_NEEDED_BY,
  DEP_CYCLE,
  DEP_HUB,
  DEP_HUB_CONSTRAINED,
  DEP_DECISION_OVERDUE,
  DEP_DECISION_UNOWNED,
  DEP_TARGET_ARCHIVED,
  DEP_BLOCKED_IN_DELIVERY,
];

/** Re-exported so the commitment-facing rules can reuse the graph walk. */
export { stronglyConnected };
