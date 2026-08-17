import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { mergeEntity } from './merge.js';

const NOW = '2026-08-17T09:00:00Z';

function entity(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'c-1',
    name: 'Payments',
    lifecycle: 'IDEA',
    outcome: undefined,
    entityVersion: 1,
    updatedAt: NOW,
    updatedBy: 'a',
    ...over,
  };
}

describe('mergeEntity', () => {
  it('auto-merges when each side changed a different field', () => {
    const base = entity({ name: 'Payments', outcome: undefined });
    const decision = mergeEntity({
      baseSnapshot: base,
      localPatch: entity({ name: 'Payments rebuilt', outcome: undefined }),
      localChanged: ['name'],
      remoteEntity: entity({ name: 'Payments', outcome: 'Cut cost' }),
      remoteDeleted: false,
    });
    expect(decision.kind).toBe('AUTO');
    if (decision.kind !== 'AUTO') return;
    expect(decision.merged['name']).toBe('Payments rebuilt');
    expect(decision.merged['outcome']).toBe('Cut cost');
  });

  it('conflicts when both sides changed the same field', () => {
    const base = entity({ name: 'Payments' });
    const decision = mergeEntity({
      baseSnapshot: base,
      localPatch: entity({ name: 'Mine' }),
      localChanged: ['name'],
      remoteEntity: entity({ name: 'Theirs' }),
      remoteDeleted: false,
    });
    expect(decision).toMatchObject({
      kind: 'CONFLICT',
      fields: [{ field: 'name', localValue: 'Mine', remoteValue: 'Theirs' }],
    });
  });

  it('treats coupled fields as whole-entity conflicts', () => {
    const base = entity({ settings: { a: 1 } });
    const decision = mergeEntity({
      baseSnapshot: base,
      localPatch: entity({ settings: { a: 2 } }),
      localChanged: ['settings'],
      remoteEntity: entity({ settings: { a: 3 } }),
      remoteDeleted: false,
    });
    expect(decision.kind).toBe('CONFLICT');
    if (decision.kind !== 'CONFLICT') return;
    expect(decision.fields.map((field) => field.field)).toEqual(['settings']);
  });

  it('lets a remote tombstone win a concurrent local update', () => {
    const decision = mergeEntity({
      baseSnapshot: entity(),
      localPatch: entity({ name: 'Still here' }),
      localChanged: ['name'],
      remoteEntity: null,
      remoteDeleted: true,
    });
    expect(decision.kind).toBe('TOMBSTONE');
  });
});

describe('mergeEntity properties', () => {
  it('never auto-merges an overlapping field change', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), fc.string(), (baseName, mine, theirs) => {
        fc.pre(new Set([baseName, mine, theirs]).size === 3);
        const decision = mergeEntity({
          baseSnapshot: entity({ name: baseName }),
          localPatch: entity({ name: mine }),
          localChanged: ['name'],
          remoteEntity: entity({ name: theirs }),
          remoteDeleted: false,
        });
        expect(decision.kind).toBe('CONFLICT');
      }),
    );
  });

  it('always auto-merges disjoint field edits', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (name, outcome) => {
        const decision = mergeEntity({
          baseSnapshot: entity({ name: 'base', outcome: 'old' }),
          localPatch: entity({ name, outcome: 'old' }),
          localChanged: ['name'],
          remoteEntity: entity({ name: 'base', outcome }),
          remoteDeleted: false,
        });
        expect(decision.kind).toBe('AUTO');
        if (decision.kind !== 'AUTO') return;
        expect(decision.merged['name']).toBe(name);
        expect(decision.merged['outcome']).toBe(outcome);
      }),
    );
  });
});
