/**
 * Commands for disposing of a signal — docs/spec/03-commands-permissions.md §3.6.
 *
 * Three commands, and the set is deliberately small: `Reviewed — no change`,
 * `Snooze until`, and `Clear`. There is no `Dismiss`, because a system-generated
 * signal that a user can silence permanently is a signal the product cannot
 * stand behind. Every disposition lapses when the condition changes or worsens;
 * that logic lives in the evaluator, and these commands only record the decision.
 *
 * A Viewer may dispose of a signal. It is their own view of their own radar —
 * dispositions are keyed by actor and change nothing anyone else sees.
 */

import { isActive, type SignalDisposition, type Severity } from './entities.js';
import type { Command, CommandContext, CommandResult, WorkspaceState } from './command.js';
import {
  archivedChange,
  authorise,
  bumped,
  created,
  domainFail as fail,
  event,
  newEnvelope,
  requireText,
  succeed,
  updated,
} from './handler-kit.js';
import type { EntityId, IsoDate } from './primitives.js';

/** The collection these handlers read. Optional, like the other relation maps. */
export type SignalState = WorkspaceState & {
  readonly signalDispositions?: ReadonlyMap<EntityId, SignalDisposition>;
};

export type ReviewSignalPayload = {
  readonly signalKey: string;
  readonly atFingerprint: string;
  readonly atSeverity: Severity;
  readonly note?: string;
};

export type SnoozeSignalPayload = ReviewSignalPayload & {
  readonly snoozeUntil: IsoDate;
};

const NOTE_MAX = 280;

/**
 * `Reviewed — no change`.
 *
 * Records the fingerprint and severity at the moment of review, which is what
 * lets the suppression rule expire it on change rather than on a timer.
 */
export function reviewSignal(
  state: SignalState,
  payload: ReviewSignalPayload,
  cmd: Command,
  ctx: CommandContext,
): CommandResult {
  return upsertDisposition(state, { ...payload, disposition: 'REVIEWED' }, cmd, ctx);
}

/**
 * Snooze until a date.
 *
 * The date is required — a snooze with no return is a dismissal wearing a
 * different word, and the product does not have one.
 */
export function snoozeSignal(
  state: SignalState,
  payload: SnoozeSignalPayload,
  cmd: Command,
  ctx: CommandContext,
): CommandResult {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.snoozeUntil)) {
    return fail('NAME_REQUIRED', { field: 'snoozeUntil' });
  }
  // A snooze into the past would be a no-op the user could not see.
  if (payload.snoozeUntil <= ctx.clock.today('UTC')) {
    return fail('NAME_REQUIRED', { field: 'snoozeUntil' });
  }

  return upsertDisposition(state, { ...payload, disposition: 'SNOOZED' }, cmd, ctx);
}

/** Un-suppresses. The only thing that clears a disposition. */
export function clearSignalDisposition(
  state: SignalState,
  payload: { readonly signalKey: string },
  cmd: Command,
  ctx: CommandContext,
): CommandResult {
  const unauthorised = authorise(ctx, 'VIEWER');
  if (unauthorised) return unauthorised;

  const existing = findOwn(state, payload.signalKey, ctx.actorId);
  if (!existing || !isActive(existing)) {
    return succeed({ changes: [], events: [], affectedProjections: [] });
  }

  const after = bumped({ ...existing, archivedAt: ctx.clock.now(), archivedBy: ctx.actorId }, ctx);
  const ref = { kind: 'SIGNAL_DISPOSITION', id: existing.id } as const;

  return succeed({
    changes: [archivedChange(ref, existing, after)],
    events: [
      event(cmd, ctx, 0, 'SIGNAL_DISPOSITION_CLEARED', [ref], {
        signalKey: existing.signalKey,
        disposition: existing.disposition,
      }),
    ],
    affectedProjections: ['radar'],
    inverse: {
      ...cmd,
      id: ctx.ids.next(),
      name: existing.disposition === 'SNOOZED' ? 'SnoozeSignal' : 'ReviewSignal',
      payload: {
        signalKey: existing.signalKey,
        atFingerprint: existing.atFingerprint,
        atSeverity: existing.atSeverity,
        ...(existing.snoozeUntil ? { snoozeUntil: existing.snoozeUntil } : {}),
        ...(existing.note ? { note: existing.note } : {}),
      },
    },
  });
}

function upsertDisposition(
  state: SignalState,
  payload: ReviewSignalPayload & {
    readonly disposition: SignalDisposition['disposition'];
    readonly snoozeUntil?: IsoDate;
  },
  cmd: Command,
  ctx: CommandContext,
): CommandResult {
  const unauthorised = authorise(ctx, 'VIEWER');
  if (unauthorised) return unauthorised;

  if (!payload.signalKey || !payload.atFingerprint) {
    return fail('NAME_REQUIRED', { field: 'signalKey' });
  }
  const noteError = requireText(payload.note, NOTE_MAX);
  if (noteError) return noteError;

  const existing = findOwn(state, payload.signalKey, ctx.actorId);

  const next = {
    signalKey: payload.signalKey,
    disposition: payload.disposition,
    atFingerprint: payload.atFingerprint,
    atSeverity: payload.atSeverity,
    actorId: ctx.actorId,
    ...(payload.snoozeUntil !== undefined ? { snoozeUntil: payload.snoozeUntil } : {}),
    ...(payload.note !== undefined ? { note: payload.note } : {}),
  };

  // Re-disposing the same signal replaces the decision rather than stacking a
  // second row — one actor has one opinion about one signal at a time.
  if (existing) {
    const { archivedAt: _at, archivedBy: _by, ...live } = existing;
    const after = bumped({ ...live, ...next } as SignalDisposition, ctx);
    const ref = { kind: 'SIGNAL_DISPOSITION', id: existing.id } as const;
    const change = updated(ref, existing, after);
    if (change.changedFields.length === 0) {
      return succeed({ changes: [], events: [], affectedProjections: [] });
    }

    return succeed({
      changes: [change],
      events: [disposalEvent(cmd, ctx, ref, next)],
      affectedProjections: ['radar'],
      inverse: inverseOf(cmd, ctx, existing),
    });
  }

  const disposition: SignalDisposition = {
    ...newEnvelope(ctx.ids.next(), cmd, ctx),
    ...next,
  };
  const ref = { kind: 'SIGNAL_DISPOSITION', id: disposition.id } as const;

  return succeed({
    changes: [created(ref, disposition)],
    events: [disposalEvent(cmd, ctx, ref, next)],
    affectedProjections: ['radar'],
    inverse: {
      ...cmd,
      id: ctx.ids.next(),
      name: 'ClearSignalDisposition',
      payload: { signalKey: payload.signalKey },
    },
  });
}

function disposalEvent(
  cmd: Command,
  ctx: CommandContext,
  ref: { kind: 'SIGNAL_DISPOSITION'; id: EntityId },
  next: { signalKey: string; disposition: string; snoozeUntil?: IsoDate },
) {
  return event(
    cmd,
    ctx,
    0,
    next.disposition === 'SNOOZED' ? 'SIGNAL_SNOOZED' : 'SIGNAL_REVIEWED',
    [ref],
    {
      signalKey: next.signalKey,
      ...(next.snoozeUntil ? { snoozeUntil: next.snoozeUntil } : {}),
    },
  );
}

function inverseOf(cmd: Command, ctx: CommandContext, previous: SignalDisposition): Command {
  return {
    ...cmd,
    id: ctx.ids.next(),
    name: previous.disposition === 'SNOOZED' ? 'SnoozeSignal' : 'ReviewSignal',
    payload: {
      signalKey: previous.signalKey,
      atFingerprint: previous.atFingerprint,
      atSeverity: previous.atSeverity,
      ...(previous.snoozeUntil ? { snoozeUntil: previous.snoozeUntil } : {}),
      ...(previous.note ? { note: previous.note } : {}),
    },
  };
}

/** Dispositions are per user: this actor's opinion, not anyone else's. */
function findOwn(
  state: SignalState,
  signalKey: string,
  actorId: string,
): SignalDisposition | undefined {
  return [...(state.signalDispositions?.values() ?? [])].find(
    (row) => row.signalKey === signalKey && row.actorId === actorId,
  );
}

/**
 * Dispositions whose signal no longer evaluates, past the retention window.
 *
 * Returned rather than deleted here: the domain decides *what* is collectable,
 * storage decides when to act on it (spec 04 §3.3 — 90 days).
 */
export function collectableDispositions(
  state: SignalState,
  liveSignalKeys: ReadonlySet<string>,
  today: IsoDate,
  retentionDays = 90,
): SignalDisposition[] {
  return [...(state.signalDispositions?.values() ?? [])].filter((row) => {
    if (liveSignalKeys.has(row.signalKey)) return false;
    const age = daysSince(row.updatedAt.slice(0, 10), today);
    return age > retentionDays;
  });
}

function daysSince(from: IsoDate, to: IsoDate): number {
  const parse = (d: IsoDate) => {
    const [y, m, day] = d.split('-').map(Number);
    return Date.UTC(y ?? 1970, (m ?? 1) - 1, day ?? 1);
  };
  return Math.round((parse(to) - parse(from)) / 86_400_000);
}
