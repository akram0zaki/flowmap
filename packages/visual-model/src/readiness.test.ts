import { describe, expect, it } from 'vitest';
import type { CapacityFootprint, Commitment } from '@flowmap/domain';

import { ideaReadiness, readinessForIdeas } from './readiness.js';

const NOW = '2026-08-15T09:00:00Z';

function env(id: string) {
  return {
    id,
    workspaceId: 'ws',
    schemaVersion: 1,
    entityVersion: 1,
    createdAt: NOW,
    createdBy: 'a',
    updatedAt: NOW,
    updatedBy: 'a',
  };
}

function idea(over: Partial<Commitment> = {}): Commitment {
  return {
    ...env('i-1'),
    name: 'Request to pay',
    lifecycle: 'IDEA',
    class: 'DISCRETIONARY',
    importance: 'MEDIUM',
    valueDrivers: [],
    ...over,
  };
}

function footprint(over: Partial<CapacityFootprint> = {}): CapacityFootprint {
  return {
    ...env('f-1'),
    commitmentId: 'i-1',
    teamId: 't-1',
    quarterId: '2026-Q3',
    units: 20,
    unitsSource: 'EXPLICIT',
    isPrimary: true,
    ...over,
  };
}

const complete = idea({
  primaryTeamId: 't-1',
  targetQuarterId: '2026-Q3',
  ownerRef: { kind: 'PERSON', personId: 'p-1' },
  outcome: 'Instant payments live',
});

describe('idea readiness', () => {
  it('lists every gap on a bare Idea, blockers first', () => {
    const state = ideaReadiness(idea(), []);
    expect(state.gaps).toEqual(['PRIMARY_TEAM', 'TARGET', 'OWNER', 'OUTCOME']);
    expect(state.settled).toBe(0);
    expect(state.readyToPlace).toBe(false);
  });

  it('is ready to place once every decision is taken', () => {
    const state = ideaReadiness(complete, []);
    expect(state.gaps).toEqual([]);
    expect(state.settled).toBe(4);
    expect(state.readyToPlace).toBe(true);
  });

  // Placement happens *at* the gate. If a missing footprint counted against an
  // Idea, no Idea could ever be ready and the signal would be dead on arrival.
  it('does not hold a missing footprint against an Idea', () => {
    expect(ideaReadiness(complete, []).gaps).toEqual([]);
  });

  it('counts partial progress', () => {
    const { outcome: _o, ...partial } = complete;
    const state = ideaReadiness(partial as Commitment, []);

    expect(state.gaps).toEqual(['OUTCOME']);
    expect(state.settled).toBe(3);
    expect(state.readyToPlace).toBe(false);
  });

  it('treats a missing primary team as blocking — there is nothing to place into', () => {
    const { primaryTeamId: _p, ...homeless } = complete;
    const state = ideaReadiness(homeless as Commitment, []);
    expect(state.blocking).toEqual(['PRIMARY_TEAM']);
  });

  it('accepts a target date instead of a target quarter', () => {
    const { targetQuarterId: _q, ...dated } = complete;
    const state = ideaReadiness({ ...dated, targetDate: '2026-11-30' } as Commitment, []);
    expect(state.gaps).not.toContain('TARGET');
  });

  it('reports sketched units, and ignores archived footprints', () => {
    expect(ideaReadiness(complete, [footprint()]).plannedUnits).toBe(20);
    expect(ideaReadiness(complete, [footprint({ archivedAt: NOW })]).plannedUnits).toBe(0);
  });
});

describe('readinessForIdeas', () => {
  it('covers Ideas only, and skips archived ones', () => {
    const commitments = new Map<string, Commitment>([
      ['i-1', idea()],
      ['c-1', idea({ ...env('c-1'), lifecycle: 'COMMITTED' })],
      ['a-1', idea({ ...env('a-1'), archivedAt: NOW })],
    ]);

    const map = readinessForIdeas(commitments, new Map());
    expect([...map.keys()]).toEqual(['i-1']);
  });
});
