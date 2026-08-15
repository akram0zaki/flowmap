import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  addQuarters,
  compareQuarters,
  fromOrdinal,
  horizonWindow,
  InvalidQuarterIdError,
  isQuarterId,
  makeQuarter,
  nextQuarter,
  ordinalOf,
  parseQuarterId,
  previousQuarter,
  quarterOfDate,
  quarterRange,
  toOrdinal,
  type QuarterNumber,
} from './quarter.js';

const anyYear = fc.integer({ min: 1975, max: 2075 });
const anyQuarter = fc.constantFrom<QuarterNumber>(1, 2, 3, 4);

describe('quarter boundaries', () => {
  it.each([
    [1, '2026-01-01', '2026-03-31'],
    [2, '2026-04-01', '2026-06-30'],
    [3, '2026-07-01', '2026-09-30'],
    [4, '2026-10-01', '2026-12-31'],
  ] as const)('Q%i spans %s to %s', (q, start, end) => {
    const quarter = makeQuarter(2026, q);
    expect(quarter.startDate).toBe(start);
    expect(quarter.endDate).toBe(end);
  });

  it('is unaffected by leap years, since no quarter ends in February', () => {
    expect(makeQuarter(2024, 1).endDate).toBe('2024-03-31');
    expect(makeQuarter(2025, 1).endDate).toBe('2025-03-31');
  });
});

describe('parsing', () => {
  it('round-trips a valid id', () => {
    expect(parseQuarterId('2026-Q3').id).toBe('2026-Q3');
  });

  it.each(['2026-Q0', '2026-Q5', '26-Q1', '2026Q1', 'Q1-2026', '', 'not-a-quarter'])(
    'rejects %s',
    (bad) => {
      expect(() => parseQuarterId(bad)).toThrow(InvalidQuarterIdError);
      expect(isQuarterId(bad)).toBe(false);
    },
  );
});

describe('date to quarter', () => {
  it.each([
    ['2026-01-01', '2026-Q1'],
    ['2026-03-31', '2026-Q1'],
    ['2026-04-01', '2026-Q2'],
    ['2026-08-15', '2026-Q3'],
    ['2026-09-30', '2026-Q3'],
    ['2026-10-01', '2026-Q4'],
    ['2026-12-31', '2026-Q4'],
  ])('%s falls in %s', (date, expected) => {
    expect(quarterOfDate(date).id).toBe(expected);
  });

  it('rejects an impossible month', () => {
    expect(() => quarterOfDate('2026-13-01')).toThrow(InvalidQuarterIdError);
  });
});

describe('arithmetic', () => {
  it('crosses a year boundary in both directions', () => {
    expect(nextQuarter('2026-Q4')).toBe('2027-Q1');
    expect(previousQuarter('2027-Q1')).toBe('2026-Q4');
  });

  it('orders by ordinal, not by string', () => {
    expect(compareQuarters('2026-Q4', '2027-Q1')).toBeLessThan(0);
    expect(compareQuarters('2027-Q1', '2026-Q4')).toBeGreaterThan(0);
    expect(compareQuarters('2026-Q2', '2026-Q2')).toBe(0);
  });

  it('produces an inclusive ascending range', () => {
    expect(quarterRange('2026-Q3', '2027-Q1')).toEqual(['2026-Q3', '2026-Q4', '2027-Q1']);
  });

  it('produces an empty range when reversed', () => {
    expect(quarterRange('2027-Q1', '2026-Q3')).toEqual([]);
  });
});

describe('horizon windows', () => {
  it('NOW is the current quarter plus one either side', () => {
    expect(horizonWindow('2026-Q3', 'NOW')).toEqual(['2026-Q2', '2026-Q3', '2026-Q4']);
  });

  it('QBR is the current quarter plus the next two', () => {
    expect(horizonWindow('2026-Q3', 'QBR')).toEqual(['2026-Q3', '2026-Q4', '2027-Q1']);
  });

  it('HORIZON is 6 quarters (18 months), starting one before the current', () => {
    const window = horizonWindow('2026-Q3', 'HORIZON');
    expect(window).toHaveLength(6);
    expect(window[0]).toBe('2026-Q2');
    expect(window.at(-1)).toBe('2027-Q3');
  });
});

describe('properties', () => {
  it('ordinal round-trips through fromOrdinal', () => {
    fc.assert(
      fc.property(anyYear, anyQuarter, (year, quarter) => {
        const q = fromOrdinal(toOrdinal(year, quarter));
        expect(q.year).toBe(year);
        expect(q.quarter).toBe(quarter);
      }),
    );
  });

  it('addQuarters is invertible', () => {
    fc.assert(
      fc.property(anyYear, anyQuarter, fc.integer({ min: -40, max: 40 }), (year, q, delta) => {
        const id = makeQuarter(year, q).id;
        expect(addQuarters(addQuarters(id, delta), -delta)).toBe(id);
      }),
    );
  });

  it('ordinal is strictly monotonic in time', () => {
    fc.assert(
      fc.property(anyYear, anyQuarter, fc.integer({ min: 1, max: 40 }), (year, q, delta) => {
        const id = makeQuarter(year, q).id;
        expect(ordinalOf(addQuarters(id, delta))).toBeGreaterThan(ordinalOf(id));
      }),
    );
  });

  it('a quarter always contains its own start and end dates', () => {
    fc.assert(
      fc.property(anyYear, anyQuarter, (year, q) => {
        const quarter = makeQuarter(year, q);
        expect(quarterOfDate(quarter.startDate).id).toBe(quarter.id);
        expect(quarterOfDate(quarter.endDate).id).toBe(quarter.id);
      }),
    );
  });
});
