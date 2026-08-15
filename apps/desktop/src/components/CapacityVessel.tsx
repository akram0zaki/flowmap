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
  /** Level 2: drop labels and the axis, keep the shape and the caption. */
  readonly compact?: boolean;
  /** Out of focus or filtered out — faded, never removed. */
  readonly dimmedFootprintIds?: ReadonlySet<string>;
  readonly onSelect?: (footprintId: string) => void;
};

const AXIS_WIDTH = 34;
const COMPACT_AXIS_WIDTH = 20;
const BODY_WIDTH = 260;
const TOP_PAD = 28;
const BOTTOM_PAD = 24;

export function CapacityVessel({
  teamName,
  teamQuarter,
  summary,
  blocks,
  zoom = 1,
  selectedFootprintId,
  compact = false,
  dimmedFootprintIds,
  onSelect,
}: CapacityVesselProps) {
  const patternPrefix = useId().replace(/:/g, '');
  const unitPx = UNIT_PX * zoom;
  // The axis is the first thing to go when space is tight; the vessel shape and
  // the caption still carry the meaning.
  const axisWidth = compact ? COMPACT_AXIS_WIDTH : AXIS_WIDTH;

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

  const ceilingUnits = summary.reservedTotal + summary.deliverableCapacity;

  const ticks: number[] = [];
  for (let u = 0; u <= axisMax; u += UNIT_TICK_MINOR) ticks.push(u);

  const carriedUnits = laidOut
    .filter((block) => block.footprint.carryOverFromQuarterId !== undefined)
    .reduce((sum, block) => sum + block.footprint.units, 0);

  const legend = [
    ...teamQuarter.reserves.map((reserve) => ({
      key: reserve.id,
      label: `${reserve.label} · ${reserve.amount}`,
    })),
    // No glyph here: ↻ (U+21BB) is not in Atkinson Hyperlegible and rendered as
    // a broken box. The cross-hatch on the block and these words carry it.
    ...(carriedUnits > 0
      ? [{ key: 'carried', label: t('carryover.units', { units: carriedUnits }) }]
      : []),
  ];

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
    <figure
      className="fm-vessel"
      data-over-capacity={overCapacity || undefined}
      data-closed={teamQuarter.closedAt !== undefined || undefined}
    >
      <svg
        // A grid must contain at least one row. An empty container is genuinely
        // a labelled picture of a container, not a grid with nothing in it.
        role={laidOut.length > 0 ? 'grid' : 'img'}
        aria-label={summaryLabel}
        // Scales to fill its cell rather than sitting at a fixed size in a sea
        // of white — the block heights stay proportional either way.
        width="100%"
        height={height}
        viewBox={`0 0 ${axisWidth + BODY_WIDTH + (overCapacity && !compact ? 34 : 4)} ${height}`}
        preserveAspectRatio="xMidYMax meet"
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
        <g className="fm-vessel__axis" aria-hidden="true" data-hidden={compact || undefined}>
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

        <g transform={`translate(${axisWidth} 0)`}>
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

          {laidOut.map((block) => {
            const carried = block.footprint.carryOverFromQuarterId !== undefined;
            const blockHeight = Math.max(6, block.footprint.units * unitPx);
            const selected = block.footprint.id === selectedFootprintId;
            const dimmed = dimmedFootprintIds?.has(block.footprint.id) ?? false;

            // Only the part of the block that is genuinely past the rule gets
            // the overflow texture. Hatching the whole block would claim more
            // units are over than the bracket measures, and the two would
            // contradict each other in the same picture.
            const overUnits = Math.max(0, block.top - Math.max(block.bottom, ceilingUnits));
            const isOverflow = overUnits > 0;

            // The rule is drawn over the stack, so a label sitting at the same
            // height gets struck through. A block that straddles the limit puts
            // its label in whichever half is taller — which is also where the
            // block's weight is, so it reads better as well as more legibly.
            const straddles = overUnits > 0 && overUnits < block.footprint.units;
            const underUnits = block.footprint.units - overUnits;
            const labelCentre = straddles
              ? overUnits > underUnits
                ? block.top - overUnits / 2
                : block.bottom + underUnits / 2
              : block.top - block.footprint.units / 2;
            const labelY = Math.max(y(block.top) + 8, y(labelCentre) + 4);

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
                  data-mandatory={block.commitment.class === 'MANDATORY' || undefined}
                  data-selected={selected || undefined}
                  data-counted={block.counted || undefined}
                  data-dimmed={dimmed || undefined}
                  onClick={() => onSelect?.(block.footprint.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelect?.(block.footprint.id);
                    }
                  }}
                >
                  <title>
                    {block.commitment.name} · {block.footprint.units}
                  </title>
                  <rect
                    x={6}
                    y={y(block.top) + 0.5}
                    width={BODY_WIDTH - 12}
                    height={Math.max(2, blockHeight - 1)}
                    rx={2}
                    className="fm-block__fill"
                  />
                  {/* Carry-over stops at the rule. Laying its cross-hatch under
                      the overflow hatch makes plaid, and a region that carries
                      two textures at once reads as neither. Above the rule the
                      overflow marker has priority; the caption still names the
                      carried units in full. */}
                  {carried && underUnits > 0 && (
                    <rect
                      x={6}
                      y={y(Math.min(block.top, ceilingUnits)) + 0.5}
                      width={BODY_WIDTH - 12}
                      height={Math.max(2, underUnits * unitPx)}
                      rx={2}
                      fill={`url(#${patternPrefix}-carryover)`}
                    />
                  )}
                  {isOverflow && (
                    <rect
                      x={6}
                      y={y(block.top) + 0.5}
                      width={BODY_WIDTH - 12}
                      height={Math.max(2, overUnits * unitPx)}
                      rx={2}
                      fill={`url(#${patternPrefix}-overflow)`}
                    />
                  )}
                  {/* Three tiers of degradation. A block too thin for both keeps
                      the number, because the number is the part that measures. */}
                  {blockHeight >= 15 && (
                    <text
                      x={14}
                      y={labelY}
                      className="fm-block__label"
                      data-over={isOverflow || undefined}
                    >
                      {block.commitment.class === 'MANDATORY' ? '🔒 ' : ''}
                      {truncate(block.commitment.name, 30)}
                    </text>
                  )}
                  {blockHeight >= 9 && (
                    <text
                      x={BODY_WIDTH - 18}
                      y={blockHeight >= 15 ? labelY : y(block.top) + blockHeight / 2 + 3}
                      className="fm-block__units"
                      data-thin={blockHeight < 15 || undefined}
                      textAnchor="end"
                    >
                      {block.footprint.units}
                    </text>
                  )}
                </g>
              </g>
            );
          })}

          {/* Drawn last, over the stack. It is the one line the work has to fit
              under, so nothing is allowed to bury it — and it extends past both
              walls so the spill above reads as breaching a limit rather than as
              more stacking. */}
          <line
            x1={-6}
            x2={BODY_WIDTH + (overCapacity && !compact ? 8 : 4)}
            y1={y(ceilingUnits)}
            y2={y(ceilingUnits)}
            className="fm-vessel__rule"
          />

          {/* The excess, measured. A bracket from the rule to the top of the
              stack turns overflow into a drawn quantity rather than a texture. */}
          {overCapacity && !compact && (
            <g className="fm-overflow" aria-hidden="true">
              <path
                d={`M ${BODY_WIDTH + 4} ${y(ceilingUnits)}
                    h 5 V ${y(ceilingUnits + summary.overflow)} h -5`}
                className="fm-overflow__bracket"
              />
              <text
                x={BODY_WIDTH + 12}
                y={y(ceilingUnits + summary.overflow / 2) + 4}
                className="fm-overflow__label"
              >
                +{summary.overflow}
              </text>
            </g>
          )}
        </g>
      </svg>

      {/* Never colour alone: units AND percent AND a glyph AND words. */}
      <figcaption className="fm-vessel__caption">
        {/* The headline is the figure. Its label, and the team name already in
            the row header, do not need repeating at the same weight. */}
        <span className="fm-vessel__figure">
          <span className="fm-vessel__percent">{percent === null ? '—' : `${percent}%`}</span>
          <span className="fm-vessel__delta">
            {percent === null
              ? t('capacity.noDeliverable')
              : overCapacity
                ? t('capacity.overBy', { units: summary.overflow })
                : t('capacity.headroom', { units: summary.headroom })}
          </span>
        </span>

        {/* Why the container is smaller than a normal quarter. Without this the
            overload has a visible symptom and no visible cause. */}
        {teamQuarter.capacityAdjustment !== 0 && (
          <span className="fm-vessel__reason">
            {/* Direction in the word, magnitude in the figure. "-10 units this
                quarter" opened on a hyphen, which reads as a list bullet. */}
            {t(
              teamQuarter.capacityAdjustment < 0 ? 'capacity.adjustedDown' : 'capacity.adjustedUp',
              { units: Math.abs(teamQuarter.capacityAdjustment) },
            )}
            {teamQuarter.adjustmentNote ? ` — ${teamQuarter.adjustmentNote}` : ''}
          </span>
        )}

        {/* Reserves and carry-over named, not left to the hatching alone. */}
        {!compact && legend.length > 0 && (
          <span className="fm-vessel__legend">
            {legend.map((entry) => (
              <span key={entry.key}>{entry.label}</span>
            ))}
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
    isOverflow ? t('patterns.overflow') : null,
    block.counted ? null : t('vessel.notCounted'),
  ]
    .filter(Boolean)
    .join('. ');
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
