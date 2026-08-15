/**
 * Calendar quarters. Q1 Jan–Mar, Q2 Apr–Jun, Q3 Jul–Sep, Q4 Oct–Dec.
 *
 * Fiscal and custom quarter calendars are out of scope — see
 * docs/spec/01-domain-model.md §2.
 *
 * Quarters are computed, never stored. Rows carry a QuarterId string; ordering,
 * arithmetic, and horizon windows are all `ordinal` arithmetic, so a quarter
 * boundary is never derived from parsing a label.
 */

import type { IsoDate } from './primitives.js';

export type QuarterNumber = 1 | 2 | 3 | 4;

/** e.g. '2026-Q3'. */
export type QuarterId = `${number}-Q${QuarterNumber}`;

export type Quarter = {
  readonly id: QuarterId;
  readonly year: number;
  readonly quarter: QuarterNumber;
  /** Sole basis for ordering and arithmetic: `year * 4 + (quarter - 1)`. */
  readonly ordinal: number;
  readonly startDate: IsoDate;
  readonly endDate: IsoDate;
};

const QUARTER_ID_PATTERN = /^(\d{4})-Q([1-4])$/;

/** Last day of each quarter. February never ends a quarter, so no leap-year case. */
const QUARTER_END_DAY: Record<QuarterNumber, number> = { 1: 31, 2: 30, 3: 30, 4: 31 };

export class InvalidQuarterIdError extends Error {
  constructor(readonly value: string) {
    super(`Invalid quarter id: '${value}'. Expected 'YYYY-Qn', e.g. '2026-Q3'.`);
    this.name = 'InvalidQuarterIdError';
  }
}

export function isQuarterId(value: unknown): value is QuarterId {
  return typeof value === 'string' && QUARTER_ID_PATTERN.test(value);
}

export function quarterId(year: number, quarter: QuarterNumber): QuarterId {
  return `${year}-Q${quarter}`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function parseQuarterId(value: string): Quarter {
  const match = QUARTER_ID_PATTERN.exec(value);
  if (!match) throw new InvalidQuarterIdError(value);

  const year = Number(match[1]);
  const quarter = Number(match[2]) as QuarterNumber;
  return makeQuarter(year, quarter);
}

export function makeQuarter(year: number, quarter: QuarterNumber): Quarter {
  const startMonth = (quarter - 1) * 3 + 1;
  const endMonth = startMonth + 2;

  return {
    id: quarterId(year, quarter),
    year,
    quarter,
    ordinal: toOrdinal(year, quarter),
    startDate: `${year}-${pad2(startMonth)}-01`,
    endDate: `${year}-${pad2(endMonth)}-${pad2(QUARTER_END_DAY[quarter])}`,
  };
}

export function toOrdinal(year: number, quarter: QuarterNumber): number {
  return year * 4 + (quarter - 1);
}

export function fromOrdinal(ordinal: number): Quarter {
  const year = Math.floor(ordinal / 4);
  const quarter = ((ordinal % 4) + 1) as QuarterNumber;
  return makeQuarter(year, quarter);
}

export function ordinalOf(id: QuarterId): number {
  return parseQuarterId(id).ordinal;
}

/** Quarter containing a calendar date. The date is already timezone-resolved. */
export function quarterOfDate(date: IsoDate): Quarter {
  const [yearPart, monthPart] = date.split('-');
  if (yearPart === undefined || monthPart === undefined) {
    throw new InvalidQuarterIdError(date);
  }
  const year = Number(yearPart);
  const month = Number(monthPart);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new InvalidQuarterIdError(date);
  }
  return makeQuarter(year, (Math.floor((month - 1) / 3) + 1) as QuarterNumber);
}

export function addQuarters(id: QuarterId, delta: number): QuarterId {
  return fromOrdinal(ordinalOf(id) + delta).id;
}

export function nextQuarter(id: QuarterId): QuarterId {
  return addQuarters(id, 1);
}

export function previousQuarter(id: QuarterId): QuarterId {
  return addQuarters(id, -1);
}

/** Negative when `a` is earlier. Suitable directly as an Array#sort comparator. */
export function compareQuarters(a: QuarterId, b: QuarterId): number {
  return ordinalOf(a) - ordinalOf(b);
}

/** Inclusive range, ascending. */
export function quarterRange(from: QuarterId, to: QuarterId): QuarterId[] {
  const start = ordinalOf(from);
  const end = ordinalOf(to);
  if (end < start) return [];
  const out: QuarterId[] = [];
  for (let o = start; o <= end; o += 1) out.push(fromOrdinal(o).id);
  return out;
}

export type HorizonPreset = 'NOW' | 'QBR' | 'HORIZON';

/**
 * Horizon windows are a view concern. They never filter capacity totals —
 * see docs/spec/01-domain-model.md §2.3.
 */
export function horizonWindow(current: QuarterId, preset: HorizonPreset): QuarterId[] {
  switch (preset) {
    case 'NOW':
      return quarterRange(addQuarters(current, -1), addQuarters(current, 1));
    case 'QBR':
      return quarterRange(current, addQuarters(current, 2));
    // 6 quarters == 18 months, starting one before the current quarter.
    case 'HORIZON':
      return quarterRange(addQuarters(current, -1), addQuarters(current, 4));
  }
}
