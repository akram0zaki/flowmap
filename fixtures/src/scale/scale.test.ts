import { describe, expect, it } from 'vitest';

import { scaleFixture } from './scale.js';

/**
 * A benchmark fixture is only useful if it is the same every run and shaped
 * like the real thing. Random data would make a regression look like noise, and
 * a pile of identical rows would benchmark the renderer's best case.
 */
describe('scale fixtures', () => {
  it.each([25, 100, 500] as const)('generates exactly %i commitments', (size) => {
    expect(scaleFixture(size).commitments).toHaveLength(size);
  });

  it('is deterministic — the same call twice is the same workspace', () => {
    expect(JSON.stringify(scaleFixture(100))).toBe(JSON.stringify(scaleFixture(100)));
  });

  // Spec 11 §5.2: 500 commitments should produce roughly 900 footprints.
  it('scales footprints proportionally, near the ratio the spec expects', () => {
    const { commitments, footprints } = scaleFixture(500);
    const placed = commitments.filter((c) => c.lifecycle !== 'IDEA').length;

    expect(footprints.length / placed).toBeGreaterThan(1.5);
    expect(footprints.length / placed).toBeLessThan(2);
    expect(footprints.length).toBeGreaterThan(700);
  });

  it('keeps Ideas out of capacity, at every scale', () => {
    const { commitments, footprints } = scaleFixture(500);
    const ideas = new Set(commitments.filter((c) => c.lifecycle === 'IDEA').map((c) => c.id));

    expect(footprints.filter((f) => ideas.has(f.commitmentId))).toHaveLength(0);
  });

  it('spreads work across teams and quarters rather than piling it up', () => {
    const { footprints } = scaleFixture(500);

    expect(new Set(footprints.map((f) => f.teamId)).size).toBeGreaterThan(15);
    expect(new Set(footprints.map((f) => f.quarterId)).size).toBe(6);
  });

  it('gives every placed commitment exactly one primary footprint', () => {
    const { commitments, footprints } = scaleFixture(100);

    for (const commitment of commitments) {
      if (commitment.lifecycle === 'IDEA') continue;
      const primary = footprints.filter((f) => f.commitmentId === commitment.id && f.isPrimary);
      expect(primary, commitment.name).toHaveLength(1);
    }
  });

  it('has unique ids, so nothing silently overwrites anything else', () => {
    const { commitments, footprints, teams, teamQuarters } = scaleFixture(500);
    const ids = [
      ...commitments.map((c) => c.id),
      ...footprints.map((f) => f.id),
      ...teams.map((t) => t.id),
      ...teamQuarters.map((tq) => tq.id),
    ];

    expect(new Set(ids).size).toBe(ids.length);
  });
});
