import { unzipSync, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import type {
  CapacityFootprint,
  Commitment,
  CommitmentTheme,
  Team,
  Theme,
  WorkspaceState,
} from '@flowmap/domain';

import { roadmapModel, todayOn } from './roadmap.js';
import { roadmapPptx } from './pptx.js';

const NOW = '2026-08-17T10:00:00.000Z';

function env(id: string, createdAt = NOW) {
  return {
    id,
    workspaceId: 'workspace',
    schemaVersion: 1,
    entityVersion: 1,
    createdAt,
    createdBy: 'planner',
    updatedAt: createdAt,
    updatedBy: 'planner',
  };
}

function state(overrides?: {
  themes?: Map<string, Theme>;
  commitmentThemes?: Map<string, CommitmentTheme>;
  commitments?: Map<string, Commitment>;
  footprints?: Map<string, CapacityFootprint>;
}): WorkspaceState {
  const payments: Team = {
    ...env('payments'),
    name: 'Payments',
    defaultQuarterCapacity: 100,
    displayOrder: 0,
    active: true,
  };
  const platform: Team = {
    ...env('platform'),
    name: 'Platform',
    defaultQuarterCapacity: 100,
    displayOrder: 1,
    active: true,
  };
  const ccd2: Commitment = {
    ...env('ccd2'),
    name: 'Comply to the new CCD2 regulation',
    lifecycle: 'COMMITTED',
    class: 'MANDATORY',
    importance: 'HIGH',
    valueDrivers: [],
  };

  return {
    workspace: {
      ...env('workspace'),
      name: 'Portfolio',
      timezone: 'Europe/Amsterdam',
      currentQuarterId: '2026-Q3',
      isSample: false,
      revision: 1,
      settings: {
        capacity: {
          defaultTeamQuarterCapacity: 100,
          sizeMapping: { XS: 5, S: 10, M: 20, L: 35 },
          defaultReserves: [],
        },
        changeLoad: {
          impactBase: { PRIMARY: 3, MAJOR: 2, MINOR: 0.5, DEPENDENCY: 0.25 },
          referenceUnits: 20,
          mandatoryFactor: 1.5,
          thresholdMedium: 6,
          thresholdHigh: 12,
        },
        valueDrivers: [],
        noteMaxLength: 2000,
        milestonesPerCommitment: 6,
      },
    },
    teams: new Map([
      ['payments', payments],
      ['platform', platform],
    ]),
    teamQuarters: new Map(),
    commitments: overrides?.commitments ?? new Map([['ccd2', ccd2]]),
    footprints:
      overrides?.footprints ??
      new Map([
        [
          'fp1',
          {
            ...env('fp1'),
            commitmentId: 'ccd2',
            teamId: 'payments',
            quarterId: '2026-Q3',
            units: 20,
            unitsSource: 'EXPLICIT',
            isPrimary: true,
          } as CapacityFootprint,
        ],
      ]),
    ...(overrides?.themes ? { themes: overrides.themes } : {}),
    ...(overrides?.commitmentThemes ? { commitmentThemes: overrides.commitmentThemes } : {}),
  };
}

describe('roadmap model', () => {
  it('expands the horizon into one column per month, quarter-labelled', () => {
    const model = roadmapModel(state(), '2026-08-17');
    // HORIZON is six quarters, so eighteen months.
    expect(model.months).toHaveLength(18);
    expect(model.months[0]?.quarterId).toBe('2026-Q2');
    expect(model.months[0]?.label).toBe('Apr');
    expect(model.months.filter((m) => m.firstOfQuarter)).toHaveLength(6);
  });

  it('collapses a commitment placed with several teams into one bar', () => {
    const footprints = new Map<string, CapacityFootprint>([
      [
        'a',
        {
          ...env('a'),
          commitmentId: 'ccd2',
          teamId: 'payments',
          quarterId: '2026-Q3',
          units: 10,
          unitsSource: 'EXPLICIT',
          isPrimary: true,
        } as CapacityFootprint,
      ],
      [
        'b',
        {
          ...env('b'),
          commitmentId: 'ccd2',
          teamId: 'platform',
          quarterId: '2026-Q4',
          units: 10,
          unitsSource: 'EXPLICIT',
          isPrimary: false,
        } as CapacityFootprint,
      ],
    ]);
    const model = roadmapModel(state({ footprints }), '2026-08-17');
    const rows = model.bands.flatMap((b) => b.rows);
    expect(rows).toHaveLength(1);
    // Teams are what this view sets aside, but it still says who is carrying it.
    expect(rows[0]?.teams).toEqual(['Payments', 'Platform']);
    // Jul is index 3 (Q2 = Apr,May,Jun), so Q3 starts at 3 and Q4 ends at 8.
    expect(rows[0]?.startIndex).toBe(3);
    expect(rows[0]?.endIndex).toBe(8);
  });

  it('ends a bar on its target date, and marks that the end is a real date', () => {
    const withDate = new Map<string, Commitment>([
      [
        'ccd2',
        {
          ...env('ccd2'),
          name: 'Comply to the new CCD2 regulation',
          lifecycle: 'COMMITTED',
          class: 'MANDATORY',
          importance: 'HIGH',
          valueDrivers: [],
          targetDate: '2026-08-15',
        } as Commitment,
      ],
    ]);
    const model = roadmapModel(state({ commitments: withDate }), '2026-08-17');
    const bar = model.bands.flatMap((b) => b.rows)[0]!;
    expect(bar.exact).toBe(true);
    expect(model.months[bar.endIndex]?.label).toBe('Aug');
    expect(bar.endFraction).toBeCloseTo(15 / 31, 5);
  });

  it('snaps to the quarter close when there is no target date, and says so', () => {
    const bar = roadmapModel(state(), '2026-08-17').bands.flatMap((b) => b.rows)[0]!;
    expect(bar.exact).toBe(false);
    expect(bar.endFraction).toBe(1);
    expect(model_month(roadmapModel(state(), '2026-08-17'), bar.endIndex)).toBe('Sep');
  });

  it('repeats a deliverable under every theme it carries, and collects the rest', () => {
    const themes = new Map<string, Theme>([
      ['t1', { ...env('t1', '2026-01-01T00:00:00.000Z'), name: "Must do's" }],
      ['t2', { ...env('t2', '2026-02-01T00:00:00.000Z'), name: 'Improve CX' }],
    ]);
    const links = new Map<string, CommitmentTheme>([
      ['l1', { ...env('l1'), commitmentId: 'ccd2', themeId: 't1' }],
      ['l2', { ...env('l2'), commitmentId: 'ccd2', themeId: 't2' }],
    ]);
    const model = roadmapModel(state({ themes, commitmentThemes: links }), '2026-08-17');
    expect(model.bands.map((b) => b.theme)).toEqual(["Must do's", 'Improve CX']);
    // One deliverable, two rows: it serves two agendas.
    expect(model.bands.flatMap((b) => b.rows)).toHaveLength(2);
  });

  it('lists untagged work rather than dropping it', () => {
    const themes = new Map<string, Theme>([['t1', { ...env('t1'), name: "Must do's" }]]);
    const model = roadmapModel(state({ themes }), '2026-08-17');
    expect(model.bands.map((b) => b.theme)).toEqual(['Unthemed']);
  });

  it('orders bands by when the theme was defined, not alphabetically', () => {
    const themes = new Map<string, Theme>([
      ['z', { ...env('z', '2026-01-01T00:00:00.000Z'), name: 'Zebra' }],
      ['a', { ...env('a', '2026-05-01T00:00:00.000Z'), name: 'Apple' }],
    ]);
    const links = new Map<string, CommitmentTheme>([
      ['l1', { ...env('l1'), commitmentId: 'ccd2', themeId: 'z' }],
      ['l2', { ...env('l2'), commitmentId: 'ccd2', themeId: 'a' }],
    ]);
    const model = roadmapModel(state({ themes, commitmentThemes: links }), '2026-08-17');
    expect(model.bands.map((b) => b.theme)).toEqual(['Zebra', 'Apple']);
  });
});

function model_month(model: ReturnType<typeof roadmapModel>, index: number): string {
  return model.months[index]?.label ?? '';
}

describe('the today line', () => {
  it('lands in the month it falls in, positioned within it', () => {
    const model = roadmapModel(state(), '2026-08-17');
    expect(model.today).not.toBeNull();
    expect(model.months[model.today!.index]?.label).toBe('Aug');
    expect(model.today!.fraction).toBeCloseTo(16 / 31, 5);
  });

  it('is absent when today falls outside the exported horizon', () => {
    const model = roadmapModel(state(), '2030-01-05');
    expect(model.today).toBeNull();
  });

  it('rejects a date it cannot parse rather than guessing a position', () => {
    expect(todayOn(roadmapModel(state(), '2026-08-17').months, 'not-a-date')).toBeNull();
  });
});

describe('roadmap pptx', () => {
  it('writes a deck a reader can open: every declared part is present', () => {
    const themes = new Map<string, Theme>([['t1', { ...env('t1'), name: "Must do's" }]]);
    const links = new Map<string, CommitmentTheme>([
      ['l1', { ...env('l1'), commitmentId: 'ccd2', themeId: 't1' }],
    ]);
    const bytes = roadmapPptx(
      roadmapModel(state({ themes, commitmentThemes: links }), '2026-08-17'),
    );
    const files = unzipSync(bytes);
    const names = Object.keys(files);

    for (const required of [
      '[Content_Types].xml',
      '_rels/.rels',
      'ppt/presentation.xml',
      'ppt/_rels/presentation.xml.rels',
      'ppt/slideMasters/slideMaster1.xml',
      'ppt/slideLayouts/slideLayout1.xml',
      'ppt/theme/theme1.xml',
      'ppt/slides/slide1.xml',
      'ppt/slides/_rels/slide1.xml.rels',
    ]) {
      expect(names, `missing ${required}`).toContain(required);
    }

    // Every slide the content types declare must actually exist, or PowerPoint
    // refuses the file outright rather than degrading.
    const types = strFromU8(files['[Content_Types].xml']!);
    const declared = [...types.matchAll(/PartName="\/(ppt\/slides\/slide\d+\.xml)"/g)].map(
      (m) => m[1]!,
    );
    expect(declared.length).toBeGreaterThan(0);
    for (const slide of declared) expect(names).toContain(slide);
  });

  it('draws the today line, dashed and red', () => {
    const bytes = roadmapPptx(roadmapModel(state(), '2026-08-17'));
    const slide = strFromU8(unzipSync(bytes)['ppt/slides/slide1.xml']!);
    expect(slide).toContain('D11A2A');
    expect(slide).toContain('<a:prstDash val="dash"/>');
  });

  it('escapes a deliverable name that would otherwise break the XML', () => {
    const commitments = new Map<string, Commitment>([
      [
        'ccd2',
        {
          ...env('ccd2'),
          name: 'Cards <Apply> & "Change" limits',
          lifecycle: 'COMMITTED',
          class: 'MANDATORY',
          importance: 'HIGH',
          valueDrivers: [],
        } as Commitment,
      ],
    ]);
    const bytes = roadmapPptx(roadmapModel(state({ commitments }), '2026-08-17'));
    const slide = strFromU8(unzipSync(bytes)['ppt/slides/slide1.xml']!);
    expect(slide).toContain('Cards &lt;Apply&gt; &amp; &quot;Change&quot; limits');
  });

  it('starts a new slide rather than splitting a theme across two', () => {
    // Enough themes that they cannot share one slide.
    const themes = new Map<string, Theme>();
    const links = new Map<string, CommitmentTheme>();
    const commitments = new Map<string, Commitment>();
    const footprints = new Map<string, CapacityFootprint>();
    for (let t = 0; t < 6; t += 1) {
      themes.set(`t${t}`, {
        ...env(`t${t}`, `2026-01-0${t + 1}T00:00:00.000Z`),
        name: `Theme ${t}`,
      });
      for (let c = 0; c < 5; c += 1) {
        const id = `c${t}-${c}`;
        commitments.set(id, {
          ...env(id),
          name: `Work ${id}`,
          lifecycle: 'COMMITTED',
          class: 'STRATEGIC',
          importance: 'MEDIUM',
          valueDrivers: [],
        } as Commitment);
        footprints.set(`f${id}`, {
          ...env(`f${id}`),
          commitmentId: id,
          teamId: 'payments',
          quarterId: '2026-Q3',
          units: 5,
          unitsSource: 'EXPLICIT',
          isPrimary: true,
        } as CapacityFootprint);
        links.set(`l${id}`, { ...env(`l${id}`), commitmentId: id, themeId: `t${t}` });
      }
    }
    const model = roadmapModel(
      state({ themes, commitmentThemes: links, commitments, footprints }),
      '2026-08-17',
    );
    const files = unzipSync(roadmapPptx(model));
    const slides = Object.keys(files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    expect(slides.length).toBeGreaterThan(1);

    // A theme's name appears on exactly one slide: it was never split.
    for (const band of model.bands) {
      const on = slides.filter((s) => strFromU8(files[s]!).includes(band.theme));
      expect(on, `${band.theme} spans ${on.length} slides`).toHaveLength(1);
    }
  });
});
