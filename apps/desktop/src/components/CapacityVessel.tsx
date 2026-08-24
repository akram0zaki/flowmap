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

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type {
  CapacitySummary,
  CapacityFootprint,
  Commitment,
  Milestone,
  TeamQuarter,
} from '@flowmap/domain';
import { utilisationPercent } from '@flowmap/domain';
import {
  PATTERNS,
  UNIT_PX,
  UNIT_TICK_MAJOR,
  UNIT_TICK_MINOR,
  patternGeometry,
  patternPitch,
} from '@flowmap/ui';

import { observeResize } from '../state/observe-resize.js';
import { t } from '../i18n/t.js';

export type VesselBlock = {
  readonly footprint: CapacityFootprint;
  readonly commitment: Commitment;
  readonly counted: boolean;
  readonly scenarioGhost?: boolean;
  /**
   * Is this in trouble? Orthogonal to attention, and never merged with it into
   * one number or one colour (spec 04 §2). A user cannot dispose of it.
   */
  readonly health?: 'OK' | 'WATCH' | 'AT_RISK';
  /**
   * The checkable points inside this work, capped at six by the domain.
   *
   * Drawn on the block because that is where the question is asked — "is this
   * on track" is answered by what has been passed, not by opening a panel.
   */
  readonly milestones?: readonly Milestone[];
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
  /**
   * Work being held over this container. Drawn as an outline landing on top of
   * the stack, so the answer to "will it fit" is the picture rather than a
   * number you have to compare against another number.
   */
  readonly incoming?: {
    readonly units: number;
    readonly allowed: boolean;
    /** Utilisation the container would show after the drop. */
    readonly percent: number | null;
    readonly overflow: number;
  };
  readonly onSelect?: (footprintId: string) => void;
  /** Start moving this block — pointer press, or Space on the keyboard. */
  readonly onPickUp?: (footprintId: string, event?: ReactPointerEvent) => void;
  /** Take this block off the board. The keyboard route to the Ideas rail. */
  readonly onRemove?: (footprintId: string) => void;
  /**
   * Change how many units this block occupies. `via: 'pointer'` starts a drag
   * on the top edge; the keyboard sends an absolute value straight through.
   */
  readonly onResize?: (footprintId: string, units: number, via: 'pointer' | 'keyboard') => void;
  /** Start drawing a dependency from this block. Shift-drag, or `d`. */
  readonly onLink?: (commitmentId: string, event?: ReactPointerEvent) => void;
  /** Units per pixel, so the caller can turn pointer movement into units. */
  readonly onResizeStart?: (footprintId: string, event: ReactPointerEvent, unitPx: number) => void;
  /** While a resize is in flight, draw this block at that size instead. */
  readonly resizing?: { readonly footprintId: string; readonly units: number };
  /**
   * Names for the Ideas a refinement reserve supports, by id.
   *
   * The reserve stores ids; the tooltip has to say who they are, or "supports 4
   * Ideas" is a number with nothing behind it (spec 02 §5.1).
   */
  readonly ideaNames?: ReadonlyMap<string, string>;
  /** Milestones on related work, emphasised while focus is on. */
  readonly focusedMilestoneIds?: ReadonlySet<string>;
};

/** Milestone marker geometry. Six of them must fit on one block. */
const MILESTONE_SIZE = 7;
const MILESTONE_GAP = 9;

/** Grab area on a block's top edge. Generous, per the 24px hit-target rule. */
const RESIZE_GRIP = 10;

const AXIS_WIDTH = 34;
const COMPACT_AXIS_WIDTH = 20;

/**
 * Width the drawing assumes before it has measured itself, and the narrowest it
 * will draw into. Below this the labels have nowhere to go.
 */
const FALLBACK_WIDTH = 294;
const MIN_BODY_WIDTH = 120;
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
  incoming,
  onSelect,
  onPickUp,
  onRemove,
  onResize,
  onResizeStart,
  onLink,
  resizing,
  ideaNames,
  focusedMilestoneIds,
}: CapacityVesselProps) {
  const patternPrefix = useId().replace(/:/g, '');
  const unitPx = UNIT_PX * zoom;
  // The axis is the first thing to go when space is tight; the vessel shape and
  // the caption still carry the meaning.
  const axisWidth = compact ? COMPACT_AXIS_WIDTH : AXIS_WIDTH;
  const overCapacity = summary.overflow > 0;

  /**
   * One viewBox unit is one CSS pixel.
   *
   * The drawing used to be laid out in a fixed 294-unit box and left to
   * `preserveAspectRatio` to fit the cell — which meant that on a narrow column
   * *everything* was scaled down, including the text. At six quarters on a 13"
   * screen that put 11px labels on screen at about 7px, and zooming did not
   * help: zoom grows the viewBox height, so blocks got taller while the type,
   * measured in the same shrinking units, stayed exactly as small.
   *
   * Measuring the element and matching the viewBox to it means the scale is
   * always 1: type is the size it says it is, and zoom buys vertical room
   * rather than a magnifying glass over a shrunken picture.
   */
  const frameRef = useRef<HTMLElement | null>(null);
  const [measuredWidth, setMeasuredWidth] = useState(FALLBACK_WIDTH);

  const measure = useCallback(() => {
    const node = frameRef.current;
    if (!node) return;
    const next = Math.max(node.clientWidth, axisWidth + MIN_BODY_WIDTH);
    // Guarded, because this runs after every render and an unguarded set would
    // be a loop.
    setMeasuredWidth((current) => (current === next ? current : next));
  }, [axisWidth]);

  /**
   * Measured after every render, not only when a `ResizeObserver` says so.
   *
   * The observer is the right tool for a window resize and the wrong one for
   * everything else: it does not deliver at all in a hidden tab, and it reports
   * *after* the frame in which the layout changed. Zooming widens the columns,
   * so relying on it alone left the drawing laid out for the old width and
   * scaled up to fill the new one — the exact stretching this measurement
   * exists to prevent, arriving by a different route.
   */
  useLayoutEffect(measure);
  useEffect(() => observeResize(frameRef.current, measure), [measure]);

  // Room on the right for the overflow bracket, when one is drawn.
  const rightPad = overCapacity && !compact ? 34 : 4;
  const BODY_WIDTH = Math.max(MIN_BODY_WIDTH, measuredWidth - axisWidth - rightPad);

  // The axis spans the effective capacity, or the load when work overflows past
  // it — otherwise the spill would be drawn outside the viewBox.
  const incomingUnits = incoming?.allowed ? incoming.units : 0;
  const axisMax = Math.max(
    summary.effectiveCapacity,
    summary.reservedTotal + summary.committedLoad + incomingUnits,
  );
  const bodyHeight = axisMax * unitPx;
  const height = bodyHeight + TOP_PAD + BOTTOM_PAD;
  const y = (units: number) => TOP_PAD + bodyHeight - units * unitPx;

  const percent = utilisationPercent(summary);

  // Stack from the top of the reserve plinth upward. A block being resized is
  // laid out at its provisional size, so everything above it moves with the
  // edge rather than jumping when the pointer is released.
  const sizeOf = (block: VesselBlock) =>
    resizing?.footprintId === block.footprint.id ? resizing.units : block.footprint.units;

  let cursor = summary.reservedTotal;
  const laidOut = blocks.map((block) => {
    const bottom = cursor;
    const units = sizeOf(block);
    cursor += block.counted ? units : 0;
    return { ...block, units, bottom, top: bottom + units };
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
      ref={frameRef}
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
        viewBox={`0 0 ${measuredWidth} ${height}`}
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
                  {/* A refinement bucket without its Ideas is a number with
                      nothing behind it. The links carry no units, so naming
                      them here is the only place the qualitative half of the
                      reserve is visible at all. */}
                  {reserve.type === 'REFINEMENT' && `. ${refinementSupport(reserve, ideaNames)}`}
                </title>
              </g>
            );
          })}

          {laidOut.map((block) => {
            const carried = block.footprint.carryOverFromQuarterId !== undefined;
            const blockHeight = Math.max(6, block.units * unitPx);
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
            const straddles = overUnits > 0 && overUnits < block.units;
            const underUnits = block.units - overUnits;
            const labelCentre = straddles
              ? overUnits > underUnits
                ? block.top - overUnits / 2
                : block.bottom + underUnits / 2
              : block.top - block.units / 2;
            const labelY = Math.max(y(block.top) + 8, y(labelCentre) + 4);

            // The grip must never own most of a block, or a small block cannot
            // be picked up and moved at all — only resized.
            const gripHeight = Math.max(4, Math.min(RESIZE_GRIP, blockHeight * 0.4));

            // Milestones are Level 3 detail, like names: at Level 2 the block
            // is a quantity, not a plan. They still reach a screen reader at
            // every level, through the label.
            const milestones = block.milestones ?? [];
            const showMilestones = !compact && milestones.length > 0 && blockHeight >= 15;
            const milestoneWidth = showMilestones ? milestones.length * MILESTONE_GAP + 4 : 0;

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
                  data-commitment={block.commitment.id}
                  data-mandatory={block.commitment.class === 'MANDATORY' || undefined}
                  data-health={block.health && block.health !== 'OK' ? block.health : undefined}
                  data-selected={selected || undefined}
                  data-counted={block.counted || undefined}
                  data-scenario-ghost={block.scenarioGhost || undefined}
                  data-dimmed={dimmed || undefined}
                  onPointerDown={(e) => {
                    // Shift turns the move gesture into a link gesture: same
                    // pick-up, pass-over, release, different statement.
                    if (e.shiftKey) onLink?.(block.commitment.id, e);
                    else onPickUp?.(block.footprint.id, e);
                  }}
                  onClick={() => onSelect?.(block.footprint.id)}
                  onKeyDown={(e) => {
                    // Enter inspects, Space picks up — the WAI-ARIA drag idiom,
                    // and the same split the pointer makes between a click and
                    // a press that travels.
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      onSelect?.(block.footprint.id);
                    } else if (e.key === ' ') {
                      e.preventDefault();
                      onPickUp?.(block.footprint.id);
                    } else if (e.key === 'Delete' || e.key === 'Backspace') {
                      // The keyboard equivalent of dragging it back to the lane.
                      e.preventDefault();
                      onRemove?.(block.footprint.id);
                    } else if (e.key === '+' || e.key === '=' || e.key === 'ArrowUp') {
                      // The keyboard equivalent of dragging the top edge. Shift
                      // moves by the coarse step, matching how the pointer feels
                      // when you drag a long way rather than a little.
                      e.preventDefault();
                      onResize?.(
                        block.footprint.id,
                        block.units + (e.shiftKey ? 5 : 1),
                        'keyboard',
                      );
                    } else if (e.key === '-' || e.key === '_' || e.key === 'ArrowDown') {
                      e.preventDefault();
                      onResize?.(
                        block.footprint.id,
                        block.units - (e.shiftKey ? 5 : 1),
                        'keyboard',
                      );
                    }
                  }}
                >
                  <title>
                    {block.commitment.name} · {block.units}
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
                  {/* Colour, not texture. "Never colour alone" asks for a second
                      channel, not for stripes printed through the label — the
                      bracket, the ▲, and "+13 over" in the caption are that
                      channel, and they survive greyscale and screen readers
                      alike. Striping the fill only made the words unreadable. */}
                  {isOverflow && (
                    <rect
                      x={6}
                      y={y(block.top) + 0.5}
                      width={BODY_WIDTH - 12}
                      height={Math.max(2, overUnits * unitPx)}
                      rx={2}
                      className="fm-block__over"
                    />
                  )}
                  {/* The top edge is the size. Grabbing it is how you change
                      how much of the quarter this work takes, in the one place
                      where the consequence is already drawn. */}
                  {onResizeStart && !compact && (
                    <rect
                      x={6}
                      y={y(block.top) - gripHeight / 2}
                      width={BODY_WIDTH - 12}
                      height={gripHeight}
                      className="fm-block__grip"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        // A viewBox unit is a CSS pixel now, so the conversion
                        // is the identity — but it is still measured rather
                        // than assumed, because the day that stops being true
                        // the edge would silently lag the cursor again.
                        const svg = e.currentTarget.ownerSVGElement;
                        const scale = svg ? svg.getBoundingClientRect().height / height : 1;
                        onResizeStart(block.footprint.id, e, unitPx * scale);
                      }}
                    >
                      <title>{t('resize.grip', { name: block.commitment.name })}</title>
                    </rect>
                  )}

                  {/* Three tiers of degradation. A block too thin for both keeps
                      the number, because the number is the part that measures. */}
                  {/* The lock is a state, not a label, so it survives the drop
                      to Level 2 on its own. Mandatory work that stopped being
                      marked would be colour-alone by omission. */}
                  {compact && block.commitment.class === 'MANDATORY' && blockHeight >= 9 && (
                    <text
                      x={14}
                      y={y(block.top) + blockHeight / 2 + 4}
                      className="fm-block__lock"
                      aria-hidden="true"
                    >
                      🔒
                    </text>
                  )}

                  {/* Names are a Level 3 thing (spec 06 §3.3): L2 shows blocks,
                      reserves and figures, L3 adds the labels. Drawing them at
                      L2 anyway meant a 162px column rendering "Payment refe…",
                      which is worse than no label — it takes the room and says
                      nothing. The `<title>` still names it on hover. */}
                  {/* Diamonds along the left edge, before the name. Shape is
                      the channel, not colour: outline is still to come, solid
                      is passed, and a bar through it is missed — all three
                      survive greyscale, and the `<title>` names each one. */}
                  {showMilestones && (
                    <g className="fm-block__milestones">
                      {milestones.map((milestone, index) => {
                        const cx = 14 + index * MILESTONE_GAP + MILESTONE_SIZE / 2;
                        const cy = labelY - 4;
                        const r = MILESTONE_SIZE / 2;
                        return (
                          <g
                            key={milestone.id}
                            className="fm-milestone"
                            data-status={milestone.status}
                            data-dimmed={
                              (focusedMilestoneIds !== undefined &&
                                !focusedMilestoneIds.has(milestone.id)) ||
                              undefined
                            }
                          >
                            <path
                              d={`M ${cx} ${cy - r} L ${cx + r} ${cy} L ${cx} ${cy + r} L ${cx - r} ${cy} Z`}
                            />
                            {milestone.status === 'MISSED' && (
                              <line x1={cx - r} x2={cx + r} y1={cy} y2={cy} />
                            )}
                            <title>{milestoneLabel(milestone)}</title>
                          </g>
                        );
                      })}
                    </g>
                  )}

                  {(!compact || selected) && blockHeight >= 15 && (
                    <text
                      x={14 + milestoneWidth}
                      y={labelY}
                      className="fm-block__label"
                      data-over={isOverflow || undefined}
                    >
                      {block.commitment.class === 'MANDATORY' ? '🔒 ' : ''}
                      {truncate(block.commitment.name, labelBudget(BODY_WIDTH - milestoneWidth))}
                    </text>
                  )}
                  {block.scenarioGhost && blockHeight >= 15 && (
                    <text
                      x={BODY_WIDTH - 18}
                      y={labelY}
                      className="fm-block__scenario-badge"
                      textAnchor="end"
                      aria-hidden="true"
                    >
                      {t('scenario.ghost')}
                    </text>
                  )}
                  {blockHeight >= 9 && (!block.scenarioGhost || blockHeight < 15) && (
                    <text
                      x={BODY_WIDTH - 18}
                      y={blockHeight >= 15 ? labelY : y(block.top) + blockHeight / 2 + 3}
                      className="fm-block__units"
                      data-thin={blockHeight < 15 || undefined}
                      textAnchor="end"
                    >
                      {block.units}
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

          {/* Work being held over this container: an outline sitting where it
              would land, so "will it fit" is answered by the drawing rather
              than by comparing two numbers. Above the rule it is already
              breaching; the caption states the projected figure either way. */}
          {incoming?.allowed && (
            <g className="fm-incoming" aria-hidden="true">
              <rect
                x={6}
                y={y(summary.reservedTotal + summary.committedLoad + incomingUnits)}
                width={BODY_WIDTH - 12}
                height={Math.max(3, incomingUnits * unitPx)}
                rx={2}
                className="fm-incoming__band"
              />
              {incomingUnits * unitPx >= 15 && (
                <text
                  x={BODY_WIDTH / 2}
                  y={y(summary.reservedTotal + summary.committedLoad + incomingUnits / 2) + 4}
                  className="fm-incoming__label"
                  textAnchor="middle"
                >
                  +{incoming.units}
                </text>
              )}
            </g>
          )}

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
        {/* While work is held over this container the figure shows what it
            would become, with the current value kept alongside — the whole
            argument for dragging is that you see the consequence before you
            commit to it, not in a toast afterwards. */}
        <span
          className="fm-vessel__figure"
          data-projected={incoming?.allowed || undefined}
          data-over={(incoming?.allowed ? incoming.overflow > 0 : overCapacity) || undefined}
        >
          <span className="fm-vessel__percent">
            {incoming?.allowed
              ? incoming.percent === null
                ? '—'
                : `${incoming.percent}%`
              : percent === null
                ? '—'
                : `${percent}%`}
          </span>
          <span className="fm-vessel__delta">
            {incoming?.allowed
              ? incoming.overflow > 0
                ? t('capacity.overBy', { units: incoming.overflow })
                : t('drop.wouldBe', { percent: percent ?? 0 })
              : percent === null
                ? t('capacity.noDeliverable')
                : overCapacity
                  ? t('capacity.overBy', { units: summary.overflow })
                  : t('capacity.headroom', { units: summary.headroom })}
          </span>
          {/* The denominator, on screen. Without it the figure is unreadable:
              10 units of a 100-unit quarter shows as 13%, because it is 13% of
              the 80 that are deliverable — and the bar behind it is drawn
              against the full 100, so the block looks like a quarter of the
              container while the number says an eighth. The screen-reader
              label has said "of deliverable capacity" all along; this is the
              same sentence, for the people looking at it. */}
          {percent !== null && !overCapacity && (
            <span className="fm-vessel__of">
              {t('capacity.ofDeliverable', { units: summary.deliverableCapacity })}
            </span>
          )}
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
  const milestones = block.milestones ?? [];
  return [
    block.commitment.name,
    t(`lifecycle.${block.commitment.lifecycle}`),
    t('capacity.units', { units: block.footprint.units }),
    block.commitment.class === 'MANDATORY' ? t('class.MANDATORY') : null,
    carried ? t('carryover.from', { quarter: block.footprint.carryOverFromQuarterId ?? '' }) : null,
    isOverflow ? t('patterns.overflow') : null,
    block.counted ? null : t('vessel.notCounted'),
    block.scenarioGhost ? t('scenario.ghost') : null,
    // Health is a separate answer from attention, so it is said separately.
    block.health && block.health !== 'OK' ? t(`health.${block.health}`) : null,
    // Announced at every level, including the ones too small to draw them —
    // a marker a sighted user can see and a screen-reader user cannot is the
    // failure this line exists to prevent.
    milestones.length > 0
      ? [
          t('vessel.milestones', { count: milestones.length }),
          ...milestones.map(milestoneLabel),
        ].join(': ')
      : null,
  ]
    .filter(Boolean)
    .join('. ');
}

function milestoneLabel(milestone: Milestone): string {
  return t('vessel.milestoneAt', {
    name: milestone.name,
    status: t(`milestone.${milestone.status}`),
    date: milestone.targetDate
      ? t('vessel.milestoneOn', { date: milestone.targetDate })
      : t('vessel.milestoneUndated'),
  });
}

/** "Supports 4 Ideas: …" — the qualitative half of a refinement reserve. */
function refinementSupport(
  reserve: TeamQuarter['reserves'][number],
  ideaNames: ReadonlyMap<string, string> | undefined,
): string {
  const linked = reserve.linkedIdeaIds ?? [];
  if (linked.length === 0) return t('reserve.supportsNone');

  return t('reserve.supports', {
    count: linked.length,
    names: linked.map((id) => ideaNames?.get(id) ?? id).join(', '),
  });
}

/**
 * How many characters fit on a block, in the width left beside the units.
 *
 * A heuristic rather than a measurement: SVG text has no ellipsis, so the
 * string has to be cut before it is drawn, and measuring every label with
 * `getComputedTextLength` would mean a layout pass per block on every render.
 * 5.8px is Atkinson Hyperlegible's rough average advance at 12px. The reserve
 * is the left inset (14) plus the units figure right-aligned at bodyWidth-18,
 * plus a gap wide enough that a long name and a two-digit number do not read as
 * one word — "Legacy gateway decommiss10" is what a too-small reserve looks
 * like, and it reads as a rendering fault rather than as truncation.
 */
function labelBudget(bodyWidth: number): number {
  return Math.max(8, Math.floor((bodyWidth - 62) / 5.8));
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
