import { describe, expect, it } from 'vitest';
import { baselineProjection, type ScenarioProjection } from '@flowmap/domain';

import { scenarioComparisonAdditions } from './scenario-diff.js';
import {
  commitment,
  footprint,
  impact,
  product,
  state,
  team,
  teamQuarter,
  Q,
} from './test-support.js';

describe('scenario comparison additions', () => {
  it('counts ghost Ideas for change load and separates new attention signals', () => {
    const base = baselineProjection(
      state({
        teams: [team('t-1')],
        teamQuarters: [teamQuarter('tq-1', 't-1', Q)],
        commitments: [commitment('c-1', { lifecycle: 'IDEA' })],
        footprints: [footprint('f-1', 'c-1', 't-1', Q, 20)],
        products: [product('p-1')],
        productImpacts: [impact('i-1')],
      }),
    );
    const projected = { ...base, base, scenario: {} } as unknown as ScenarioProjection;
    const additions = scenarioComparisonAdditions(
      base,
      projected,
      [],
      [
        {
          signalKey: 'signal',
          ruleCode: 'CAP_OVERFLOW',
          severity: 'HIGH',
          entityRef: { kind: 'COMMITMENT', id: 'c-1' },
        } as never,
      ],
    );
    expect(additions.productImpact).toHaveLength(1);
    expect(additions.attention?.added).toHaveLength(1);
  });
});
