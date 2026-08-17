/** Manual renewal and recurrence metadata. Automatic recurrence is deliberately absent. */

import { isActive, type Commitment } from './entities.js';
import type { Command, CommandContext, CommandResult, WorkspaceState } from './command.js';
import {
  authorise,
  bumped,
  created,
  domainFail,
  event,
  newEnvelope,
  succeed,
  updated,
} from './handler-kit.js';
import type { EntityId } from './primitives.js';

export type Recurrence = NonNullable<Commitment['recurrence']>;

export type SetRecurrencePayload = {
  readonly commitmentId: EntityId;
  readonly recurrence?: Recurrence;
};

export function setRecurrence(
  state: WorkspaceState,
  payload: SetRecurrencePayload,
  cmd: Command,
  ctx: CommandContext,
): CommandResult {
  const unauthorised = authorise(ctx, 'CONTRIBUTOR');
  if (unauthorised) return unauthorised;
  const commitment = state.commitments.get(payload.commitmentId);
  if (!commitment)
    return domainFail('ENTITY_NOT_FOUND', {
      entityRef: { kind: 'COMMITMENT', id: payload.commitmentId },
    });
  if (!isActive(commitment))
    return domainFail('ENTITY_ARCHIVED', { params: { name: commitment.name } });
  if (
    payload.recurrence?.pattern === 'CUSTOM' &&
    (!payload.recurrence.intervalQuarters || payload.recurrence.intervalQuarters < 1)
  ) {
    return domainFail('IMPORT_INVALID_ENUM_VALUE', {
      params: {
        field: 'intervalQuarters',
        value: String(payload.recurrence.intervalQuarters ?? ''),
      },
    });
  }
  const after = bumped(
    {
      ...commitment,
      ...(payload.recurrence ? { recurrence: payload.recurrence } : { recurrence: undefined }),
    },
    ctx,
  );
  return succeed({
    changes: [updated({ kind: 'COMMITMENT', id: commitment.id }, commitment, after)],
    events: [
      event(cmd, ctx, 0, 'RECURRENCE_SET', [{ kind: 'COMMITMENT', id: commitment.id }], {
        commitment: commitment.name,
        recurrence: payload.recurrence?.pattern ?? 'NONE',
      }),
    ],
    affectedProjections: [`commitment:${commitment.id}`],
    inverse: {
      ...cmd,
      id: ctx.ids.next(),
      name: 'SetRecurrence',
      payload: { commitmentId: commitment.id, recurrence: commitment.recurrence },
    },
  });
}

export type RenewCommitmentPayload = { readonly commitmentId: EntityId; readonly name?: string };

/** A human explicitly duplicates terminal work; no calendar process creates it. */
export function renewCommitment(
  state: WorkspaceState,
  payload: RenewCommitmentPayload,
  cmd: Command,
  ctx: CommandContext,
): CommandResult {
  const unauthorised = authorise(ctx, 'CONTRIBUTOR');
  if (unauthorised) return unauthorised;
  const predecessor = state.commitments.get(payload.commitmentId);
  if (!predecessor)
    return domainFail('ENTITY_NOT_FOUND', {
      entityRef: { kind: 'COMMITMENT', id: payload.commitmentId },
    });
  if (!isActive(predecessor))
    return domainFail('ENTITY_ARCHIVED', { params: { name: predecessor.name } });
  if (predecessor.lifecycle !== 'DONE' && predecessor.lifecycle !== 'DROPPED') {
    return domainFail('ILLEGAL_LIFECYCLE_TRANSITION', {
      params: { from: predecessor.lifecycle, to: 'IDEA' },
    });
  }
  const name = (payload.name ?? predecessor.name).trim();
  if (!name) return domainFail('NAME_REQUIRED');
  if (name.length > 140)
    return domainFail('NAME_TOO_LONG', { params: { max: 140, actual: name.length } });
  const renewed: Commitment = {
    ...newEnvelope(ctx.ids.next(), cmd, ctx),
    name,
    lifecycle: 'IDEA',
    class: predecessor.class,
    importance: predecessor.importance,
    valueDrivers: predecessor.valueDrivers,
    ...(predecessor.ownerRef ? { ownerRef: predecessor.ownerRef } : {}),
    ...(predecessor.outcome ? { outcome: predecessor.outcome } : {}),
    ...(predecessor.recurrence ? { recurrence: predecessor.recurrence } : {}),
    renewedFromCommitmentId: predecessor.id,
  };
  return succeed({
    changes: [created({ kind: 'COMMITMENT', id: renewed.id }, renewed)],
    events: [
      event(
        cmd,
        ctx,
        0,
        'COMMITMENT_RENEWED',
        [
          { kind: 'COMMITMENT', id: predecessor.id },
          { kind: 'COMMITMENT', id: renewed.id },
        ],
        { from: predecessor.name, to: renewed.name },
      ),
    ],
    affectedProjections: [`commitment:${renewed.id}`],
    inverse: {
      ...cmd,
      id: ctx.ids.next(),
      name: 'ArchiveCommitment',
      payload: { commitmentId: renewed.id },
    },
  });
}
