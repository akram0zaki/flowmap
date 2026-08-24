/**
 * The Ideas / Demand lane.
 *
 * Pinned left, outside the capacity grid. Uncommitted Ideas live only here —
 * they never occupy a team-quarter block before Commit Gate, and the only way
 * one touches the grid is as a marker from a refinement reserve.
 *
 * Because an Idea has no footprint by invariant, it has no size to draw. What it
 * does have is a state of preparation, and that is what the rail reports: a
 * four-step meter for the decisions taken, the outstanding ones named, and the
 * list ordered so the Ideas that could move next sit at the top. An alphabetical
 * list of names would be a directory; this is a queue.
 *
 * See docs/spec/06-views-interaction.md §3.1 and 05-scenarios-qbr.md §8.
 */

import { useEffect, type PointerEvent as ReactPointerEvent } from 'react';
import { READINESS_GAPS, type IdeaModel, type IdeaReadinessMap } from '@flowmap/visual-model';

import { t } from '../i18n/t.js';

export type IdeasLaneProps = {
  readonly ideas: readonly IdeaModel[];
  readonly readiness: IdeaReadinessMap;
  readonly selectedCommitmentId: string | null;
  readonly onSelect: (commitmentId: string) => void;
  /** Pick this Idea up to place it — pointer press, or Space. */
  readonly onPickUp: (commitmentId: string, event?: ReactPointerEvent) => void;
  /** Drop is a decision not to take the work. Delete/Backspace on the Idea is the keyboard path. */
  readonly onDrop: (commitmentId: string) => void;
  readonly draggingCommitmentId: string | null;
  /** Work is being held over the lane: 'ok' to take it off the board, or 'no'. */
  readonly dropState: 'ok' | 'no' | null;
  readonly dropNote: string | null;
  readonly collapsed: boolean;
  readonly onToggleCollapsed: () => void;
  /**
   * Refinement reserves an Idea can be attached to, as `{ reserveId, label }`.
   *
   * The link says a team is shaping this Idea this quarter. It allocates
   * nothing — that is the whole distinction between refining an Idea and
   * committing to it, and it is the only way an uncommitted Idea reaches the
   * grid at all (spec 02 §5.1).
   */
  readonly refinementReserves: ReadonlyArray<{
    readonly reserveId: string;
    readonly teamId: string;
    readonly quarterId: string;
    readonly label: string;
  }>;
  readonly onLinkRefinement: (reserveId: string, commitmentId: string) => void;
  readonly onUnlinkRefinement: (reserveId: string, commitmentId: string) => void;
  /** When Open lands on an Idea, scroll that row into view in the lane. */
  readonly revealCommitmentId?: string | null;
};

/** Ideas that need a decision to be made rank above ones that need a name. */
const IMPORTANCE_ORDER: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

export function IdeasLane({
  ideas,
  readiness,
  selectedCommitmentId,
  onSelect,
  onPickUp,
  onDrop,
  draggingCommitmentId,
  dropState,
  dropNote,
  collapsed,
  onToggleCollapsed,
  refinementReserves,
  onLinkRefinement,
  onUnlinkRefinement,
  revealCommitmentId = null,
}: IdeasLaneProps) {
  useEffect(() => {
    if (!revealCommitmentId) return;
    const idea = document.querySelector<HTMLElement>(
      `[data-idea="${CSS.escape(revealCommitmentId)}"]`,
    );
    if (!idea) return;
    const motion =
      document.documentElement.getAttribute('data-motion') === 'reduced' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth';
    idea.scrollIntoView({ block: 'center', behavior: motion });
  }, [revealCommitmentId]);

  const ready = ideas.filter((idea) => readiness.get(idea.commitmentId)?.readyToPlace).length;

  const ordered = [...ideas].sort((a, b) => {
    const settledA = readiness.get(a.commitmentId)?.settled ?? 0;
    const settledB = readiness.get(b.commitmentId)?.settled ?? 0;
    if (settledA !== settledB) return settledB - settledA;

    const importance =
      (IMPORTANCE_ORDER[a.importance] ?? 3) - (IMPORTANCE_ORDER[b.importance] ?? 3);
    return importance !== 0 ? importance : a.name.localeCompare(b.name);
  });

  return (
    // A drop target as well as a source: the lane is where work comes from and
    // where it goes back to, and both directions are the same gesture.
    <section
      className="fm-ideas"
      aria-label={t('map.ideasLane')}
      data-drop-rail=""
      data-drop={dropState ?? undefined}
      data-collapsed={collapsed || undefined}
    >
      {dropNote !== null && !collapsed && <p className="fm-ideas__drop">{dropNote}</p>}
      <div className="fm-ideas__head">
        {/* 188px of permanent chrome is a lot of a 13" screen, and the lane is
            not always the question. Collapsed it stays a drop target and keeps
            its count — you can still take work off the board onto it. */}
        <button
          type="button"
          className="fm-ideas__toggle"
          aria-expanded={!collapsed}
          aria-label={collapsed ? t('map.ideasExpand') : t('map.ideasCollapse')}
          onClick={onToggleCollapsed}
        >
          {collapsed ? '›' : '‹'}
        </button>
        {!collapsed && <h2>{t('map.ideasLane')}</h2>}
        <span className="fm-ideas__count">{ideas.length}</span>
      </div>

      {collapsed ? null : ideas.length === 0 ? (
        <p className="fm-idea__meta">{t('map.ideasEmpty')}</p>
      ) : (
        <>
          {ready > 0 && <p className="fm-ideas__ready">{t('idea.readyCount', { count: ready })}</p>}
          <p className="fm-ideas__hint">{t('drop.railHint')}</p>
          {/* The board's own gesture, stated where the board's other gestures
              are. A plain drag between rows adds rather than moves, which is
              worth saying once rather than leaving to be discovered. */}
          <p className="fm-ideas__hint">{t('drop.blockHint')}</p>
          <p className="fm-ideas__hint">{t('remove.hint')}</p>

          <ul>
            {ordered.map((idea) => {
              const state = readiness.get(idea.commitmentId);
              const settled = state?.settled ?? 0;
              const readyToPlace = state?.readyToPlace ?? false;

              return (
                <li key={idea.commitmentId}>
                  <button
                    type="button"
                    className="fm-idea"
                    data-idea={idea.commitmentId}
                    data-ready={readyToPlace || undefined}
                    data-importance={idea.importance}
                    data-dragging={draggingCommitmentId === idea.commitmentId || undefined}
                    aria-pressed={selectedCommitmentId === idea.commitmentId}
                    onClick={() => onSelect(idea.commitmentId)}
                    onPointerDown={(event) => onPickUp(idea.commitmentId, event)}
                    onKeyDown={(event) => {
                      // Space picks it up, arrows carry it across the board.
                      // The rail is where demand starts, so the shortest route
                      // from here to a quarter is the one that matters.
                      if (event.key === ' ') {
                        event.preventDefault();
                        onPickUp(idea.commitmentId);
                      } else if (event.key === 'Delete' || event.key === 'Backspace') {
                        event.preventDefault();
                        onDrop(idea.commitmentId);
                      }
                    }}
                  >
                    <span className="fm-idea__name">
                      {idea.commitmentClass === 'MANDATORY' ? '🔒 ' : ''}
                      {idea.name}
                    </span>

                    {/* Four ticks, one per decision. Never colour alone: the
                        count is spelled out in the line underneath. */}
                    <span className="fm-idea__meter" aria-hidden="true" data-settled={settled}>
                      {READINESS_GAPS.map((gap, index) => (
                        <span key={gap} data-on={index < settled || undefined} />
                      ))}
                    </span>

                    <span className="fm-idea__meta">
                      {/* What still has to be decided, named. A bare count would
                          say there is work to do without saying what it is. */}
                      {readyToPlace
                        ? t('idea.readyToPlace')
                        : (state?.gaps ?? [])
                            .slice(0, 3)
                            .map((gap) => t(`idea.gap.${gap}`))
                            .join(', ')}
                      {idea.targetQuarterId !== undefined && ` · ${idea.targetQuarterId}`}
                      {idea.refinementLinks.length > 0 && ` · ${t('map.refinementLinked')}`}
                    </span>
                  </button>

                  <div className="fm-idea__actions">
                    <button
                      type="button"
                      className="fm-quiet"
                      aria-label={t('idea.drop', { name: idea.name })}
                      onClick={() => onDrop(idea.commitmentId)}
                    >
                      {t('action.drop')}
                    </button>
                  </div>

                  {/* Outside the button, not inside it: nesting a select in a
                      button gives a keyboard user something they can reach but
                      cannot operate, and the markup is invalid besides. */}
                  {refinementReserves.length > 0 && (
                    <div className="fm-idea__refine">
                      {idea.refinementLinks.map((link) => {
                        const reserve = refinementReserves.find(
                          (candidate) =>
                            candidate.teamId === link.teamId &&
                            candidate.quarterId === link.quarterId,
                        );
                        if (!reserve) return null;
                        return (
                          <button
                            key={reserve.reserveId}
                            type="button"
                            className="fm-idea__refinetag"
                            aria-label={t('panel.unlinkIdea', { name: reserve.label })}
                            onClick={() => onUnlinkRefinement(reserve.reserveId, idea.commitmentId)}
                          >
                            {reserve.label} ✕
                          </button>
                        );
                      })}

                      <select
                        value=""
                        aria-label={t('panel.linkIdea')}
                        onChange={(event) => {
                          if (event.target.value) {
                            onLinkRefinement(event.target.value, idea.commitmentId);
                          }
                        }}
                      >
                        <option value="">{t('panel.linkIdea')}</option>
                        {refinementReserves
                          .filter(
                            (reserve) =>
                              !idea.refinementLinks.some(
                                (link) =>
                                  link.teamId === reserve.teamId &&
                                  link.quarterId === reserve.quarterId,
                              ),
                          )
                          .map((reserve) => (
                            <option key={reserve.reserveId} value={reserve.reserveId}>
                              {reserve.label}
                            </option>
                          ))}
                      </select>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
