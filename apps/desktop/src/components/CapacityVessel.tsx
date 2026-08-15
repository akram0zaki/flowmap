/**
 * The capacity vessel — the element Flowmap is remembered by.
 *
 * A team-quarter drawn as a measured container: reserves as a hatched plinth
 * holding the work up, committed blocks stacked on top, and overflow spilling
 * *above* the deliverable-capacity rule rather than turning the cell red.
 *
 * Three rules from docs/design/design-system.md §6 are load-bearing:
 *   1. Reserves are a plinth, not a slice — you cannot mistake reserved capacity
 *      for available capacity.
 *   2. Overflow spills above the rule, labelled with units AND percent AND a ▲.
 *   3. The unit scale is always drawn, so a block's height means something
 *      specific rather than "big-ish".
 *
 * Accessibility: the SVG is a `grid` whose cells are the blocks. Every state is
 * carried by pattern + glyph + text, never colour alone, and the whole thing has
 * a list companion that must show identical totals.
 */

import { useId } from 'react';
import type { CapacitySummary, CapacityFootprint, Commitment, TeamQuarter } from '@flowmap/domain';
import { utilisationPercent } from '@flowmap/domain';
import {
  PATTERNS,
  UNIT_PX,
  UNIT_TICK_MAJOR,
  UNIT_TICK_MINOR,
  patternGeometry,
  patternPitch,
} from '@flowmap/ui';

import { t } from '../i18n/t.js';

export type VesselBlock = {
  readonly footprint: CapacityFootprint;
  readonly commitment: Commitment;
  readonly counted: boolean;
};

export type CapacityVesselProps = {
  readonly teamName: string;
  readonly teamQuarter: TeamQuarter;
  readonly summary: CapacitySummary;
  readonly blocks: readonly VesselBlock[];
  readonly zoom?: number;
  readonly selectedFootprintId?: string;
  readonly onSelect?: (footprintId: string) => void;
};

const AXIS_WIDTH = 34;
const BODY_WIDTH = 220;
const TOP_PAD = 28;
const BOTTOM_PAD = 24;

export function CapacityVessel({
  teamName,
  teamQuarter,
  summary,
  blocks,
  zoom = 1,
  selectedFootprintId,
  onSelect,
}: CapacityVesselProps) {
  const patternPrefix = useId().replace(/:/g, '');
  const unitPx = UNIT_PX * zoom;

  // The axis spans the effective capacity, or the load when work overflows past
  // it — otherwise the spill would be drawn outside the viewBox.
  const axisMax = Math.max(
    summary.effectiveCapacity,
    summary.reservedTotal + summary.committedLoad,
  );
  const bodyHeight = axisMax * unitPx;
  const height = bodyHeight + TOP_PAD + BOTTOM_PAD;
  const y = (units: number) => TOP_PAD + bodyHeight - units * unitPx;

  const percent = utilisationPercent(summary);
  const overCapacity = summary.overflow > 0;

  // Stack from the top of the reserve plinth upward.
  let cursor = summary.reservedTotal;
  const laidOut = blocks.map((block) => {
    const bottom = cursor;
    cursor += block.counted ? block.footprint.units : 0;
    return { ...block, bottom, top: bottom + block.footprint.units };
  });

  let reserveCursor = 0;
  const reserveBands = teamQuarter.reserves.map((reserve) => {
    const bottom = reserveCursor;
    reserveCursor += reserve.amount;
    return { reserve, bottom, top: reserveCursor };
  });

  const ticks: number[] = [];
  for (let u = 0; u <= axisMax; u += UNIT_TICK_MINOR) ticks.push(u);

  const summaryLabel = [
    teamName,
    teamQuarter.quarterId,
    percent === null ? t('capacity.noDeliverable') : t('capacity.utilisation', { percent }),
    overCapacity
      ? t('capacity.overCapacity', { units: summary.overflow, percent: percent ?? 0 })
      : t('capacity.headroom', { units: summary.headroom }),
    t('vessel.blockCount', { count: laidOut.length }),
  ].join('. ');

  return (
    <figure className="fm-vessel" data-over-capacity={overCapacity || undefined}>
      <svg
        role="grid"
        aria-label={summaryLabel}
        width={AXIS_WIDTH + BODY_WIDTH}
        height={height}
        viewBox={`0 0 ${AXIS_WIDTH + BODY_WIDTH} ${height}`}
      >
        <defs>
          {Object.values(PATTERNS)
            .filter((spec) => !spec.outlineOnly)
            .map((spec) => {
              const pitch = patternPitch(spec, zoom);
              return (
                <pattern
                  key={spec.id}
                  id={`${patternPrefix}-${spec.id}`}
                  width={pitch}
                  height={pitch}
                  patternUnits="userSpaceOnUse"
                >
                  {patternGeometry(spec.id, pitch).map((d, i) => (
                    <path
                      key={i}
                      d={d}
                      stroke={spec.colorVar}
                      strokeWidth={spec.strokeVar}
                      strokeLinecap={spec.id === 'hold' ? 'round' : 'butt'}
                      {...(spec.dashArray ? { strokeDasharray: spec.dashArray } : {})}
                      fill="none"
                    />
                  ))}
                </pattern>
              );
            })}
        </defs>

        {/* Unit scale — drawn so block heights are measurable, not impressionistic. */}
        <g className="fm-vessel__axis" aria-hidden="true">
          {ticks.map((units) => {
            const major = units % UNIT_TICK_MAJOR === 0;
            return (
              <g key={units}>
                <line
                  x1={AXIS_WIDTH - (major ? 8 : 4)}
                  x2={AXIS_WIDTH}
                  y1={y(units)}
                  y2={y(units)}
                  className={major ? 'fm-tick fm-tick--major' : 'fm-tick'}
                />
                {major && (
                  <text
                    x={AXIS_WIDTH - 11}
                    y={y(units) + 4}
                    className="fm-tick__label"
                    textAnchor="end"
                  >
                    {units}
                  </text>
                )}
              </g>
            );
          })}
        </g>

        <g transform={`translate(${AXIS_WIDTH} 0)`}>
          <rect
            x={0}
            y={TOP_PAD}
            width={BODY_WIDTH}
            height={bodyHeight}
            className="fm-vessel__body"
            rx={2}
          />

          {/* Reserve plinth: at the base, holding everything else up. */}
          {reserveBands.map(({ reserve, bottom, top }) => {
            const spec =
              reserve.type === 'REFINEMENT'
                ? PATTERNS.refinement
                : reserve.type === 'HOLD'
                  ? PATTERNS.hold
                  : PATTERNS.reserve;
            return (
              <g key={reserve.id}>
                <rect
                  x={0}
                  y={y(top)}
                  width={BODY_WIDTH}
                  height={Math.max(1, (top - bottom) * unitPx)}
                  fill={`url(#${patternPrefix}-${spec.id})`}
                  className="fm-vessel__reserve"
                />
                <title>
                  {t(`reserve.${reserve.type}`)} — {reserve.label},{' '}
                  {t('capacity.units', { units: reserve.amount })}
                </title>
              </g>
            );
          })}

          {/* The deliverable-capacity rule: the line work must fit under. */}
          <line
            x1={0}
            x2={BODY_WIDTH}
            y1={y(summary.reservedTotal + summary.deliverableCapacity)}
            y2={y(summary.reservedTotal + summary.deliverableCapacity)}
            className="fm-vessel__rule"
          />

          {laidOut.map((block) => {
            const isOverflow = block.top > summary.reservedTotal + summary.deliverableCapacity;
            const carried = block.footprint.carryOverFromQuarterId !== undefined;
            const blockHeight = Math.max(6, block.footprint.units * unitPx);
            const selected = block.footprint.id === selectedFootprintId;

            return (
              // `gridcell` must be inside a `row` — axe flags the shortcut, and
              // screen readers genuinely need the structure. Each block is its
              // own row because the vessel stacks them vertically.
              <g role="row" key={block.footprint.id}>
                <g
                  role="gridcell"
                  tabIndex={0}
                  aria-label={blockLabel(block, isOverflow, carried)}
                  aria-selected={selected}
                  className="fm-block"
                  data-selected={selected || undefined}
                  data-counted={block.counted || undefined}
                  onClick={() => onSelect?.(block.footprint.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelect?.(block.footprint.id);
                    }
                  }}
                >
                  <rect
                    x={6}
                    y={y(block.top)}
                    width={BODY_WIDTH - 12}
                    height={blockHeight}
                    rx={2}
                    className="fm-block__fill"
                  />
                  {carried && (
                    <rect
                      x={6}
                      y={y(block.top)}
                      width={BODY_WIDTH - 12}
                      height={blockHeight}
                      rx={2}
                      fill={`url(#${patternPrefix}-carryover)`}
                    />
                  )}
                  {isOverflow && (
                    <rect
                      x={6}
                      y={y(block.top)}
                      width={BODY_WIDTH - 12}
                      height={blockHeight}
                      rx={2}
                      fill={`url(#${patternPrefix}-overflow)`}
                    />
                  )}
                  {blockHeight >= 14 && (
                    <text x={14} y={y(block.top) + blockHeight / 2 + 4} className="fm-block__label">
                      {block.commitment.class === 'MANDATORY' ? '🔒 ' : ''}
                      {truncate(block.commitment.name, 22)}
                    </text>
                  )}
                  {blockHeight >= 14 && (
                    <text
                      x={BODY_WIDTH - 18}
                      y={y(block.top) + blockHeight / 2 + 4}
                      className="fm-block__units"
                      textAnchor="end"
                    >
                      {block.footprint.units}
                    </text>
                  )}
                </g>
              </g>
            );
          })}
        </g>
      </svg>

      {/* Never colour alone: units AND percent AND a glyph AND words. */}
      <figcaption className="fm-vessel__caption">
        <span className="fm-vessel__team">
          {teamName} · {teamQuarter.quarterId}
        </span>
        {percent === null ? (
          <span className="fm-vessel__status">{t('capacity.noDeliverable')}</span>
        ) : overCapacity ? (
          <span className="fm-vessel__status fm-vessel__status--over">
            {t('capacity.overCapacity', { units: summary.overflow, percent })}
          </span>
        ) : (
          <span className="fm-vessel__status">
            {t('capacity.utilisation', { percent })} ·{' '}
            {t('capacity.headroom', { units: summary.headroom })}
          </span>
        )}
      </figcaption>
    </figure>
  );
}

function blockLabel(
  block: VesselBlock & { top: number },
  isOverflow: boolean,
  carried: boolean,
): string {
  return [
    block.commitment.name,
    t(`lifecycle.${block.commitment.lifecycle}`),
    t('capacity.units', { units: block.footprint.units }),
    block.commitment.class === 'MANDATORY' ? t('class.MANDATORY') : null,
    carried ? t('carryover.from', { quarter: block.footprint.carryOverFromQuarterId ?? '' }) : null,
    isOverflow ? t('pattern.overflow') : null,
    block.counted ? null : t('vessel.notCounted'),
  ]
    .filter(Boolean)
    .join('. ');
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
