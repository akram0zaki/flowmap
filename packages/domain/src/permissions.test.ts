import { describe, expect, it } from 'vitest';
import { COMMAND_PERMISSIONS, mayRunCommand } from './permissions.js';
import { setNotificationSettings } from './workspace-settings.js';
import type { Command, WorkspaceState } from './command.js';

describe('command permission harness', () => {
  it('denies every registered M6 command to viewers', () => {
    for (const command of Object.keys(COMMAND_PERMISSIONS))
      expect(mayRunCommand('VIEWER', command)).toBe(false);
  });
  it('retains the contributor quick-capture boundary', () => {
    expect(mayRunCommand('CONTRIBUTOR', 'CreateIdea')).toBe(true);
    expect(mayRunCommand('CONTRIBUTOR', 'RestoreSnapshot')).toBe(false);
  });

  it('enforces a registered preference command in its domain handler', () => {
    const state = {
      workspace: {
        id: 'workspace',
        workspaceId: 'workspace',
        schemaVersion: 1,
        entityVersion: 1,
        createdAt: '2026-08-17T00:00:00Z',
        createdBy: 'planner',
        updatedAt: '2026-08-17T00:00:00Z',
        updatedBy: 'planner',
        name: 'Portfolio',
        timezone: 'Europe/Amsterdam',
        currentQuarterId: '2026-Q3',
        isSample: false,
        revision: 1,
        settings: {
          capacity: {
            defaultTeamQuarterCapacity: 100,
            sizeMapping: { XS: 5, S: 10, M: 20, L: 35 },
            defaultReserves: [],
          },
          changeLoad: {
            impactBase: { PRIMARY: 3, MAJOR: 2, MINOR: 0.5, DEPENDENCY: 0.25 },
            referenceUnits: 20,
            mandatoryFactor: 1.5,
            thresholdMedium: 6,
            thresholdHigh: 12,
          },
          valueDrivers: [],
          noteMaxLength: 2000,
          milestonesPerCommitment: 6,
        },
      },
      teams: new Map(),
      teamQuarters: new Map(),
      commitments: new Map(),
      footprints: new Map(),
    } as WorkspaceState;
    const command: Command = {
      id: 'command',
      name: 'SetNotificationSettings',
      workspaceId: 'workspace',
      payload: {},
      actorId: 'viewer',
      issuedAt: '2026-08-17T00:00:00Z',
    };
    const result = setNotificationSettings(state, { mode: 'OFF' }, command, {
      clock: { now: () => '2026-08-17T00:00:00Z', today: () => '2026-08-17' },
      ids: { next: () => 'generated' },
      actorId: 'viewer',
      role: 'VIEWER',
      nextSequence: 1,
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'UNAUTHORISED' } });
  });
});
