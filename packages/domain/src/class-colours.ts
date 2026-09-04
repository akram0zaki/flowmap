/**
 * Choosing which colour each commitment class is drawn in.
 *
 * Colour on the board answers "why does this work exist". Which hue means which
 * class is a house convention rather than a fact about the domain — one
 * portfolio's Mandatory is regulatory work it dreads, another's is the only
 * thing keeping the lights on — so the mapping belongs to the workspace.
 *
 * A fixed palette, not a colour picker. Three reasons, in order of how much
 * they cost to ignore:
 *
 *   1. Every swatch is a contrast-checked pair. A picker lets someone choose a
 *      fill their own block labels cannot be read on, and the person who finds
 *      out is in a meeting.
 *   2. `packages/ui/tokens` is the only place allowed to name a colour value.
 *      A workspace storing `#ff00aa` moves colour authorship into the database
 *      and out of the design system.
 *   3. Swatches are stable names, so a workspace exported today still means
 *      something when the palette is retuned.
 *
 * The chosen swatch is applied by re-pointing the `--class-*` custom properties
 * at the swatch's own tokens, so nothing downstream changes: the board's CSS
 * still reads `--class-mandatory-fill` and does not know it became configurable.
 *
 * Normative source: docs/spec/06-views-interaction.md §12 (contrast) — the
 * mapping itself is workspace metadata, like a saved view.
 */

import type { Command, CommandContext, CommandResult, WorkspaceState } from './command.js';
import type { CommitmentClass } from './entities.js';
import { authorise, bumped, domainFail, event, succeed, updated } from './handler-kit.js';

/**
 * The palette. Deliberately excludes anything that reads as the critical red or
 * the warning amber: a signal colour has to keep meaning "something is wrong",
 * and it cannot if a whole class of work is painted in it.
 */
export const CLASS_SWATCHES = [
  'PLUM',
  'INDIGO',
  'TEAL',
  'SLATE',
  'VIOLET',
  'MOSS',
  'CLAY',
  'STONE',
] as const;

export type ClassSwatch = (typeof CLASS_SWATCHES)[number];

export type ClassColours = Readonly<Record<CommitmentClass, ClassSwatch>>;

/** What a workspace draws with until someone says otherwise. */
export const DEFAULT_CLASS_COLOURS: ClassColours = {
  MANDATORY: 'PLUM',
  STRATEGIC: 'INDIGO',
  OPERATIONAL: 'TEAL',
  DISCRETIONARY: 'STONE',
};

export function classColoursOf(state: WorkspaceState): ClassColours {
  return state.workspace.settings.classColours ?? DEFAULT_CLASS_COLOURS;
}

export type SetClassColoursPayload = {
  readonly colours: ClassColours;
};

function isSwatch(value: string): value is ClassSwatch {
  return (CLASS_SWATCHES as readonly string[]).includes(value);
}

/**
 * Replaces the whole mapping rather than one class at a time.
 *
 * The editor is four selects over one small record, and a reader flipping two
 * classes around each other means one decision, not two — as separate commands
 * it would take two undos to get back, with a state in between that nobody
 * chose where both classes are the same colour.
 */
export function setClassColours(
  state: WorkspaceState,
  payload: SetClassColoursPayload,
  cmd: Command,
  ctx: CommandContext,
): CommandResult {
  const unauthorised = authorise(ctx, 'PLANNER');
  if (unauthorised) return unauthorised;

  const classes: readonly CommitmentClass[] = [
    'MANDATORY',
    'STRATEGIC',
    'OPERATIONAL',
    'DISCRETIONARY',
  ];
  for (const key of classes) {
    const value = payload.colours[key];
    if (typeof value !== 'string' || !isSwatch(value)) {
      return domainFail('INVALID_VALUE', { field: `colours.${key}` });
    }
  }

  const before = classColoursOf(state);
  const colours: ClassColours = {
    MANDATORY: payload.colours.MANDATORY,
    STRATEGIC: payload.colours.STRATEGIC,
    OPERATIONAL: payload.colours.OPERATIONAL,
    DISCRETIONARY: payload.colours.DISCRETIONARY,
  };

  const after = bumped(
    { ...state.workspace, settings: { ...state.workspace.settings, classColours: colours } },
    ctx,
  );
  const ref = { kind: 'WORKSPACE', id: state.workspace.id } as const;
  return succeed({
    changes: [updated(ref, state.workspace, after)],
    events: [event(cmd, ctx, 0, 'CLASS_COLOURS_SET', [ref], {})],
    affectedProjections: [],
    // Settings are as undoable as anything else on the board: someone trying
    // colours out in front of a room needs one key to get back.
    inverse: {
      ...cmd,
      id: ctx.ids.next(),
      name: 'SetClassColours',
      payload: { colours: before },
    },
  });
}
