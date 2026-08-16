import { describe, expect, it } from 'vitest';

import { translate } from './index.js';

describe('translate', () => {
  it('interpolates named placeholders', () => {
    expect(translate('en', 'common.capacity.units', { units: 20 })).toBe('20 units');
  });

  it('returns the key when it is missing, rather than throwing', () => {
    expect(translate('en', 'common.does.not.exist')).toBe('common.does.not.exist');
  });

  it('leaves an unsupplied placeholder in place', () => {
    expect(translate('en', 'common.capacity.units')).toBe('{units} units');
  });

  describe('plurals', () => {
    it('uses the .one variant at exactly one', () => {
      expect(translate('en', 'common.map.blockCount', { count: 1 })).toBe('1 commitment');
    });

    it('uses the plural form otherwise, including at zero', () => {
      expect(translate('en', 'common.map.blockCount', { count: 0 })).toBe('0 commitments');
      expect(translate('en', 'common.map.blockCount', { count: 4 })).toBe('4 commitments');
    });

    it('selects on units as well as count', () => {
      expect(translate('en', 'common.capacity.units', { units: 1 })).toBe('1 unit');
    });

    // Most keys have no singular variant, and must not fall through to the key.
    it('falls back to the plural form when no .one variant exists', () => {
      expect(translate('en', 'common.signal.fixed', { units: 1 })).toBe('1 fixed');
    });
  });
});
