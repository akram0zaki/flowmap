/**
 * Commands for everything a commitment relates to: products and their typed
 * impacts, dependencies, decisions, milestones, themes, and external links.
 *
 * Two invariants here carry most of the weight:
 *   · at most one `PRIMARY` product impact per commitment — the focal point;
 *   · dependency direction never flips — `source` waits, `target` unblocks.
 *
 * See docs/spec/01-domain-model.md §7–§10.
 */

import {
  HARD_BY_DEFAULT,
  isActive,
  type CommitmentTheme,
  type Decision,
  type Dependency,
  type DependencyStatus,
  type DependencyTarget,
  type DependencyType,
  type ExternalLink,
  type ExternalLinkType,
  type Milestone,
  type ProductImpact,
  type ProductImpactType,
  type ProductService,
  type Theme,
} from './entities.js';
import type { Command, CommandContext, CommandResult, EntityChange } from './command.js';
import {
  archivedChange,
  authorise,
  bumped,
  created,
  domainFail as fail,
  event,
  newEnvelope,
  requireHttps,
  requireName,
  requireText,
  succeed,
  updated,
  type HandlerState,
} from './handler-kit.js';
import { commitmentKey, changeLoadKey, type ProjectionKey } from './refs.js';
import type { EntityId, IsoDate, OwnerRef } from './primitives.js';

/** Extra collections the relation handlers read. */
export type RelationState = HandlerState & {
  readonly products: ReadonlyMap<EntityId, ProductService>;
  readonly impacts: ReadonlyMap<EntityId, ProductImpact>;
  readonly dependencies: ReadonlyMap<EntityId, Dependency>;
  readonly decisions: ReadonlyMap<EntityId, Decision>;
  readonly milestones: ReadonlyMap<EntityId, Milestone>;
  readonly themes: ReadonlyMap<EntityId, Theme>;
  readonly commitmentThemes: ReadonlyMap<EntityId, CommitmentTheme>;
  readonly links: ReadonlyMap<EntityId, ExternalLink>;
};

// ── Products ───────────────────────────────────────────────────────────────

export function createProductService(
  state: RelationState,
  payload: { name: string; description?: string },
  cmd: Command,
  ctx: CommandContext,
): CommandResult {
  const unauthorised = authorise(ctx, 'PLANNER');
  if (unauthorised) return unauthorised;

  const nameError = requireName(payload.name, 80);
  if (nameError) return nameError;

  const name = payload.name.trim();
  const clash = [...state.products.values()].some(
    (p) => isActive(p) && p.name.toLowerCase() === name.toLowerCase(),
  );
  if (clash) return fail('DUPLICATE_NAME', { params: { name } });

  const product: ProductService = {
    ...newEnvelope(ctx.ids.next(), cmd, ctx),
    name,
    active: true,
    ...(payload.description !== undefined ? { description: payload.description } : {}),
  };

  const ref = { kind: 'PRODUCT_SERVICE', id: product.id } as const;
  return succeed({
    changes: [created(ref, product)],
    events: [event(cmd, ctx, 0, 'PRODUCT_CREATED', [ref], { name })],
    affectedProjections: [],
    inverse: {
      ...cmd,
      id: ctx.ids.next(),
      name: 'ArchiveProductService',
      payload: { productServiceId: product.id },
    },
  });
}

// ── Product impact ─────────────────────────────────────────────────────────

export type SetProductImpactPayload = {
  readonly commitmentId: EntityId;
  readonly productServiceId: EntityId;
  readonly type: ProductImpactType;
  readonly note?: string;
};

/**
 * Upsert. A commitment may have at most one `PRIMARY` impact — that is the
 * focal point of the change, and two focal points means neither is one.
 */
export function setProductImpact(
  state: RelationState,
  payload: SetProductImpactPayload,
  cmd: Command,
  ctx: CommandContext,
): CommandResult {
  const unauthorised = authorise(ctx, 'CONTRIBUTOR');
  if (unauthorised) return unauthorised;

  const commitment = state.commitments.get(payload.commitmentId);
  if (!commitment) {
    return fail('ENTITY_NOT_FOUND', {
      entityRef: { kind: 'COMMITMENT', id: payload.commitmentId },
    });
  }
  const product = state.products.get(payload.productServiceId);
  if (!product) {
    return fail('ENTITY_NOT_FOUND', {
      entityRef: { kind: 'PRODUCT_SERVICE', id: payload.productServiceId },
    });
  }

  const noteError = requireText(payload.note, 280);
  if (noteError) return noteError;

  const own = [...state.impacts.values()].filter(
    (i) => i.commitmentId === payload.commitmentId && isActive(i),
  );

  if (payload.type === 'PRIMARY') {
    const otherPrimary = own.find(
      (i) => i.type === 'PRIMARY' && i.productServiceId !== payload.productServiceId,
    );
    if (otherPrimary) {
      const existing = state.products.get(otherPrimary.productServiceId);
      return fail('MULTIPLE_PRIMARY_IMPACTS', {
        entityRef: { kind: 'PRODUCT_IMPACT', id: otherPrimary.id },
        params: { existing: existing?.name ?? otherPrimary.productServiceId },
      });
    }
  }

  const existing = own.find((i) => i.productServiceId === payload.productServiceId);
  const projections: ProjectionKey[] = [commitmentKey(commitment.id)];
  if (commitment.targetQuarterId) {
    projections.push(changeLoadKey(product.id, commitment.targetQuarterId));
  }

  if (existing) {
    if (existing.type === payload.type && existing.note === payload.note) {
      return succeed({ changes: [], events: [], affectedProjections: [] });
    }
    const after = bumped(
      {
        ...existing,
        type: payload.type,
        ...(payload.note !== undefined ? { note: payload.note } : {}),
      },
      ctx,
    );
    const ref = { kind: 'PRODUCT_IMPACT', id: existing.id } as const;
    return succeed({
      changes: [updated(ref, existing, after)],
      events: [
        event(cmd, ctx, 0, 'PRODUCT_IMPACT_RETYPED', [ref], {
          commitment: commitment.name,
          product: product.name,
          from: existing.type,
          to: payload.type,
        }),
      ],
      affectedProjections: projections,
      inverse: {
        ...cmd,
        id: ctx.ids.next(),
        name: 'SetProductImpact',
        payload: {
          commitmentId: commitment.id,
          productServiceId: product.id,
          type: existing.type,
        },
      },
    });
  }

  const impact: ProductImpact = {
    ...newEnvelope(ctx.ids.next(), cmd, ctx),
    commitmentId: commitment.id,
    productServiceId: product.id,
    type: payload.type,
    ...(payload.note !== undefined ? { note: payload.note } : {}),
  };

  const ref = { kind: 'PRODUCT_IMPACT', id: impact.id } as const;
  return succeed({
    changes: [created(ref, impact)],
    events: [
      event(cmd, ctx, 0, 'PRODUCT_IMPACT_ADDED', [ref], {
        commitment: commitment.name,
        product: product.name,
        type: payload.type,
      }),
    ],
    affectedProjections: projections,
    inverse: {
      ...cmd,
      id: ctx.ids.next(),
      name: 'RemoveProductImpact',
      payload: { impactId: impact.id },
    },
  });
}

export function removeProductImpact(
  state: RelationState,
  payload: { impactId: EntityId },
  cmd: Command,
  ctx: CommandContext,
): CommandResult {
  const unauthorised = authorise(ctx, 'CONTRIBUTOR');
  if (unauthorised) return unauthorised;

  const impact = state.impacts.get(payload.impactId);
  if (!impact) {
    return fail('ENTITY_NOT_FOUND', {
      entityRef: { kind: 'PRODUCT_IMPACT', id: payload.impactId },
    });
  }
  if (!isActive(impact)) return succeed({ changes: [], events: [], affectedProjections: [] });

  const after = bumped({ ...impact, archivedAt: ctx.clock.now(), archivedBy: ctx.actorId }, ctx);
  const ref = { kind: 'PRODUCT_IMPACT', id: impact.id } as const;

  return succeed({
    changes: [archivedChange(ref, impact, after)],
    events: [event(cmd, ctx, 0, 'PRODUCT_IMPACT_REMOVED', [ref], { type: impact.type })],
    affectedProjections: [commitmentKey(impact.commitmentId)],
  });
}

// ── Dependencies ───────────────────────────────────────────────────────────

export type AddDependencyPayload = {
  readonly sourceCommitmentId: EntityId;
  readonly target: DependencyTarget;
  /** Visual creation defaults to REQUIRES; the type is refined later. */
  readonly type?: DependencyType;
  readonly ownerRef?: OwnerRef;
  readonly neededBy?: IsoDate;
  readonly note?: string;
};

export function addDependency(
  state: RelationState,
  payload: AddDependencyPayload,
  cmd: Command,
  ctx: CommandContext,
): CommandResult {
  const unauthorised = authorise(ctx, 'CONTRIBUTOR');
  if (unauthorised) return unauthorised;

  const source = state.commitments.get(payload.sourceCommitmentId);
  if (!source) {
    return fail('ENTITY_NOT_FOUND', {
      entityRef: { kind: 'COMMITMENT', id: payload.sourceCommitmentId },
    });
  }

  if (payload.target.kind === 'COMMITMENT' && payload.target.id === source.id) {
    return fail('SELF_DEPENDENCY', { entityRef: { kind: 'COMMITMENT', id: source.id } });
  }

  const targetExists = resolveTargetExists(state, payload.target);
  if (!targetExists) {
    return fail('ENTITY_NOT_FOUND', {
      entityRef: { kind: payload.target.kind, id: payload.target.id },
    });
  }

  const type = payload.type ?? 'REQUIRES';
  const duplicate = [...state.dependencies.values()].find(
    (d) =>
      isActive(d) &&
      d.sourceCommitmentId === source.id &&
      d.target.kind === payload.target.kind &&
      d.target.id === payload.target.id &&
      d.type === type,
  );
  if (duplicate) {
    return fail('DUPLICATE_DEPENDENCY', { entityRef: { kind: 'DEPENDENCY', id: duplicate.id } });
  }

  const noteError = requireText(payload.note, 280);
  if (noteError) return noteError;

  const dependency: Dependency = {
    ...newEnvelope(ctx.ids.next(), cmd, ctx),
    sourceCommitmentId: source.id,
    target: payload.target,
    type,
    status: 'OPEN',
    isHard: HARD_BY_DEFAULT.includes(type),
    ...(payload.ownerRef !== undefined ? { ownerRef: payload.ownerRef } : {}),
    ...(payload.neededBy !== undefined ? { neededBy: payload.neededBy } : {}),
    ...(payload.note !== undefined ? { note: payload.note } : {}),
  };

  const ref = { kind: 'DEPENDENCY', id: dependency.id } as const;
  return succeed({
    changes: [created(ref, dependency)],
    events: [
      event(cmd, ctx, 0, 'DEPENDENCY_ADDED', [ref], {
        source: source.name,
        targetKind: payload.target.kind,
        type,
      }),
    ],
    // Cycles are permitted and warned about, never blocked — so the graph
    // projection is always invalidated, never rejected.
    affectedProjections: ['dependencyGraph', commitmentKey(source.id)],
    inverse: {
      ...cmd,
      id: ctx.ids.next(),
      name: 'RemoveDependency',
      payload: { dependencyId: dependency.id },
    },
  });
}

function resolveTargetExists(state: RelationState, target: DependencyTarget): boolean {
  switch (target.kind) {
    case 'COMMITMENT':
      return state.commitments.has(target.id);
    case 'TEAM':
      return state.teams.has(target.id);
    case 'DECISION':
      return state.decisions.has(target.id);
    case 'MILESTONE':
      return state.milestones.has(target.id);
  }
}

export type UpdateDependencyPayload = {
  readonly dependencyId: EntityId;
  readonly type?: DependencyType;
  readonly target?: DependencyTarget;
  readonly ownerRef?: OwnerRef;
  readonly neededBy?: IsoDate;
  readonly status?: DependencyStatus;
  readonly note?: string;
};

export function updateDependency(
  state: RelationState,
  payload: UpdateDependencyPayload,
  cmd: Command,
  ctx: CommandContext,
): CommandResult {
  const unauthorised = authorise(ctx, 'CONTRIBUTOR');
  if (unauthorised) return unauthorised;

  const dependency = state.dependencies.get(payload.dependencyId);
  if (!dependency || !isActive(dependency)) {
    return fail('ENTITY_NOT_FOUND', {
      entityRef: { kind: 'DEPENDENCY', id: payload.dependencyId },
    });
  }

  if (payload.target) {
    if (
      payload.target.kind === 'COMMITMENT' &&
      payload.target.id === dependency.sourceCommitmentId
    ) {
      return fail('SELF_DEPENDENCY');
    }
    if (!resolveTargetExists(state, payload.target)) {
      return fail('ENTITY_NOT_FOUND', {
        entityRef: { kind: payload.target.kind, id: payload.target.id },
      });
    }
  }

  const noteError = requireText(payload.note, 280);
  if (noteError) return noteError;

  const next: Dependency = {
    ...dependency,
    ...(payload.type !== undefined
      ? { type: payload.type, isHard: HARD_BY_DEFAULT.includes(payload.type) }
      : {}),
    ...(payload.target !== undefined ? { target: payload.target } : {}),
    ...(payload.ownerRef !== undefined ? { ownerRef: payload.ownerRef } : {}),
    ...(payload.neededBy !== undefined ? { neededBy: payload.neededBy } : {}),
    ...(payload.status !== undefined ? { status: payload.status } : {}),
    ...(payload.note !== undefined ? { note: payload.note } : {}),
  };

  const after = bumped(next, ctx);
  const ref = { kind: 'DEPENDENCY', id: dependency.id } as const;
  const change = updated(ref, dependency, after);
  if (change.changedFields.length === 0) {
    return succeed({ changes: [], events: [], affectedProjections: [] });
  }

  return succeed({
    changes: [change],
    events: [
      event(cmd, ctx, 0, 'DEPENDENCY_UPDATED', [ref], {
        fields: change.changedFields.join(', '),
        status: after.status,
      }),
    ],
    affectedProjections: ['dependencyGraph', commitmentKey(dependency.sourceCommitmentId)],
    inverse: {
      ...cmd,
      id: ctx.ids.next(),
      name: 'UpdateDependency',
      payload: {
        dependencyId: dependency.id,
        type: dependency.type,
        target: dependency.target,
        status: dependency.status,
        ...(dependency.ownerRef !== undefined ? { ownerRef: dependency.ownerRef } : {}),
        ...(dependency.neededBy !== undefined ? { neededBy: dependency.neededBy } : {}),
      },
    },
  });
}

export function removeDependency(
  state: RelationState,
  payload: { dependencyId: EntityId },
  cmd: Command,
  ctx: CommandContext,
): CommandResult {
  const unauthorised = authorise(ctx, 'CONTRIBUTOR');
  if (unauthorised) return unauthorised;

  const dependency = state.dependencies.get(payload.dependencyId);
  if (!dependency) {
    return fail('ENTITY_NOT_FOUND', {
      entityRef: { kind: 'DEPENDENCY', id: payload.dependencyId },
    });
  }
  if (!isActive(dependency)) return succeed({ changes: [], events: [], affectedProjections: [] });

  const after = bumped(
    { ...dependency, archivedAt: ctx.clock.now(), archivedBy: ctx.actorId },
    ctx,
  );
  const ref = { kind: 'DEPENDENCY', id: dependency.id } as const;

  return succeed({
    changes: [archivedChange(ref, dependency, after)],
    events: [event(cmd, ctx, 0, 'DEPENDENCY_REMOVED', [ref], { type: dependency.type })],
    affectedProjections: ['dependencyGraph', commitmentKey(dependency.sourceCommitmentId)],
  });
}

// ── Decisions ──────────────────────────────────────────────────────────────

export function createDecision(
  // Signature kept uniform with every other relation handler so the command
  // dispatcher can treat them identically.
  _state: RelationState,
  payload: {
    name: string;
    kind?: 'DECISION' | 'APPROVAL';
    ownerRef?: OwnerRef;
    neededBy?: IsoDate;
  },
  cmd: Command,
  ctx: CommandContext,
): CommandResult {
  const unauthorised = authorise(ctx, 'CONTRIBUTOR');
  if (unauthorised) return unauthorised;

  const nameError = requireName(payload.name, 140);
  if (nameError) return nameError;

  const decision: Decision = {
    ...newEnvelope(ctx.ids.next(), cmd, ctx),
    kind: payload.kind ?? 'DECISION',
    name: payload.name.trim(),
    status: 'OPEN',
    ...(payload.ownerRef !== undefined ? { ownerRef: payload.ownerRef } : {}),
    ...(payload.neededBy !== undefined ? { neededBy: payload.neededBy } : {}),
  };

  const ref = { kind: 'DECISION', id: decision.id } as const;
  return succeed({
    changes: [created(ref, decision)],
    events: [event(cmd, ctx, 0, 'DECISION_CREATED', [ref], { name: decision.name })],
    affectedProjections: ['dependencyGraph'],
    inverse: {
      ...cmd,
      id: ctx.ids.next(),
      name: 'ArchiveDecision',
      payload: { decisionId: decision.id },
    },
  });
}

export function updateDecision(
  state: RelationState,
  payload: {
    decisionId: EntityId;
    ownerRef?: OwnerRef;
    neededBy?: IsoDate;
    status?: DependencyStatus;
    resolutionNote?: string;
  },
  cmd: Command,
  ctx: CommandContext,
): CommandResult {
  const unauthorised = authorise(ctx, 'CONTRIBUTOR');
  if (unauthorised) return unauthorised;

  const decision = state.decisions.get(payload.decisionId);
  if (!decision || !isActive(decision)) {
    return fail('ENTITY_NOT_FOUND', { entityRef: { kind: 'DECISION', id: payload.decisionId } });
  }

  const noteError = requireText(payload.resolutionNote, 280);
  if (noteError) return noteError;

  const resolving = payload.status === 'RESOLVED' && decision.status !== 'RESOLVED';
  const next: Decision = {
    ...decision,
    ...(payload.ownerRef !== undefined ? { ownerRef: payload.ownerRef } : {}),
    ...(payload.neededBy !== undefined ? { neededBy: payload.neededBy } : {}),
    ...(payload.status !== undefined ? { status: payload.status } : {}),
    ...(payload.resolutionNote !== undefined ? { resolutionNote: payload.resolutionNote } : {}),
    ...(resolving ? { resolvedAt: ctx.clock.now() } : {}),
  };

  const after = bumped(next, ctx);
  const ref = { kind: 'DECISION', id: decision.id } as const;
  const change = updated(ref, decision, after);
  if (change.changedFields.length === 0) {
    return succeed({ changes: [], events: [], affectedProjections: [] });
  }

  // Resolving a decision resolves nothing else automatically — the dependencies
  // waiting on it stay open until someone says otherwise, and Radar surfaces
  // that they can now move.
  return succeed({
    changes: [change],
    events: [
      event(cmd, ctx, 0, resolving ? 'DECISION_RESOLVED' : 'DECISION_UPDATED', [ref], {
        name: decision.name,
        status: after.status,
      }),
    ],
    affectedProjections: ['dependencyGraph'],
  });
}

// ── Milestones ─────────────────────────────────────────────────────────────

export function addMilestone(
  state: RelationState,
  payload: { commitmentId: EntityId; name: string; targetDate?: IsoDate; note?: string },
  cmd: Command,
  ctx: CommandContext,
): CommandResult {
  const unauthorised = authorise(ctx, 'CONTRIBUTOR');
  if (unauthorised) return unauthorised;

  const commitment = state.commitments.get(payload.commitmentId);
  if (!commitment) {
    return fail('ENTITY_NOT_FOUND', {
      entityRef: { kind: 'COMMITMENT', id: payload.commitmentId },
    });
  }

  const nameError = requireName(payload.name, 100);
  if (nameError) return nameError;
  const noteError = requireText(payload.note, 280);
  if (noteError) return noteError;

  const own = [...state.milestones.values()].filter(
    (m) => m.commitmentId === commitment.id && isActive(m),
  );
  const max = state.workspace.settings.milestonesPerCommitment;
  if (own.length >= max) {
    return fail('TOO_MANY_MILESTONES', { params: { max, actual: own.length } });
  }

  const milestone: Milestone = {
    ...newEnvelope(ctx.ids.next(), cmd, ctx),
    commitmentId: commitment.id,
    name: payload.name.trim(),
    status: 'PLANNED',
    displayOrder: own.length,
    ...(payload.targetDate !== undefined ? { targetDate: payload.targetDate } : {}),
    ...(payload.note !== undefined ? { note: payload.note } : {}),
  };

  const ref = { kind: 'MILESTONE', id: milestone.id } as const;
  return succeed({
    changes: [created(ref, milestone)],
    events: [
      event(cmd, ctx, 0, 'MILESTONE_ADDED', [ref], {
        commitment: commitment.name,
        name: milestone.name,
      }),
    ],
    affectedProjections: [commitmentKey(commitment.id)],
    inverse: {
      ...cmd,
      id: ctx.ids.next(),
      name: 'RemoveMilestone',
      payload: { milestoneId: milestone.id },
    },
  });
}

export function updateMilestone(
  state: RelationState,
  payload: {
    milestoneId: EntityId;
    name?: string;
    targetDate?: IsoDate;
    status?: Milestone['status'];
    note?: string;
  },
  cmd: Command,
  ctx: CommandContext,
): CommandResult {
  const unauthorised = authorise(ctx, 'CONTRIBUTOR');
  if (unauthorised) return unauthorised;

  const milestone = state.milestones.get(payload.milestoneId);
  if (!milestone || !isActive(milestone)) {
    return fail('ENTITY_NOT_FOUND', { entityRef: { kind: 'MILESTONE', id: payload.milestoneId } });
  }

  if (payload.name !== undefined) {
    const nameError = requireName(payload.name, 100);
    if (nameError) return nameError;
  }

  const next: Milestone = {
    ...milestone,
    ...(payload.name !== undefined ? { name: payload.name.trim() } : {}),
    ...(payload.targetDate !== undefined ? { targetDate: payload.targetDate } : {}),
    ...(payload.status !== undefined ? { status: payload.status } : {}),
    ...(payload.note !== undefined ? { note: payload.note } : {}),
  };

  const after = bumped(next, ctx);
  const ref = { kind: 'MILESTONE', id: milestone.id } as const;
  const change = updated(ref, milestone, after);
  if (change.changedFields.length === 0) {
    return succeed({ changes: [], events: [], affectedProjections: [] });
  }

  return succeed({
    changes: [change],
    events: [
      event(cmd, ctx, 0, 'MILESTONE_UPDATED', [ref], {
        name: after.name,
        status: after.status,
      }),
    ],
    affectedProjections: [commitmentKey(milestone.commitmentId)],
  });
}

export function removeMilestone(
  state: RelationState,
  payload: { milestoneId: EntityId },
  cmd: Command,
  ctx: CommandContext,
): CommandResult {
  const unauthorised = authorise(ctx, 'CONTRIBUTOR');
  if (unauthorised) return unauthorised;

  const milestone = state.milestones.get(payload.milestoneId);
  if (!milestone) {
    return fail('ENTITY_NOT_FOUND', { entityRef: { kind: 'MILESTONE', id: payload.milestoneId } });
  }
  if (!isActive(milestone)) return succeed({ changes: [], events: [], affectedProjections: [] });

  const after = bumped({ ...milestone, archivedAt: ctx.clock.now(), archivedBy: ctx.actorId }, ctx);
  const ref = { kind: 'MILESTONE', id: milestone.id } as const;

  return succeed({
    changes: [archivedChange(ref, milestone, after)],
    events: [event(cmd, ctx, 0, 'MILESTONE_REMOVED', [ref], { name: milestone.name })],
    affectedProjections: [commitmentKey(milestone.commitmentId)],
  });
}

// ── Themes ─────────────────────────────────────────────────────────────────

export function createTheme(
  state: RelationState,
  payload: { name: string; colorToken?: string },
  cmd: Command,
  ctx: CommandContext,
): CommandResult {
  // Themes are a workspace taxonomy, so creating one is a Planner action even
  // though assigning them is not.
  const unauthorised = authorise(ctx, 'PLANNER');
  if (unauthorised) return unauthorised;

  const nameError = requireName(payload.name, 60);
  if (nameError) return nameError;

  const name = payload.name.trim();
  const clash = [...state.themes.values()].some(
    (t) => isActive(t) && t.name.toLowerCase() === name.toLowerCase(),
  );
  if (clash) return fail('DUPLICATE_NAME', { params: { name } });

  const theme: Theme = {
    ...newEnvelope(ctx.ids.next(), cmd, ctx),
    name,
    ...(payload.colorToken !== undefined ? { colorToken: payload.colorToken } : {}),
  };

  const ref = { kind: 'THEME', id: theme.id } as const;
  return succeed({
    changes: [created(ref, theme)],
    events: [event(cmd, ctx, 0, 'THEME_CREATED', [ref], { name })],
    affectedProjections: [],
  });
}

/**
 * Replaces a commitment's whole theme set.
 *
 * A full-set replace rather than add/remove pairs because that is how the
 * property sheet is used — you tick the labels that apply and the result is the
 * answer — and because two half-applied commands can leave a commitment briefly
 * carrying a theme nobody chose.
 *
 * A theme that was removed and put back reuses its archived join row rather than
 * minting a second one, so undo and redo land on the same entity instead of
 * accumulating look-alikes.
 */
export function setCommitmentThemes(
  state: RelationState,
  payload: { commitmentId: EntityId; themeIds: readonly EntityId[] },
  cmd: Command,
  ctx: CommandContext,
): CommandResult {
  const unauthorised = authorise(ctx, 'CONTRIBUTOR');
  if (unauthorised) return unauthorised;

  const commitment = state.commitments.get(payload.commitmentId);
  if (!commitment) {
    return fail('ENTITY_NOT_FOUND', {
      entityRef: { kind: 'COMMITMENT', id: payload.commitmentId },
    });
  }
  if (!isActive(commitment)) return fail('ENTITY_ARCHIVED', { params: { name: commitment.name } });

  const wanted = new Set(payload.themeIds);
  for (const themeId of wanted) {
    const theme = state.themes.get(themeId);
    if (!theme) return fail('ENTITY_NOT_FOUND', { entityRef: { kind: 'THEME', id: themeId } });
    if (!isActive(theme)) return fail('ENTITY_ARCHIVED', { params: { name: theme.name } });
  }

  const own = [...state.commitmentThemes.values()].filter(
    (join) => join.commitmentId === commitment.id,
  );
  const before = own.filter(isActive).map((join) => join.themeId);

  const changes: EntityChange[] = [];

  // Gone: archive the join, never the theme.
  for (const join of own) {
    if (!isActive(join) || wanted.has(join.themeId)) continue;
    changes.push(
      archivedChange(
        { kind: 'COMMITMENT_THEME', id: join.id },
        join,
        bumped({ ...join, archivedAt: ctx.clock.now(), archivedBy: ctx.actorId }, ctx),
      ),
    );
  }

  // Added: restore the row this commitment used to carry, or make one.
  for (const themeId of wanted) {
    const existing = own.find((join) => join.themeId === themeId);
    if (existing && isActive(existing)) continue;

    if (existing) {
      const { archivedAt: _at, archivedBy: _by, ...live } = existing;
      changes.push({
        ...updated(
          { kind: 'COMMITMENT_THEME', id: existing.id },
          existing,
          bumped(live as CommitmentTheme, ctx),
        ),
        op: 'RESTORE',
      });
      continue;
    }

    const join: CommitmentTheme = {
      ...newEnvelope(ctx.ids.next(), cmd, ctx),
      commitmentId: commitment.id,
      themeId,
    };
    changes.push(created({ kind: 'COMMITMENT_THEME', id: join.id }, join));
  }

  if (changes.length === 0) {
    return succeed({ changes: [], events: [], affectedProjections: [] });
  }

  const ref = { kind: 'COMMITMENT', id: commitment.id } as const;
  return succeed({
    changes,
    events: [
      event(cmd, ctx, 0, 'COMMITMENT_THEMES_SET', [ref], {
        commitment: commitment.name,
        count: wanted.size,
        themes: [...wanted].map((themeId) => state.themes.get(themeId)?.name ?? themeId).join(', '),
      }),
    ],
    affectedProjections: [commitmentKey(commitment.id)],
    inverse: {
      ...cmd,
      id: ctx.ids.next(),
      name: 'SetCommitmentThemes',
      payload: { commitmentId: commitment.id, themeIds: before },
    },
  });
}

// ── External links ─────────────────────────────────────────────────────────

export function addExternalLink(
  state: RelationState,
  payload: { commitmentId: EntityId; type: ExternalLinkType; url: string; label?: string },
  cmd: Command,
  ctx: CommandContext,
): CommandResult {
  const unauthorised = authorise(ctx, 'CONTRIBUTOR');
  if (unauthorised) return unauthorised;

  const commitment = state.commitments.get(payload.commitmentId);
  if (!commitment) {
    return fail('ENTITY_NOT_FOUND', {
      entityRef: { kind: 'COMMITMENT', id: payload.commitmentId },
    });
  }

  // Enterprise systems are referenced, never embedded — and never over http.
  const urlError = requireHttps(payload.url);
  if (urlError) return urlError;

  const labelError = requireText(payload.label, 80, 'NAME_TOO_LONG');
  if (labelError) return labelError;

  const link: ExternalLink = {
    ...newEnvelope(ctx.ids.next(), cmd, ctx),
    commitmentId: commitment.id,
    type: payload.type,
    url: payload.url,
    ...(payload.label !== undefined ? { label: payload.label } : {}),
  };

  const ref = { kind: 'EXTERNAL_LINK', id: link.id } as const;
  return succeed({
    changes: [created(ref, link)],
    events: [event(cmd, ctx, 0, 'LINK_ADDED', [ref], { type: payload.type })],
    affectedProjections: [commitmentKey(commitment.id)],
    inverse: {
      ...cmd,
      id: ctx.ids.next(),
      name: 'RemoveExternalLink',
      payload: { linkId: link.id },
    },
  });
}

export function removeExternalLink(
  state: RelationState,
  payload: { linkId: EntityId },
  cmd: Command,
  ctx: CommandContext,
): CommandResult {
  const unauthorised = authorise(ctx, 'CONTRIBUTOR');
  if (unauthorised) return unauthorised;

  const link = state.links.get(payload.linkId);
  if (!link) {
    return fail('ENTITY_NOT_FOUND', { entityRef: { kind: 'EXTERNAL_LINK', id: payload.linkId } });
  }
  if (!isActive(link)) return succeed({ changes: [], events: [], affectedProjections: [] });

  const after = bumped({ ...link, archivedAt: ctx.clock.now(), archivedBy: ctx.actorId }, ctx);
  const ref = { kind: 'EXTERNAL_LINK', id: link.id } as const;

  return succeed({
    changes: [archivedChange(ref, link, after)],
    events: [event(cmd, ctx, 0, 'LINK_REMOVED', [ref], { type: link.type })],
    affectedProjections: [commitmentKey(link.commitmentId)],
  });
}
