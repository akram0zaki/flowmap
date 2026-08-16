/**
 * Dependencies, drawn on the board.
 *
 * Only for the commitment in focus. Drawing every dependency at once on a dense
 * board is noise, not information — the spec keeps a dedicated Dependency Map
 * (§6) for the whole graph. Here the question is narrower and more useful:
 * *this* work, what does it need, and where does that sit.
 *
 * The grid is DOM, not a canvas, so the connectors are measured from the
 * elements themselves rather than recomputed from the layout model. That means
 * they follow the real thing — scrolled, filtered, zoomed — instead of a second
 * calculation that can disagree with what is on screen.
 *
 * Direction never flips: the arrow always points from the work to what it
 * needs, whatever type the dependency is.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Dependency } from '@flowmap/domain';

import { observeResize } from '../state/observe-resize.js';
import { t } from '../i18n/t.js';

export type DependencyEdge = {
  readonly id: string;
  readonly type: Dependency['type'];
  readonly status: Dependency['status'];
  readonly isHard: boolean;
  /** `${teamId}:${quarterId}` for both ends, or null when it has no place. */
  readonly fromCellKey: string;
  readonly toCellKey: string | null;
  readonly targetName: string;
};

type Line = {
  readonly edge: DependencyEdge;
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
};

export function DependencyLayer({
  edges,
  scrollRef,
}: {
  readonly edges: readonly DependencyEdge[];
  readonly scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [lines, setLines] = useState<readonly Line[]>([]);
  const frame = useRef<number | null>(null);

  const measure = useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller) return setLines([]);

    const origin = scroller.getBoundingClientRect();
    const cellAt = (key: string) => {
      const [teamId, quarterId] = key.split('|');
      return scroller.querySelector<HTMLElement>(
        `[data-drop-team="${teamId}"][data-drop-quarter="${quarterId}"]`,
      );
    };

    const next: Line[] = [];
    for (const edge of edges) {
      if (!edge.toCellKey) continue;
      const from = cellAt(edge.fromCellKey);
      const to = cellAt(edge.toCellKey);
      if (!from || !to) continue;

      const a = from.getBoundingClientRect();
      const b = to.getBoundingClientRect();
      next.push({
        edge,
        x1: a.left - origin.left + scroller.scrollLeft + a.width / 2,
        y1: a.top - origin.top + scroller.scrollTop + a.height / 2,
        x2: b.left - origin.left + scroller.scrollLeft + b.width / 2,
        y2: b.top - origin.top + scroller.scrollTop + b.height / 2,
      });
    }
    setLines(next);
  }, [edges, scrollRef]);

  // Measure after layout, and again whenever the board moves under it.
  useLayoutEffect(measure, [measure]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return undefined;

    const schedule = () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(measure);
    };

    const unobserve = observeResize(scroller, schedule);
    scroller.addEventListener('scroll', schedule);
    window.addEventListener('resize', schedule);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      unobserve();
      scroller.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [measure, scrollRef]);

  if (lines.length === 0) return null;

  return (
    <svg className="fm-deps" aria-hidden="true">
      <defs>
        <marker
          id="fm-dep-arrow"
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 8 4 L 0 8 z" className="fm-deps__head" />
        </marker>
      </defs>

      {lines.map((line) => (
        <g
          key={line.edge.id}
          className="fm-deps__edge"
          data-hard={line.edge.isHard || undefined}
          data-status={line.edge.status}
        >
          {/* A curve, not a straight line: two blocks in the same row would
              otherwise be joined by a segment lying along the row rule. */}
          <path d={curve(line)} className="fm-deps__line" markerEnd="url(#fm-dep-arrow)" />
          <text x={(line.x1 + line.x2) / 2} y={(line.y1 + line.y2) / 2 - 6} textAnchor="middle">
            {t(`dependency.${line.edge.type}`)}
          </text>
        </g>
      ))}
    </svg>
  );
}

function curve({ x1, y1, x2, y2 }: Line): string {
  const lift = Math.min(60, Math.max(24, Math.abs(x2 - x1) / 3));
  return `M ${x1} ${y1} C ${x1} ${y1 - lift}, ${x2} ${y2 - lift}, ${x2} ${y2}`;
}
