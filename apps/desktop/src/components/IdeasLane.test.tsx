// @vitest-environment jsdom

/**
 * Searching the demand lane.
 *
 * The rail orders by preparation so the Ideas that could move next sit at the
 * top, which is the right answer for a queue you read. It is the wrong answer
 * for a queue you scan: past a dozen Ideas, finding the one you mean by eye is
 * the slowest part of placing it.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { IdeaModel, IdeaReadinessMap } from '@flowmap/visual-model';

import { IdeasLane } from './IdeasLane.jsx';

afterEach(cleanup);

function idea(name: string, over: Partial<IdeaModel> = {}): IdeaModel {
  return {
    commitmentId: name.toLowerCase().replace(/\W+/g, '-'),
    name,
    commitmentClass: 'STRATEGIC',
    importance: 'MEDIUM',
    refinementLinks: [],
    ...over,
  };
}

const IDEAS = [
  idea('Boltech Insurance'),
  idea('Limit re-assessment improvement'),
  idea('Consent withdrawal'),
  idea('Digitize Up-downgrade'),
  idea('Request to pay'),
];

function readiness(ideas: readonly IdeaModel[]): IdeaReadinessMap {
  return new Map(
    ideas.map((i) => [
      i.commitmentId,
      { gaps: [], blocking: [], readyToPlace: false, settled: 2, plannedUnits: 0 },
    ]),
  );
}

function lane(over: Partial<Parameters<typeof IdeasLane>[0]> = {}) {
  const props = {
    ideas: IDEAS,
    readiness: readiness(IDEAS),
    selectedCommitmentId: null,
    onSelect: vi.fn(),
    onPickUp: vi.fn(),
    onDrop: vi.fn(),
    draggingCommitmentId: null,
    dropState: null,
    dropNote: null,
    collapsed: false,
    onToggleCollapsed: vi.fn(),
    refinementReserves: [],
    onLinkRefinement: vi.fn(),
    onUnlinkRefinement: vi.fn(),
    ...over,
  };
  render(<IdeasLane {...props} />);
  return props;
}

/** The Idea names currently drawn, in board order. */
function shown(): string[] {
  return screen
    .getAllByRole('button')
    .map((node) => node.querySelector('.fm-idea__name')?.textContent ?? '')
    .filter(Boolean);
}

describe('searching the demand lane', () => {
  it('narrows the list to substring matches as you type', async () => {
    lane();
    expect(shown()).toHaveLength(5);

    await userEvent.type(screen.getByLabelText('Search ideas'), 'consent');
    expect(shown()).toEqual(['Consent withdrawal']);
  });

  // A name you already know, typed the way you remember it. Insisting on the
  // capitals the person who captured it happened to use is a trap.
  it('ignores case on both sides of the match', async () => {
    lane();
    await userEvent.type(screen.getByLabelText('Search ideas'), 'BOLTECH');
    expect(shown()).toEqual(['Boltech Insurance']);
  });

  // Contains, not starts-with: people search for the distinctive word, which is
  // rarely the first one.
  it('matches in the middle of a name, not only at the start', async () => {
    lane();
    await userEvent.type(screen.getByLabelText('Search ideas'), 're-assessment');
    expect(shown()).toEqual(['Limit re-assessment improvement']);
  });

  it('says how much of the queue is on screen', async () => {
    lane();
    await userEvent.type(screen.getByLabelText('Search ideas'), 'e');
    expect(screen.getByRole('status').textContent).toMatch(/of 5 shown/);
  });

  it('names what was searched for when nothing matches', async () => {
    lane();
    await userEvent.type(screen.getByLabelText('Search ideas'), 'nothing here');
    expect(shown()).toEqual([]);
    expect(screen.getByText(/No idea matches/).textContent).toContain('nothing here');
  });

  it('restores the whole queue when the search is cleared', async () => {
    lane();
    const field = screen.getByLabelText('Search ideas');
    await userEvent.type(field, 'consent');
    expect(shown()).toHaveLength(1);

    await userEvent.click(screen.getByLabelText('Clear the search'));
    expect(shown()).toHaveLength(5);
  });

  // Inside a field with text in it, Escape means "clear this" — and it must not
  // bubble, or it cancels a drag or closes a panel on its way past.
  it('clears on Escape without letting the key escape the field', async () => {
    const onEscape = vi.fn();
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onEscape();
    };
    document.addEventListener('keydown', listener);
    lane();

    const field = screen.getByLabelText('Search ideas');
    await userEvent.type(field, 'consent{Escape}');
    expect(shown()).toHaveLength(5);
    expect(onEscape).not.toHaveBeenCalled();

    document.removeEventListener('keydown', listener);
  });

  // The count is the size of the queue, not of the search. A number that shrank
  // as you typed would answer a question nobody asked.
  it('keeps the header count on the whole queue', async () => {
    lane();
    await userEvent.type(screen.getByLabelText('Search ideas'), 'consent');
    expect(document.querySelector('.fm-ideas__count')?.textContent).toBe('5');
  });

  it('offers no search when there is nothing to search', () => {
    lane({ ideas: [], readiness: new Map() });
    expect(screen.queryByLabelText('Search ideas')).toBeNull();
  });

  // Collapsed, the rail is 24px of drop target. There is nothing to scan.
  it('offers no search while the rail is collapsed', () => {
    lane({ collapsed: true });
    expect(screen.queryByLabelText('Search ideas')).toBeNull();
  });
});
