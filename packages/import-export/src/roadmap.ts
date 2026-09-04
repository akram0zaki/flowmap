/**
 * The roadmap view: deliverables grouped by theme, drawn across a month axis.
 *
 * The Portfolio Map answers "can this team carry this quarter". This answers a
 * different question — "what is the shape of the year, and who is it for" —
 * which is why it drops teams entirely and groups by theme instead. A
 * deliverable placed with three teams is one bar here, not three rows.
 *
 * What this deliberately does not carry, matching the Timeline sheet beside it:
 * no percent complete, no critical path, no dependencies drawn. Flowmap has no
 * progress field, and a number that looks measured and is not is worse in a
 * steering meeting than no number at all.
 *
 * ── Where a bar begins and ends ──────────────────────────────────────────
 * Work is placed per (team, quarter), so the honest resolution of a start is a
 * quarter edge. The end is finer where the data earns it: a commitment with a
 * `targetDate` ends on that date, and one without ends at the close of its last
 * placed quarter. That is a mixed resolution in one picture and worth knowing —
 * `exact` is on the bar so a renderer can mark which ends are real dates.
 *
 * Time is injected. `now` is a parameter rather than a `Date` read, so the same
 * workspace exports byte-identically twice and the today line can be tested.
 */

import {
  horizonWindow,
  isActive,
  makeQuarter,
  ordinalOf,
  parseQuarterId,
  type Commitment,
  type EntityId,
  type IsoDate,
  type QuarterId,
  type WorkspaceState,
} from '@flowmap/domain';

export const ROADMAP_SHEET = 'Roadmap';

/** A column of the axis. Quarter labels sit on the first month of each quarter. */
export type RoadmapMonth = {
  readonly key: string;
  /** Three-letter month, e.g. `Aug`. */
  readonly label: string;
  readonly year: number;
  readonly month: number;
  readonly quarterId: QuarterId;
  readonly firstOfQuarter: boolean;
};

export type RoadmapBar = {
  readonly commitmentId: EntityId;
  readonly name: string;
  readonly lifecycle: Commitment['lifecycle'];
  readonly startIndex: number;
  /** Inclusive index of the month the bar ends in. */
  readonly endIndex: number;
  /**
   * How far into `endIndex` the bar reaches, 0 < f <= 1. A quarter-snapped end
   * is 1 — the whole month. A `targetDate` end is the fraction of that month.
   */
  readonly endFraction: number;
  /** True when the end came from a `targetDate` rather than a quarter edge. */
  readonly exact: boolean;
  /** Every team carrying this work, for the tooltip and the sheet column. */
  readonly teams: readonly string[];
};

export type RoadmapBand = {
  readonly theme: string;
  readonly themeId: EntityId | null;
  readonly colorToken: string | undefined;
  readonly rows: readonly RoadmapBar[];
};

export type RoadmapToday = {
  readonly index: number;
  readonly fraction: number;
};

export type RoadmapModel = {
  readonly title: string;
  readonly caption: string;
  readonly workspace: string;
  readonly months: readonly RoadmapMonth[];
  /** Null when today falls outside the exported horizon. */
  readonly today: RoadmapToday | null;
  readonly bands: readonly RoadmapBand[];
};

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const UNTHEMED = 'Unthemed';

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function partsOf(date: IsoDate): { year: number; month: number; day: number } | null {
  const [y, m, d] = date.split('-');
  if (y === undefined || m === undefined || d === undefined) return null;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

/** Expands the exported quarters into one column per month. */
function axisMonths(quarters: readonly QuarterId[]): RoadmapMonth[] {
  const months: RoadmapMonth[] = [];
  for (const id of quarters) {
    const q = parseQuarterId(id);
    const first = (q.quarter - 1) * 3 + 1;
    for (let offset = 0; offset < 3; offset += 1) {
      const month = first + offset;
      months.push({
        key: `${q.year}-${String(month).padStart(2, '0')}`,
        label: MONTHS[month - 1]!,
        year: q.year,
        month,
        quarterId: id,
        firstOfQuarter: offset === 0,
      });
    }
  }
  return months;
}

function indexOfMonth(months: readonly RoadmapMonth[], year: number, month: number): number {
  return months.findIndex((m) => m.year === year && m.month === month);
}

export function roadmapModel(state: WorkspaceState, now: IsoDate): RoadmapModel {
  const quarters = horizonWindow(state.workspace.currentQuarterId, 'HORIZON');
  const months = axisMonths(quarters);
  const inWindow = new Set<QuarterId>(quarters);

  const teamNameById = new Map([...state.teams.values()].map((team) => [team.id, team.name]));

  // Span each commitment across every quarter it is placed in, for any team.
  // Teams are what this view sets aside, so they collapse into one bar here.
  const spans = new Map<
    EntityId,
    { first: QuarterId; last: QuarterId; teams: Set<string>; commitment: Commitment }
  >();

  for (const footprint of state.footprints.values()) {
    if (!isActive(footprint) || !inWindow.has(footprint.quarterId)) continue;
    const commitment = state.commitments.get(footprint.commitmentId);
    if (!commitment || !isActive(commitment) || commitment.lifecycle === 'DROPPED') continue;

    const found = spans.get(commitment.id);
    const teamName = teamNameById.get(footprint.teamId);
    if (found === undefined) {
      spans.set(commitment.id, {
        first: footprint.quarterId,
        last: footprint.quarterId,
        teams: new Set(teamName === undefined ? [] : [teamName]),
        commitment,
      });
      continue;
    }
    if (ordinalOf(footprint.quarterId) < ordinalOf(found.first)) found.first = footprint.quarterId;
    if (ordinalOf(footprint.quarterId) > ordinalOf(found.last)) found.last = footprint.quarterId;
    if (teamName !== undefined) found.teams.add(teamName);
  }

  const barFor = (span: {
    first: QuarterId;
    last: QuarterId;
    teams: Set<string>;
    commitment: Commitment;
  }): RoadmapBar => {
    const startQ = parseQuarterId(span.first);
    const startIndex = indexOfMonth(months, startQ.year, (startQ.quarter - 1) * 3 + 1);

    const lastQ = makeQuarter(parseQuarterId(span.last).year, parseQuarterId(span.last).quarter);
    const lastMonth = (lastQ.quarter - 1) * 3 + 3;
    let endIndex = indexOfMonth(months, lastQ.year, lastMonth);
    let endFraction = 1;
    let exact = false;

    // A target date is a finer end than the quarter edge, but only where it
    // lands inside the exported window — otherwise it would draw a bar
    // stopping at an axis position that does not mean what it looks like.
    const target = span.commitment.targetDate;
    if (target !== undefined) {
      const parts = partsOf(target);
      if (parts !== null) {
        const at = indexOfMonth(months, parts.year, parts.month);
        if (at >= 0 && at >= startIndex) {
          endIndex = at;
          endFraction = Math.min(1, parts.day / daysInMonth(parts.year, parts.month));
          exact = true;
        }
      }
    }

    return {
      commitmentId: span.commitment.id,
      name: span.commitment.name,
      lifecycle: span.commitment.lifecycle,
      startIndex: Math.max(0, startIndex),
      endIndex: Math.max(startIndex, endIndex),
      endFraction,
      exact,
      teams: [...span.teams].sort((a, b) => a.localeCompare(b)),
    };
  };

  // Themes are many-to-many, so a deliverable in two themes is drawn in both
  // bands. Row count can exceed deliverable count, which is the honest reading
  // of "this work serves two agendas" rather than a duplication bug.
  const themesByCommitment = new Map<EntityId, EntityId[]>();
  for (const link of (state.commitmentThemes ?? new Map()).values()) {
    if (!isActive(link)) continue;
    const list = themesByCommitment.get(link.commitmentId) ?? [];
    list.push(link.themeId);
    themesByCommitment.set(link.commitmentId, list);
  }

  const themes = [...(state.themes ?? new Map()).values()]
    .filter(isActive)
    // Definition order, not alphabetical: someone built "Must do's, Improve CX,
    // Productize" in the order they argue it, and sorting by name destroys that.
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.name.localeCompare(b.name));

  const bands: RoadmapBand[] = [];
  for (const theme of themes) {
    const rows = [...spans.values()]
      .filter((span) => (themesByCommitment.get(span.commitment.id) ?? []).includes(theme.id))
      .map(barFor)
      .sort((a, b) => a.startIndex - b.startIndex || a.name.localeCompare(b.name));
    if (rows.length > 0) {
      bands.push({
        theme: theme.name,
        themeId: theme.id,
        colorToken: theme.colorToken,
        rows,
      });
    }
  }

  const untagged = [...spans.values()]
    .filter((span) => (themesByCommitment.get(span.commitment.id) ?? []).length === 0)
    .map(barFor)
    .sort((a, b) => a.startIndex - b.startIndex || a.name.localeCompare(b.name));
  if (untagged.length > 0) {
    // Untagged work is listed rather than dropped. In a review, silently
    // missing work is the dangerous kind of missing.
    bands.push({ theme: UNTHEMED, themeId: null, colorToken: undefined, rows: untagged });
  }

  return {
    title: 'Roadmap',
    caption:
      'Deliverables by theme across the horizon, teams set aside. Not a Gantt: no percent complete, no critical path. A bar ends on its target date where one is set, otherwise at the close of its last placed quarter.',
    workspace: state.workspace.name,
    months,
    today: todayOn(months, now),
    bands,
  };
}

/** Where the dotted line goes, or null when today is off the exported horizon. */
export function todayOn(months: readonly RoadmapMonth[], now: IsoDate): RoadmapToday | null {
  const parts = partsOf(now);
  if (parts === null) return null;
  const index = indexOfMonth(months, parts.year, parts.month);
  if (index < 0) return null;
  return { index, fraction: (parts.day - 1) / daysInMonth(parts.year, parts.month) };
}
