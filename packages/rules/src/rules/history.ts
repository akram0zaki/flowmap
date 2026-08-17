/** Deterministic recommendations over recorded closed-quarter judgements. */

import type { Rule, RuleFinding, RuleInput } from '../types.js';
import { ref } from '../helpers.js';

type Review = {
  readonly quarterId: string;
  readonly outcomes: readonly {
    readonly teamId: string;
    readonly operationalLoad: 'BELOW' | 'ABOUT' | 'ABOVE';
    readonly capacity: 'LOWER' | 'ABOUT' | 'HIGHER';
  }[];
  readonly carriedByTeam: Readonly<Record<string, number>>;
  readonly sizeRatiosByTeam: Readonly<Record<string, readonly number[]>>;
};

function reviewsFor(input: RuleInput, teamId: string): Review[] {
  return [...(input.ctx.history?.closedQuarters ?? [])]
    .sort((a, b) => b.quarterId.localeCompare(a.quarterId))
    .slice(0, 3)
    .filter((review) => review.outcomes.some((outcome) => outcome.teamId === teamId));
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

function historyRule(
  code: Rule['code'],
  severity: Rule['severity'],
  predicate: (
    reviews: readonly Review[],
    teamId: string,
  ) => { facts: Record<string, string | number | boolean> } | null,
): Rule {
  return {
    code,
    category: 'HISTORY',
    severity,
    surfaces: ['RADAR'],
    reads: ['radar'],
    canDisable: true,
    materialFacts: ['teamId', 'quarters', 'count'],
    evaluate: (input) =>
      [...input.state.teams.values()].flatMap((team): RuleFinding[] => {
        if (team.archivedAt !== undefined || !team.active) return [];
        const reviews = reviewsFor(input, team.id);
        const finding = predicate(reviews, team.id);
        return finding
          ? [
              {
                entityRef: ref('TEAM', team.id),
                facts: { teamId: team.id, team: team.name, ...finding.facts },
                actions: [
                  {
                    kind: 'NAVIGATE',
                    lens: 'HISTORY',
                    labelKey: 'action.openHistory',
                    focus: ref('TEAM', team.id),
                  },
                ],
              },
            ]
          : [];
      }),
  };
}

export const HST_RESERVE_EXCEEDED = historyRule(
  'HST_RESERVE_EXCEEDED',
  'MEDIUM',
  (reviews, teamId) => {
    const matches = reviews.filter(
      (review) =>
        review.outcomes.find((item) => item.teamId === teamId)?.operationalLoad === 'ABOVE',
    );
    return matches.length >= 2
      ? {
          facts: {
            count: matches.length,
            quarters: matches.map((item) => item.quarterId).join(', '),
          },
        }
      : null;
  },
);

export const HST_RESERVE_UNUSED = historyRule('HST_RESERVE_UNUSED', 'LOW', (reviews, teamId) => {
  const matches = reviews.filter(
    (review) => review.outcomes.find((item) => item.teamId === teamId)?.operationalLoad === 'BELOW',
  );
  return matches.length >= 3
    ? {
        facts: {
          count: matches.length,
          quarters: matches.map((item) => item.quarterId).join(', '),
        },
      }
    : null;
});

export const HST_CARRYOVER_PATTERN = historyRule(
  'HST_CARRYOVER_PATTERN',
  'MEDIUM',
  (reviews, teamId) => {
    const matches = reviews.filter((review) => (review.carriedByTeam[teamId] ?? 0) > 0);
    return matches.length >= 2
      ? {
          facts: {
            count: matches.length,
            quarters: matches.map((item) => item.quarterId).join(', '),
            carriedUnits: matches.reduce(
              (total, item) => total + (item.carriedByTeam[teamId] ?? 0),
              0,
            ),
          },
        }
      : null;
  },
);

export const HST_CAPACITY_OPTIMISTIC = historyRule(
  'HST_CAPACITY_OPTIMISTIC',
  'MEDIUM',
  (reviews, teamId) => {
    const matches = reviews.filter(
      (review) => review.outcomes.find((item) => item.teamId === teamId)?.capacity === 'LOWER',
    );
    return matches.length >= 2
      ? {
          facts: {
            count: matches.length,
            quarters: matches.map((item) => item.quarterId).join(', '),
          },
        }
      : null;
  },
);

export const HST_SIZE_DRIFT = historyRule('HST_SIZE_DRIFT', 'LOW', (reviews, teamId) => {
  const ratios = reviews.flatMap((review) => review.sizeRatiosByTeam[teamId] ?? []);
  const ratio = median(ratios);
  return ratio >= 1.3
    ? {
        facts: {
          count: ratios.length,
          quarters: reviews.map((item) => item.quarterId).join(', '),
          ratio: Math.round(ratio * 100) / 100,
        },
      }
    : null;
});

export const HISTORY_RULES: readonly Rule[] = [
  HST_RESERVE_EXCEEDED,
  HST_RESERVE_UNUSED,
  HST_CARRYOVER_PATTERN,
  HST_CAPACITY_OPTIMISTIC,
  HST_SIZE_DRIFT,
];
