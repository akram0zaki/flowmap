/** Scenario-only projections that join the domain diff to rule-derived facts. */

import type {
  BaselineProjection,
  ScenarioAttentionSignal,
  ScenarioComparisonAdditions,
  ScenarioProjection,
} from '@flowmap/domain';

import { allChangeLoads } from './change-load.js';
import { compareSeverity, type RuleResult } from './types.js';

function signal(item: RuleResult): ScenarioAttentionSignal {
  return {
    signalKey: item.signalKey,
    ruleCode: item.ruleCode,
    severity: item.severity,
    entityRef: item.entityRef,
  };
}

/** Keeps the domain package pure and dependency-free while still diffing rules. */
export function scenarioComparisonAdditions(
  baseline: BaselineProjection,
  projected: ScenarioProjection,
  baselineSignals: readonly RuleResult[],
  scenarioSignals: readonly RuleResult[],
): ScenarioComparisonAdditions {
  const beforeLoads = new Map(
    allChangeLoads(baseline).map((load) => [`${load.productServiceId}:${load.quarterId}`, load]),
  );
  const afterLoads = new Map(
    allChangeLoads(projected, { includeScenarioIdeas: true }).map((load) => [
      `${load.productServiceId}:${load.quarterId}`,
      load,
    ]),
  );
  const productImpact = [...new Set([...beforeLoads.keys(), ...afterLoads.keys()])]
    .map((key) => {
      const before = beforeLoads.get(key);
      const after = afterLoads.get(key);
      const sample = after ?? before;
      if (!sample) return null;
      const scoreBefore = before?.score ?? 0;
      const scoreAfter = after?.score ?? 0;
      if (scoreBefore === scoreAfter && before?.level === after?.level) return null;
      return {
        productServiceId: sample.productServiceId,
        quarterId: sample.quarterId,
        changeLoadBefore: before?.level ?? 'LOW',
        changeLoadAfter: after?.level ?? 'LOW',
        scoreBefore,
        scoreAfter,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort(
      (left, right) =>
        left.productServiceId.localeCompare(right.productServiceId) ||
        left.quarterId.localeCompare(right.quarterId),
    );
  const beforeByKey = new Map(baselineSignals.map((item) => [item.signalKey, item]));
  const afterByKey = new Map(scenarioSignals.map((item) => [item.signalKey, item]));
  return {
    productImpact,
    attention: {
      added: scenarioSignals.filter((item) => !beforeByKey.has(item.signalKey)).map(signal),
      removed: baselineSignals.filter((item) => !afterByKey.has(item.signalKey)).map(signal),
      worsened: scenarioSignals
        .filter((item) => {
          const before = beforeByKey.get(item.signalKey);
          return before !== undefined && compareSeverity(item.severity, before.severity) > 0;
        })
        .map(signal),
    },
  };
}
