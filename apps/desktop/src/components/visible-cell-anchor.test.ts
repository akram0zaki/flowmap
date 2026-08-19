// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import { visibleCellAnchor } from './PortfolioMap.jsx';

afterEach(() => {
  document.body.replaceChildren();
});

function cell(teamId: string, quarterId: string, box: DOMRect): HTMLDivElement {
  const node = document.createElement('div');
  node.className = 'fm-grid__cell';
  node.dataset['dropTeam'] = teamId;
  node.dataset['dropQuarter'] = quarterId;
  node.getBoundingClientRect = () => box;
  return node;
}

function rect(x: number, y: number, width: number, height: number): DOMRect {
  return {
    x,
    y,
    width,
    height,
    top: y,
    left: x,
    right: x + width,
    bottom: y + height,
    toJSON: () => ({}),
  };
}

describe('visibleCellAnchor', () => {
  it('picks the on-screen cell closest to the viewport centre', () => {
    const root = document.createElement('div');
    root.append(
      cell('payments', '2026-Q3', rect(0, -200, 100, 80)),
      cell('security', '2026-Q3', rect(100, 200, 100, 80)),
      cell('data', '2026-Q3', rect(100, 900, 100, 80)),
    );
    document.body.append(root);
    expect(visibleCellAnchor(root, { width: 400, height: 400 })).toEqual({
      teamId: 'security',
      quarterId: '2026-Q3',
    });
  });
});
