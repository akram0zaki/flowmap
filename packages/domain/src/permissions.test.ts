import { describe, expect, it } from 'vitest';
import { COMMAND_PERMISSIONS, mayRunCommand } from './permissions.js';

describe('command permission harness', () => {
  it('denies every registered M6 command to viewers', () => {
    for (const command of Object.keys(COMMAND_PERMISSIONS))
      expect(mayRunCommand('VIEWER', command)).toBe(false);
  });
  it('retains the contributor quick-capture boundary', () => {
    expect(mayRunCommand('CONTRIBUTOR', 'CreateIdea')).toBe(true);
    expect(mayRunCommand('CONTRIBUTOR', 'RestoreSnapshot')).toBe(false);
  });
});
