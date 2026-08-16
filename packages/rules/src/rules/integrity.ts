/**
 * Integrity rules — docs/spec/04-rules-radar.md §4.8.
 *
 * These are the rules about the data rather than the portfolio: references that
 * point at nothing, rows written by a newer build, and credentials pasted into
 * a note. None of them can be switched off — a workspace that could hide its
 * own corruption is worse than one that never noticed.
 */

import { SCHEMA_VERSION, isActive } from '@flowmap/domain';

import { scanForSecrets } from '../secrets.js';
import type { Rule, RuleFinding } from '../types.js';
import { commitments, dependencies, links, ref, targetEntity } from '../helpers.js';

export const INT_DANGLING_REF: Rule = {
  code: 'INT_DANGLING_REF',
  category: 'INTEGRITY',
  severity: 'HIGH',
  surfaces: ['INTEGRITY', 'INLINE'],
  reads: ['commitment:*', 'dependencyGraph'],
  canDisable: false,
  materialFacts: ['fromRef', 'toRef'],
  evaluate: ({ state }) => {
    const findings: RuleFinding[] = [];

    // A dependency pointing at something we do not hold at all. Distinct from
    // DEP_TARGET_ARCHIVED, which points at something archived but present.
    for (const dependency of dependencies(state)) {
      const { exists } = targetEntity(state, dependency.target);
      if (exists) continue;

      findings.push({
        entityRef: ref('DEPENDENCY', dependency.id),
        facts: {
          fromRef: `DEPENDENCY:${dependency.id}`,
          toRef: `${dependency.target.kind}:${dependency.target.id}`,
          kind: dependency.target.kind,
        },
        actions: [
          {
            kind: 'COMMAND',
            command: 'RemoveDependency',
            payload: { dependencyId: dependency.id },
            labelKey: 'action.removeDependency',
          },
        ],
      });
    }

    // A commitment placed on a team that is gone.
    for (const commitment of commitments(state)) {
      const teamId = commitment.primaryTeamId;
      if (!teamId || state.teams.has(teamId)) continue;

      findings.push({
        entityRef: ref('COMMITMENT', commitment.id),
        discriminator: `TEAM:${teamId}`,
        facts: {
          fromRef: `COMMITMENT:${commitment.id}`,
          toRef: `TEAM:${teamId}`,
          kind: 'TEAM',
          commitment: commitment.name,
        },
        actions: [
          {
            kind: 'OPEN',
            ref: ref('COMMITMENT', commitment.id),
            labelKey: 'action.openCommitment',
          },
        ],
      });
    }

    return findings;
  },
};

export const INT_SCHEMA_AHEAD: Rule = {
  code: 'INT_SCHEMA_AHEAD',
  category: 'INTEGRITY',
  severity: 'HIGH',
  surfaces: ['INTEGRITY'],
  reads: ['commitment:*', 'capacity:*', 'dependencyGraph'],
  canDisable: false,
  materialFacts: ['entityRef', 'schemaVersion'],
  evaluate: ({ state }) => {
    const findings: RuleFinding[] = [];

    // A row written by a build newer than this one. Reported rather than
    // dropped: the row is someone's work, and a build that silently ignores
    // what it does not understand loses data quietly.
    const scan = [
      ...[...state.commitments.values()].map((e) => [ref('COMMITMENT', e.id), e] as const),
      ...[...state.teams.values()].map((e) => [ref('TEAM', e.id), e] as const),
      ...[...state.footprints.values()].map((e) => [ref('CAPACITY_FOOTPRINT', e.id), e] as const),
      ...[...state.teamQuarters.values()].map((e) => [ref('TEAM_QUARTER', e.id), e] as const),
    ];

    for (const [entityRef, entity] of scan) {
      if (entity.schemaVersion <= SCHEMA_VERSION) continue;
      findings.push({
        entityRef,
        facts: {
          entityRef: `${entityRef.kind}:${'id' in entityRef ? entityRef.id : ''}`,
          schemaVersion: entity.schemaVersion,
          buildSchemaVersion: SCHEMA_VERSION,
        },
      });
    }

    return findings;
  },
};

/**
 * Credentials pasted into a note or a link label.
 *
 * The facts carry the pattern id and a redacted preview, never the matched
 * text: a signal is stored, synchronised and possibly exported, so putting the
 * secret in it would spread the thing the rule exists to contain.
 */
export const SEC_SECRET_SUSPECTED: Rule = {
  code: 'SEC_SECRET_SUSPECTED',
  category: 'INTEGRITY',
  severity: 'HIGH',
  surfaces: ['INTEGRITY', 'INLINE'],
  reads: ['commitment:*'],
  canDisable: false,
  materialFacts: ['entityRef', 'field', 'patternId'],
  evaluate: ({ state }) => {
    const findings: RuleFinding[] = [];

    for (const commitment of commitments(state)) {
      for (const [field, text] of [
        ['managementNote', commitment.managementNote],
        ['outcome', commitment.outcome],
        ['nextAction', commitment.nextAction],
      ] as const) {
        for (const match of scanForSecrets(text)) {
          findings.push({
            entityRef: ref('COMMITMENT', commitment.id),
            discriminator: `${field}:${match.patternId}`,
            facts: {
              entityRef: `COMMITMENT:${commitment.id}`,
              commitment: commitment.name,
              field,
              patternId: match.patternId,
              preview: match.preview,
            },
            actions: [
              {
                kind: 'OPEN',
                ref: ref('COMMITMENT', commitment.id),
                labelKey: 'action.openCommitment',
              },
            ],
          });
        }
      }
    }

    for (const link of links(state)) {
      for (const match of scanForSecrets(link.label)) {
        findings.push({
          entityRef: ref('EXTERNAL_LINK', link.id),
          discriminator: `label:${match.patternId}`,
          facts: {
            entityRef: `EXTERNAL_LINK:${link.id}`,
            field: 'label',
            patternId: match.patternId,
            preview: match.preview,
          },
          actions: [
            {
              kind: 'COMMAND',
              command: 'RemoveExternalLink',
              payload: { linkId: link.id },
              labelKey: 'action.removeLink',
            },
          ],
        });
      }
    }

    return findings;
  },
};

/** Archived people still owning live work, which sync will not fix on its own. */
export function danglingPeople(state: Parameters<typeof commitments>[0]): number {
  return commitments(state).filter((commitment) => {
    const owner = commitment.ownerRef;
    if (owner?.kind !== 'PERSON') return false;
    const person = state.people?.get(owner.personId);
    return person !== undefined && !isActive(person);
  }).length;
}

export const INTEGRITY_RULES: readonly Rule[] = [
  INT_DANGLING_REF,
  INT_SCHEMA_AHEAD,
  SEC_SECRET_SUSPECTED,
];
