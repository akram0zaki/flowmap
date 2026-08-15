/**
 * The fixture contract.
 *
 * These assertions are the executable form of docs/spec/11-quality-performance.md §5.1.
 * If one fails, either the fixture drifted or the spec changed — and the spec is
 * the one that has to change first.
 */

import { describe, expect, it } from 'vitest';
import {
  aggregateCapacity,
  isActive,
  ordinalOf,
  summariseCapacity,
  utilisationPercent,
  type CapacitySummary,
  type Commitment,
  type EntityId,
  type Lifecycle,
} from '@flowmap/domain';

import { validationFixture } from './validation.js';

const fx = validationFixture();
const commitmentsById = new Map<EntityId, Commitment>(fx.commitments.map((c) => [c.id, c]));

function summarise(teamName: string, quarterId: string): CapacitySummary {
  const team = fx.teams.find((t) => t.name === teamName);
  expect(team, `team ${teamName} exists`).toBeDefined();
  const tq = fx.teamQuarters.find((q) => q.teamId === team!.id && q.quarterId === quarterId);
  expect(tq, `${teamName} ${quarterId} container exists`).toBeDefined();

  return summariseCapacity({
    teamQuarter: tq!,
    footprints: fx.footprints,
    commitmentsById,
    currentQuarterId: fx.currentQuarterId,
  });
}

describe('required counts', () => {
  it('has 5 teams and 5 products/services', () => {
    expect(fx.teams).toHaveLength(5);
    expect(fx.products).toHaveLength(5);
  });

  it('has 25 gated commitments and 10 ideas', () => {
    const ideas = fx.commitments.filter((c) => c.lifecycle === 'IDEA');
    const gated = fx.commitments.filter((c) => c.lifecycle !== 'IDEA');
    expect(gated).toHaveLength(25);
    expect(ideas).toHaveLength(10);
    expect(fx.commitments).toHaveLength(35);
  });

  it('covers every lifecycle state', () => {
    const present = new Set(fx.commitments.map((c) => c.lifecycle));
    const all: Lifecycle[] = ['IDEA', 'COMMITTED', 'IN_DELIVERY', 'ON_HOLD', 'DONE', 'DROPPED'];
    for (const lifecycle of all)
      expect(present, `${lifecycle} is represented`).toContain(lifecycle);
  });

  it('has 30 dependencies', () => {
    expect(fx.dependencies).toHaveLength(30);
  });

  it('has 3 carry-over footprints', () => {
    const carried = fx.footprints.filter((f) => f.carryOverFromQuarterId !== undefined);
    expect(carried.length).toBeGreaterThanOrEqual(2);
    expect(carried.length).toBeLessThanOrEqual(3);
  });

  it('has 12 milestones', () => {
    expect(fx.milestones).toHaveLength(12);
  });

  it('has 8 people, of whom 2 are archived', () => {
    expect(fx.people).toHaveLength(8);
    expect(fx.people.filter((p) => !isActive(p))).toHaveLength(2);
  });

  it('has 10 external links covering all 7 link types', () => {
    expect(fx.externalLinks).toHaveLength(10);
    expect(new Set(fx.externalLinks.map((l) => l.type)).size).toBe(7);
  });

  it('spans 6 quarters', () => {
    expect(fx.horizon).toHaveLength(6);
    expect(fx.horizon[0]).toBe('2026-Q2');
    expect(fx.horizon.at(-1)).toBe('2027-Q3');
  });

  it('gives every team a container in every horizon quarter', () => {
    expect(fx.teamQuarters).toHaveLength(fx.teams.length * fx.horizon.length);
  });
});

describe('engineered conditions', () => {
  it('has exactly 2 overloaded team-quarters', () => {
    const summaries = fx.teamQuarters.map((tq) =>
      summariseCapacity({
        teamQuarter: tq,
        footprints: fx.footprints,
        commitmentsById,
        currentQuarterId: fx.currentQuarterId,
      }),
    );
    const overloaded = summaries.filter((s) => s.overflow > 0);

    expect(
      overloaded.map((s) => `${s.teamId} ${s.quarterId} +${s.overflow}`),
      'exactly two team-quarters over capacity',
    ).toHaveLength(2);
  });

  it('overloads Payments in the current quarter', () => {
    const summary = summarise('Payments', fx.currentQuarterId);
    expect(summary.effectiveCapacity).toBe(90);
    expect(summary.reservedTotal).toBe(28);
    expect(summary.deliverableCapacity).toBe(62);
    expect(summary.overflow).toBeGreaterThan(0);
    expect(utilisationPercent(summary)).toBeGreaterThan(100);
  });

  it('overloads Security in the current quarter', () => {
    const summary = summarise('Security', fx.currentQuarterId);
    expect(summary.deliverableCapacity).toBe(70);
    expect(summary.overflow).toBeGreaterThan(0);
  });

  it('has a decision hub with an in-degree of 6', () => {
    const inDegree = new Map<string, number>();
    for (const dep of fx.dependencies) {
      if (dep.target.kind !== 'DECISION') continue;
      inDegree.set(dep.target.id, (inDegree.get(dep.target.id) ?? 0) + 1);
    }
    const max = Math.max(...inDegree.values());
    expect(max).toBe(6);
  });

  it('contains a representable dependency cycle', () => {
    const edges = new Map<EntityId, EntityId[]>();
    for (const dep of fx.dependencies) {
      if (dep.target.kind !== 'COMMITMENT') continue;
      const list = edges.get(dep.sourceCommitmentId) ?? [];
      list.push(dep.target.id);
      edges.set(dep.sourceCommitmentId, list);
    }

    const hasCycle = [...edges.entries()].some(([source, targets]) =>
      targets.some((target) => edges.get(target)?.includes(source)),
    );
    expect(hasCycle, 'a cycle exists and is not a validation failure').toBe(true);
  });

  it('leaves the closed quarter closed', () => {
    const closed = fx.teamQuarters.filter((tq) => tq.closedAt !== undefined);
    expect(closed).toHaveLength(fx.teams.length);
    for (const tq of closed) {
      expect(ordinalOf(tq.quarterId)).toBeLessThan(ordinalOf(fx.currentQuarterId));
    }
  });
});

describe('model integrity', () => {
  it('keeps every Idea out of the capacity grid', () => {
    const ideaIds = new Set(fx.commitments.filter((c) => c.lifecycle === 'IDEA').map((c) => c.id));
    const ideaFootprints = fx.footprints.filter((f) => ideaIds.has(f.commitmentId));
    expect(ideaFootprints, 'Ideas never occupy a team-quarter block').toHaveLength(0);
  });

  it('gives every gated commitment exactly one primary footprint on its primary team', () => {
    for (const commitment of fx.commitments) {
      if (commitment.lifecycle === 'IDEA' || commitment.lifecycle === 'DROPPED') continue;

      const own = fx.footprints.filter((f) => f.commitmentId === commitment.id);
      const primary = own.filter((f) => f.isPrimary);

      expect(primary, `${commitment.name} has one primary footprint`).toHaveLength(1);
      expect(
        primary[0]!.teamId,
        `${commitment.name} primary footprint is on its primary team`,
      ).toBe(commitment.primaryTeamId);
    }
  });

  it('has at most one PRIMARY product impact per commitment', () => {
    const primaryCounts = new Map<EntityId, number>();
    for (const impact of fx.productImpacts) {
      if (impact.type !== 'PRIMARY') continue;
      primaryCounts.set(impact.commitmentId, (primaryCounts.get(impact.commitmentId) ?? 0) + 1);
    }
    for (const [commitmentId, count] of primaryCounts) {
      expect(count, `commitment ${commitmentId} has one PRIMARY impact`).toBe(1);
    }
  });

  it('has at most 6 milestones per commitment', () => {
    const counts = new Map<EntityId, number>();
    for (const milestone of fx.milestones) {
      counts.set(milestone.commitmentId, (counts.get(milestone.commitmentId) ?? 0) + 1);
    }
    for (const count of counts.values()) expect(count).toBeLessThanOrEqual(6);
  });

  it('uses https for every external link', () => {
    for (const link of fx.externalLinks) expect(link.url.startsWith('https://')).toBe(true);
  });

  it('has no self-referential dependency', () => {
    for (const dep of fx.dependencies) {
      if (dep.target.kind !== 'COMMITMENT') continue;
      expect(dep.sourceCommitmentId).not.toBe(dep.target.id);
    }
  });

  it('resolves every reference to an existing entity', () => {
    const teamIds = new Set(fx.teams.map((t) => t.id));
    const productIds = new Set(fx.products.map((p) => p.id));
    const decisionIds = new Set(fx.decisions.map((d) => d.id));
    const commitmentIds = new Set(fx.commitments.map((c) => c.id));

    for (const f of fx.footprints) {
      expect(commitmentIds.has(f.commitmentId), `footprint ${f.id} → commitment`).toBe(true);
      expect(teamIds.has(f.teamId), `footprint ${f.id} → team`).toBe(true);
    }
    for (const i of fx.productImpacts) {
      expect(commitmentIds.has(i.commitmentId), `impact ${i.id} → commitment`).toBe(true);
      expect(productIds.has(i.productServiceId), `impact ${i.id} → product`).toBe(true);
    }
    for (const d of fx.dependencies) {
      expect(commitmentIds.has(d.sourceCommitmentId), `dependency ${d.id} → source`).toBe(true);
      const targetSet =
        d.target.kind === 'COMMITMENT'
          ? commitmentIds
          : d.target.kind === 'DECISION'
            ? decisionIds
            : d.target.kind === 'TEAM'
              ? teamIds
              : new Set(fx.milestones.map((m) => m.id));
      expect(targetSet.has(d.target.id), `dependency ${d.id} → ${d.target.kind} target`).toBe(true);
    }
    for (const m of fx.milestones) {
      expect(commitmentIds.has(m.commitmentId), `milestone ${m.id} → commitment`).toBe(true);
    }
    for (const l of fx.externalLinks) {
      expect(commitmentIds.has(l.commitmentId), `link ${l.id} → commitment`).toBe(true);
    }
  });

  it('has unique ids across every entity collection', () => {
    const all = [
      ...fx.teams,
      ...fx.teamQuarters,
      ...fx.products,
      ...fx.people,
      ...fx.themes,
      ...fx.commitments,
      ...fx.footprints,
      ...fx.productImpacts,
      ...fx.commitmentThemes,
      ...fx.dependencies,
      ...fx.decisions,
      ...fx.milestones,
      ...fx.externalLinks,
    ].map((e) => e.id);

    expect(new Set(all).size, 'no duplicate entity ids').toBe(all.length);
  });

  it('has no duplicate footprint for the same commitment, team, and quarter', () => {
    const keys = fx.footprints.map((f) => `${f.commitmentId}|${f.teamId}|${f.quarterId}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('determinism', () => {
  it('builds byte-identically twice', () => {
    expect(JSON.stringify(validationFixture())).toBe(JSON.stringify(validationFixture()));
  });

  it('agrees between per-cell summaries and the portfolio aggregate', () => {
    const summaries = fx.teamQuarters.map((tq) =>
      summariseCapacity({
        teamQuarter: tq,
        footprints: fx.footprints,
        commitmentsById,
        currentQuarterId: fx.currentQuarterId,
      }),
    );
    const aggregate = aggregateCapacity(summaries);

    expect(aggregate.load).toBe(summaries.reduce((sum, s) => sum + s.committedLoad, 0));
    expect(aggregate.capacity).toBe(summaries.reduce((sum, s) => sum + s.deliverableCapacity, 0));
  });
});
