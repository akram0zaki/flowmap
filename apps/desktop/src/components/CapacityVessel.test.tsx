// @vitest-environment jsdom

/**
 * The vessel's accessibility contract.
 *
 * The board is only usable if every state it draws is also readable — so these
 * tests assert the *text*, not the geometry. A block that renders correctly but
 * announces nothing is not finished.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  summariseCapacity,
  type CapacityFootprint,
  type Commitment,
  type TeamQuarter,
} from '@flowmap/domain';

import { CapacityVessel, type VesselBlock } from './CapacityVessel.jsx';

// Vitest runs without globals, so RTL's automatic cleanup does not engage.
afterEach(cleanup);

const NOW = '2026-08-15T09:00:00Z';
const Q = '2026-Q3' as const;

function env(id: string) {
  return {
    id,
    workspaceId: 'ws',
    schemaVersion: 1,
    entityVersion: 1,
    createdAt: NOW,
    createdBy: 'a',
    updatedAt: NOW,
    updatedBy: 'a',
  };
}

function teamQuarter(over: Partial<TeamQuarter> = {}): TeamQuarter {
  return {
    ...env('tq'),
    teamId: 'team',
    quarterId: Q,
    capacityBaseline: 100,
    capacityAdjustment: 0,
    reserves: [
      { id: 'r1', type: 'BAU_SUPPORT', label: 'BAU & support', amount: 15 },
      { id: 'r2', type: 'REFINEMENT', label: 'Refinement', amount: 5 },
    ],
    ...over,
  };
}

function commitment(id: string, over: Partial<Commitment> = {}): Commitment {
  return {
    ...env(id),
    name: `Commitment ${id}`,
    lifecycle: 'COMMITTED',
    class: 'DISCRETIONARY',
    importance: 'MEDIUM',
    valueDrivers: [],
    ...over,
  };
}

function footprint(
  id: string,
  commitmentId: string,
  units: number,
  over: Partial<CapacityFootprint> = {},
): CapacityFootprint {
  return {
    ...env(id),
    commitmentId,
    teamId: 'team',
    quarterId: Q,
    units,
    unitsSource: 'EXPLICIT',
    isPrimary: false,
    ...over,
  };
}

function renderVessel(blocks: VesselBlock[], tq = teamQuarter(), onSelect?: (id: string) => void) {
  const summary = summariseCapacity({
    teamQuarter: tq,
    footprints: blocks.map((b) => b.footprint),
    commitmentsById: new Map(blocks.map((b) => [b.commitment.id, b.commitment])),
    currentQuarterId: Q,
  });

  return render(
    <CapacityVessel
      teamName="Payments"
      teamQuarter={tq}
      summary={summary}
      blocks={blocks}
      {...(onSelect ? { onSelect } : {})}
    />,
  );
}

const oneBlock: VesselBlock[] = [
  {
    footprint: footprint('f1', 'c1', 35),
    commitment: commitment('c1', { name: 'SEPA instant' }),
    counted: true,
  },
];

describe('accessible summary', () => {
  it('announces team, quarter, utilisation and headroom', () => {
    renderVessel(oneBlock);
    const grid = screen.getByRole('grid');
    const label = grid.getAttribute('aria-label')!;

    expect(label).toContain('Payments');
    expect(label).toContain('2026-Q3');
    expect(label).toContain('44%'); // 35 of 80 deliverable
    expect(label).toContain('45 units headroom');
  });

  it('states over capacity in units, percent and a glyph — never colour alone', () => {
    const blocks: VesselBlock[] = [
      { footprint: footprint('f1', 'c1', 95), commitment: commitment('c1'), counted: true },
    ];
    renderVessel(blocks);

    const label = screen.getByRole('grid').getAttribute('aria-label')!;
    expect(label).toContain('+15 units');
    expect(label).toContain('119%');
    expect(label).toContain('Over capacity');
    expect(label).toContain('▲');
  });

  it('says so plainly when there is no deliverable capacity, rather than dividing by zero', () => {
    const tq = teamQuarter({
      reserves: [{ id: 'r', type: 'OTHER', label: 'All of it', amount: 100 }],
    });
    renderVessel(oneBlock, tq);

    expect(screen.getByRole('grid').getAttribute('aria-label')).toContain(
      'No deliverable capacity',
    );
  });
});

describe('block labels', () => {
  it('carries name, lifecycle and units', () => {
    renderVessel(oneBlock);
    const cell = screen.getByRole('gridcell');
    const label = cell.getAttribute('aria-label')!;

    expect(label).toContain('SEPA instant');
    expect(label).toContain('Committed');
    expect(label).toContain('35 units');
  });

  it('names the mandatory lock rather than relying on the glyph', () => {
    renderVessel([
      {
        footprint: footprint('f1', 'c1', 20),
        commitment: commitment('c1', { class: 'MANDATORY' }),
        counted: true,
      },
    ]);
    expect(screen.getByRole('gridcell').getAttribute('aria-label')).toContain('Mandatory');
  });

  it('names carry-over and its origin quarter', () => {
    renderVessel([
      {
        footprint: footprint('f1', 'c1', 20, { carryOverFromQuarterId: '2026-Q2' }),
        commitment: commitment('c1'),
        counted: true,
      },
    ]);
    expect(screen.getByRole('gridcell').getAttribute('aria-label')).toContain(
      'Carried over from 2026-Q2',
    );
  });

  it('says when a block is present but not consuming capacity', () => {
    renderVessel([
      {
        footprint: footprint('f1', 'c1', 20),
        commitment: commitment('c1', { lifecycle: 'IDEA' }),
        counted: false,
      },
    ]);
    const label = screen.getByRole('gridcell').getAttribute('aria-label')!;
    expect(label).toContain('Idea');
    expect(label).toContain('Not consuming capacity');
  });
});

describe('keyboard', () => {
  it('reaches every block by Tab and selects with Enter', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();

    renderVessel(
      [
        { footprint: footprint('f1', 'c1', 20), commitment: commitment('c1'), counted: true },
        { footprint: footprint('f2', 'c2', 20), commitment: commitment('c2'), counted: true },
      ],
      teamQuarter(),
      onSelect,
    );

    await user.tab();
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith('f1');

    await user.tab();
    await user.keyboard(' ');
    expect(onSelect).toHaveBeenCalledWith('f2');
  });

  it('makes every block focusable', () => {
    renderVessel(oneBlock);
    for (const cell of screen.getAllByRole('gridcell')) {
      expect(cell.getAttribute('tabindex')).toBe('0');
    }
  });
});

describe('reserves', () => {
  it('describes each reserve band with its type, label and units', () => {
    const { container } = renderVessel(oneBlock);
    const titles = [...container.querySelectorAll('title')].map((t) => t.textContent);

    expect(titles.join('\n')).toContain('BAU & support');
    expect(titles.join('\n')).toContain('15 units');
    expect(titles.join('\n')).toContain('Refinement');
  });
});
