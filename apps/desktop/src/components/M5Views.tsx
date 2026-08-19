/** M5 lenses: each visual has its sortable table companion in the same view. */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import {
  openQuarterReview,
  proposeCarryOver,
  type CarryOverDecision,
  type QuarterOutcome,
  type WorkspaceState,
} from '@flowmap/domain';
import { allChangeLoads } from '@flowmap/rules';
import type { RuleResult } from '@flowmap/rules';
import {
  buildDependencyGraph,
  buildTimeline,
  placeDependencyNodes,
  type TimelineGroupBy,
} from '@flowmap/visual-model';
import { observeResize } from '../state/observe-resize.js';
import type { FilterState } from '@flowmap/visual-model';
import type { HorizonPreset } from '@flowmap/domain';

import { t } from '../i18n/t.js';

export function TimelineView({
  state,
  onOpen,
  filter,
}: {
  readonly state: WorkspaceState;
  readonly onOpen: (id: string) => void;
  readonly filter: FilterState;
}) {
  const [preset, setPreset] = useState<HorizonPreset>('QBR');
  const [groupBy, setGroupBy] = useState<TimelineGroupBy>('TEAM');
  const model = useMemo(() => buildTimeline(state, preset, groupBy), [state, preset, groupBy]);
  return (
    <section className="fm-m5" aria-labelledby="timeline-title">
      <header className="fm-m5__header">
        <div>
          <h2 id="timeline-title">{t('timeline.title')}</h2>
          <p>{t('timeline.description')}</p>
        </div>
        <div className="fm-m5__controls">
          <label>
            {t('timeline.preset')}
            <select
              value={preset}
              onChange={(event) => setPreset(event.target.value as HorizonPreset)}
            >
              {(['NOW', 'QBR', 'HORIZON'] as const).map((item) => (
                <option key={item} value={item}>
                  {t(`timeline.${item}`)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('timeline.group')}
            <select
              value={groupBy}
              onChange={(event) => setGroupBy(event.target.value as TimelineGroupBy)}
            >
              {(['TEAM', 'PRODUCT', 'THEME'] as const).map((item) => (
                <option key={item} value={item}>
                  {t(`timeline.${item}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>
      <div className="fm-timeline" role="region" aria-label={t('timeline.title')}>
        <div className="fm-timeline__axis">
          {model.quarters.map((quarter) => (
            <span key={quarter}>{quarter}</span>
          ))}
        </div>
        {model.rows.map((row) => {
          const fragments = row.fragments.filter((fragment) =>
            matchesCommitmentFilter(state, filter, fragment.commitmentId, fragment.footprintId),
          );
          if (fragments.length === 0) return null;
          return (
            <div className="fm-timeline__row" key={row.id}>
              <strong>{row.id === 'UNASSIGNED' ? t('timeline.unassigned') : row.label}</strong>
              <div className="fm-timeline__track">
                {fragments.map((fragment) => (
                  <button
                    key={fragment.footprintId}
                    type="button"
                    className="fm-timeline__fragment"
                    data-carried={fragment.carriedFrom ? true : undefined}
                    style={{ gridColumn: model.quarters.indexOf(fragment.quarterId) + 1 }}
                    onClick={() => onOpen(fragment.commitmentId)}
                    aria-label={`${fragment.commitment}, ${fragment.units}, ${fragment.quarterId}${fragment.carriedFrom ? `, ${t('carryover.from', { quarter: fragment.carriedFrom })}` : ''}`}
                  >
                    <span>{fragment.commitment}</span>
                    <em>{fragment.units}</em>
                    {fragment.carriedFrom && <i>{t('timeline.carried')}</i>}
                  </button>
                ))}
                {row.milestones.map((milestone) => (
                  <button
                    key={milestone.id}
                    type="button"
                    className="fm-timeline__milestone"
                    style={{ gridColumn: model.quarters.indexOf(milestone.quarterId) + 1 }}
                    onClick={() => onOpen(milestone.commitmentId)}
                    aria-label={`${milestone.name}, ${milestone.quarterId}`}
                  >
                    ◆
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="fm-m5__table">
        <table>
          <caption>{t('timeline.fragments')}</caption>
          <thead>
            <tr>
              <th>{t('list.commitment')}</th>
              <th>{t('list.team')}</th>
              <th>{t('list.quarter')}</th>
              <th>{t('list.units')}</th>
              <th>{t('timeline.milestones')}</th>
            </tr>
          </thead>
          <tbody>
            {model.rows.flatMap((row) =>
              row.fragments
                .filter((fragment) =>
                  matchesCommitmentFilter(
                    state,
                    filter,
                    fragment.commitmentId,
                    fragment.footprintId,
                  ),
                )
                .map((fragment) => (
                  <tr key={fragment.footprintId}>
                    <td>
                      <button
                        type="button"
                        className="fm-link"
                        onClick={() => onOpen(fragment.commitmentId)}
                      >
                        {fragment.commitment}
                      </button>
                    </td>
                    <td>{row.id === 'UNASSIGNED' ? t('timeline.unassigned') : row.label}</td>
                    <td>{fragment.quarterId}</td>
                    <td>{fragment.units}</td>
                    <td>
                      {row.milestones
                        .filter((milestone) => milestone.commitmentId === fragment.commitmentId)
                        .map((milestone) => milestone.name)
                        .join(', ')}
                    </td>
                  </tr>
                )),
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function DependencyMapView({
  state,
  onOpen,
  filter,
}: {
  readonly state: WorkspaceState;
  readonly onOpen: (id: string) => void;
  readonly filter: FilterState;
}) {
  const graph = useMemo(() => buildDependencyGraph(state), [state]);
  const [expanded, setExpanded] = useState(false);
  const filteredNodes = useMemo(() => {
    const shown = expanded
      ? graph.nodes
      : graph.nodes.filter(
          (node) => node.isHub || node.unresolvedInDegree > 0 || node.cycleId !== undefined,
        );
    return shown.filter((node) =>
      node.kind === 'COMMITMENT'
        ? matchesCommitmentFilter(state, filter, node.id)
        : filter.text.trim().length === 0 ||
          node.label.toLowerCase().includes(filter.text.trim().toLowerCase()),
    );
  }, [expanded, filter, graph.nodes, state]);
  const layout = useMemo(() => placeDependencyNodes(filteredNodes), [filteredNodes]);
  const visibleEdges = useMemo(() => {
    const ids = new Set(filteredNodes.map((node) => node.id));
    return graph.edges.filter((edge) => ids.has(edge.sourceId) && ids.has(edge.targetId));
  }, [filteredNodes, graph.edges]);
  const label = new Map(graph.nodes.map((node) => [node.id, node.label]));
  const mapRef = useRef<HTMLDivElement>(null);
  const edgesRef = useRef<SVGSVGElement>(null);
  const [lines, setLines] = useState<
    readonly {
      readonly id: string;
      readonly hard: boolean;
      readonly status: string;
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
    }[]
  >([]);

  const measure = useCallback(() => {
    const root = mapRef.current;
    if (!root) return setLines([]);
    if (edgesRef.current) {
      edgesRef.current.setAttribute('width', String(root.scrollWidth));
      edgesRef.current.setAttribute('height', String(root.scrollHeight));
    }
    const origin = root.getBoundingClientRect();
    const next: Array<{
      readonly id: string;
      readonly hard: boolean;
      readonly status: string;
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
    }> = [];
    const escapeId = (value: string) =>
      typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(value) : value;
    for (const edge of visibleEdges) {
      const from = root.querySelector<HTMLElement>(`[data-node="${escapeId(edge.sourceId)}"]`);
      const to = root.querySelector<HTMLElement>(`[data-node="${escapeId(edge.targetId)}"]`);
      if (!from || !to) continue;
      const a = from.getBoundingClientRect();
      const b = to.getBoundingClientRect();
      next.push({
        id: edge.id,
        hard: edge.isHard,
        status: edge.status,
        x1: a.right - origin.left + root.scrollLeft,
        y1: a.top - origin.top + root.scrollTop + a.height / 2,
        x2: b.left - origin.left + root.scrollLeft,
        y2: b.top - origin.top + root.scrollTop + b.height / 2,
      });
    }
    setLines((current) =>
      current.length === next.length &&
      current.every(
        (line, index) =>
          line.id === next[index]?.id &&
          line.x1 === next[index]?.x1 &&
          line.y1 === next[index]?.y1 &&
          line.x2 === next[index]?.x2 &&
          line.y2 === next[index]?.y2,
      )
        ? current
        : next,
    );
  }, [visibleEdges]);

  useLayoutEffect(measure, [measure, layout]);
  useEffect(() => {
    const root = mapRef.current;
    if (!root) return undefined;
    const unobserve = observeResize(root, measure);
    root.addEventListener('scroll', measure);
    window.addEventListener('resize', measure);
    return () => {
      unobserve();
      root.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [measure]);

  return (
    <section className="fm-m5" aria-labelledby="dependency-map-title">
      <header className="fm-m5__header">
        <div>
          <h2 id="dependency-map-title">{t('dependencyMap.title')}</h2>
          <p>{t('dependencyMap.description')}</p>
        </div>
        <button type="button" className="fm-quiet" onClick={() => setExpanded((value) => !value)}>
          {t(expanded ? 'dependencyMap.showHubs' : 'dependencyMap.showAll')}
        </button>
      </header>
      <div
        ref={mapRef}
        className="fm-dependency-map"
        role="grid"
        aria-label={t('dependencyMap.title')}
        style={{ '--fm-cols': layout.columns } as CSSProperties}
      >
        {Array.from({ length: layout.columns }, (_, index) => (
          <div
            key={`layer-${index + 1}`}
            className="fm-dependency-map__layer"
            role="columnheader"
            style={{ gridColumn: index + 1, gridRow: 1 }}
          >
            {dependencyLayerLabel(index, layout.columns)}
          </div>
        ))}
        <svg ref={edgesRef} className="fm-dependency-map__edges" aria-hidden="true">
          <title>{t('dependencyMap.edges')}</title>
          <defs>
            <marker
              id="fm-dep-map-arrow"
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="7"
              markerHeight="7"
              orient="auto"
            >
              <path d="M 0 0 L 8 4 L 0 8 z" className="fm-deps__head" />
            </marker>
          </defs>
          {lines.map((line) => {
            const mid = Math.max(24, (line.x2 - line.x1) / 2);
            return (
              <path
                key={line.id}
                className="fm-deps__line"
                data-hard={line.hard || undefined}
                data-status={line.status}
                d={`M ${line.x1} ${line.y1} C ${line.x1 + mid} ${line.y1}, ${line.x2 - mid} ${line.y2}, ${line.x2} ${line.y2}`}
                markerEnd="url(#fm-dep-map-arrow)"
              />
            );
          })}
        </svg>
        {filteredNodes.map((node) => {
          const place = layout.positions.get(node.id);
          return (
            <button
              key={node.id}
              type="button"
              className="fm-dependency-node"
              role="gridcell"
              data-node={node.id}
              data-hub={node.isHub || undefined}
              data-cycle={node.cycleId !== undefined || undefined}
              style={{
                gridColumn: place?.column ?? 1,
                gridRow: (place?.row ?? 1) + 1,
              }}
              onClick={() => onOpen(node.id)}
            >
              <strong>{node.label}</strong>
              <span>{t(`dependencyMap.node.${node.kind}`)}</span>
              {node.isHub && <b>{t('dependencyMap.hub')}</b>}
              <em>{t('dependencyMap.unresolved', { count: node.unresolvedInDegree })}</em>
              {node.cycleId !== undefined && <i>{t('dependencyMap.showCycle')}</i>}
            </button>
          );
        })}
      </div>
      <div className="fm-m5__table">
        <table>
          <caption>{t('dependencyMap.table')}</caption>
          <thead>
            <tr>
              <th>{t('dependencyMap.source')}</th>
              <th>{t('dependencyMap.type')}</th>
              <th>{t('dependencyMap.target')}</th>
              <th>{t('dependencyMap.status')}</th>
            </tr>
          </thead>
          <tbody>
            {visibleEdges.map((edge) => (
              <tr key={edge.id}>
                <td>{label.get(edge.sourceId) ?? edge.sourceId}</td>
                <td>{t(`dependency.${edge.type}`)}</td>
                <td>{label.get(edge.targetId) ?? edge.targetId}</td>
                <td>{t(`dependencyStatus.${edge.status}`)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function dependencyLayerLabel(index: number, columns: number): string {
  if (columns <= 1) return t('dependencyMap.layerWaiting');
  if (index === 0) return t('dependencyMap.layerWaiting');
  if (index === columns - 1) return t('dependencyMap.layerReady');
  return t('dependencyMap.layerHop', { step: index + 1 });
}

export function ProductsView({
  state,
  onOpen,
  filter,
}: {
  readonly state: WorkspaceState;
  readonly onOpen: (id: string) => void;
  readonly filter: FilterState;
}) {
  const loads = useMemo(
    () =>
      allChangeLoads(state)
        .map((load) => ({
          ...load,
          contributors: load.contributors.filter((contributor) =>
            matchesCommitmentFilter(state, filter, contributor.commitmentId),
          ),
        }))
        .filter((load) => load.contributors.length > 0),
    [state, filter],
  );
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <section className="fm-m5" aria-labelledby="products-title">
      <header className="fm-m5__header">
        <div>
          <h2 id="products-title">{t('products.title')}</h2>
          <p>{t('products.description')}</p>
        </div>
      </header>
      {loads.length === 0 ? (
        <p className="fm-empty">{t('products.noChange')}</p>
      ) : (
        <div className="fm-products">
          {loads.map((load) => (
            <article key={`${load.productServiceId}:${load.quarterId}`} className="fm-product">
              <header>
                <strong>{load.product}</strong>
                <span>{load.quarterId}</span>
                <b data-level={load.level}>{t(`changeLoad.${load.level}`)}</b>
                <em>{t('products.score', { score: load.score })}</em>
                <button
                  type="button"
                  className="fm-quiet"
                  aria-expanded={expanded === `${load.productServiceId}:${load.quarterId}`}
                  onClick={() =>
                    setExpanded((current) =>
                      current === `${load.productServiceId}:${load.quarterId}`
                        ? null
                        : `${load.productServiceId}:${load.quarterId}`,
                    )
                  }
                >
                  {t('products.contributors')}
                </button>
              </header>
              {expanded === `${load.productServiceId}:${load.quarterId}` && (
                <ul>
                  {load.contributors.map((contributor) => (
                    <li key={contributor.commitmentId}>
                      <button
                        type="button"
                        className="fm-link"
                        onClick={() => onOpen(contributor.commitmentId)}
                      >
                        {contributor.commitment}
                      </button>
                      <span>{t(`impact.${contributor.impactType}`)}</span>
                      <strong>{contributor.contribution}</strong>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

/** A theme is an intentional grouping, never a status or another delivery plan. */
export function ThemesView({
  state,
  onOpen,
  filter,
}: {
  readonly state: WorkspaceState;
  readonly onOpen: (id: string) => void;
  readonly filter: FilterState;
}) {
  const themes = useMemo(
    () =>
      [...(state.themes?.values() ?? [])]
        .filter((theme) => theme.archivedAt === undefined)
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((theme) => ({
          theme,
          commitments: [...(state.commitmentThemes?.values() ?? [])]
            .filter((join) => join.archivedAt === undefined && join.themeId === theme.id)
            .map((join) => state.commitments.get(join.commitmentId))
            .filter((commitment): commitment is NonNullable<typeof commitment> =>
              Boolean(commitment && commitment.archivedAt === undefined),
            )
            .filter((commitment) => matchesCommitmentFilter(state, filter, commitment.id))
            .sort((left, right) => left.name.localeCompare(right.name)),
        })),
    [state, filter],
  );
  return (
    <section className="fm-m5" aria-labelledby="themes-title">
      <header className="fm-m5__header">
        <div>
          <h2 id="themes-title">{t('themes.title')}</h2>
          <p>{t('themes.description')}</p>
        </div>
      </header>
      {themes.length === 0 ? (
        <p className="fm-empty">{t('themes.empty')}</p>
      ) : (
        <div className="fm-products">
          {themes.map(({ theme, commitments }) => (
            <article className="fm-product" key={theme.id}>
              <header>
                <strong>{theme.name}</strong>
                <span>{t('themes.count', { count: commitments.length })}</span>
              </header>
              <ul>
                {commitments.map((commitment) => (
                  <li key={commitment.id}>
                    <button type="button" className="fm-link" onClick={() => onOpen(commitment.id)}>
                      {commitment.name}
                    </button>
                    <span>{t(`lifecycle.${commitment.lifecycle}`)}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      )}
      <div className="fm-m5__table">
        <table>
          <caption>{t('themes.table')}</caption>
          <thead>
            <tr>
              <th>{t('themes.name')}</th>
              <th>{t('list.commitment')}</th>
              <th>{t('list.lifecycle')}</th>
            </tr>
          </thead>
          <tbody>
            {themes.flatMap(({ theme, commitments }) =>
              commitments.map((commitment) => (
                <tr key={`${theme.id}:${commitment.id}`}>
                  <td>{theme.name}</td>
                  <td>
                    <button type="button" className="fm-link" onClick={() => onOpen(commitment.id)}>
                      {commitment.name}
                    </button>
                  </td>
                  <td>{t(`lifecycle.${commitment.lifecycle}`)}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function HistoryView({
  state,
  events,
  recommendations,
  onCloseQuarter,
  onReopen,
  filter,
}: {
  readonly state: WorkspaceState;
  readonly events: readonly {
    readonly id: string;
    readonly eventType: string;
    readonly occurredAt: string;
    readonly summaryKey: string;
    readonly facts: Readonly<Record<string, unknown>>;
  }[];
  readonly recommendations: readonly RuleResult[];
  readonly onCloseQuarter: (
    outcomes: readonly QuarterOutcome[],
    carryOver: readonly CarryOverDecision[],
  ) => void;
  readonly onReopen: () => void;
  readonly filter: FilterState;
}) {
  const [reviewing, setReviewing] = useState(false);
  const review = useMemo(() => openQuarterReview(state, state.workspace.currentQuarterId), [state]);
  const proposals = useMemo(
    () => proposeCarryOver(state, state.workspace.currentQuarterId),
    [state],
  );
  const [decisions, setDecisions] = useState<Record<string, boolean>>({});
  const [outcomesByTeam, setOutcomesByTeam] = useState<
    Record<
      string,
      {
        readonly operationalLoad: QuarterOutcome['operationalLoad'];
        readonly capacity: QuarterOutcome['capacity'];
        readonly note: string;
      }
    >
  >({});
  const close = () => {
    const outcomes: QuarterOutcome[] = review.teams.map((team) => {
      const outcome = outcomesByTeam[team.teamId];
      return {
        teamId: team.teamId,
        operationalLoad: outcome?.operationalLoad ?? 'ABOUT',
        capacity: outcome?.capacity ?? 'ABOUT',
        ...(outcome?.note.trim() ? { note: outcome.note.trim() } : {}),
      };
    });
    const carryOver: CarryOverDecision[] = proposals.map((proposal) =>
      decisions[proposal.originFootprintId] === false
        ? { originFootprintId: proposal.originFootprintId, action: 'DECLINE' as const }
        : {
            originFootprintId: proposal.originFootprintId,
            action: 'CARRY' as const,
            destinations: [proposal.defaultDestination],
          },
    );
    onCloseQuarter(outcomes, carryOver);
  };
  const isClosed = [...state.teamQuarters.values()].some(
    (teamQuarter) =>
      teamQuarter.quarterId === state.workspace.currentQuarterId &&
      teamQuarter.closedAt !== undefined,
  );
  return (
    <section className="fm-m5" aria-labelledby="history-title">
      <header className="fm-m5__header">
        <div>
          <h2 id="history-title">{t('history.title')}</h2>
          <p>{t('history.description')}</p>
        </div>
        <div>
          {isClosed ? (
            <button type="button" className="fm-quiet" onClick={onReopen}>
              {t('history.reopen')}
            </button>
          ) : (
            <button type="button" className="fm-primary" onClick={() => setReviewing(true)}>
              {t('history.review', { quarter: state.workspace.currentQuarterId })}
            </button>
          )}
        </div>
      </header>
      {recommendations.length > 0 && (
        <section className="fm-quarter-review" aria-label={t('history.title')}>
          {recommendations.map((recommendation) => (
            <article key={recommendation.signalKey}>
              <strong>{t(`rules.${recommendation.ruleCode}.title`)}</strong>
              <p>{t(`rules.${recommendation.ruleCode}.message`, recommendation.facts)}</p>
              <small>
                {t(`rules.${recommendation.ruleCode}.explanation`, recommendation.facts)}
              </small>
            </article>
          ))}
        </section>
      )}
      {reviewing && (
        <section className="fm-quarter-review" aria-labelledby="quarter-review-title">
          <h3 id="quarter-review-title">
            {t('history.reviewTitle', { quarter: review.quarterId })}
          </h3>
          {review.teams.map((team) => (
            <article key={team.teamId}>
              <strong>{team.team}</strong>
              <dl>
                <div>
                  <dt>{t('list.totalCapacity')}</dt>
                  <dd>{team.finalDeliverableCapacity}</dd>
                </div>
                <div>
                  <dt>{t('list.totalLoad')}</dt>
                  <dd>{team.committedLoadAtClose}</dd>
                </div>
                <div>
                  <dt>{t('history.carryOver')}</dt>
                  <dd>{team.unfinishedCommitmentIds.length}</dd>
                </div>
              </dl>
              <div className="fm-quarter-review__judgements">
                <label>
                  {t('history.operational')}
                  <select
                    value={outcomesByTeam[team.teamId]?.operationalLoad ?? 'ABOUT'}
                    onChange={(event) =>
                      setOutcomesByTeam((current) => ({
                        ...current,
                        [team.teamId]: {
                          operationalLoad: event.target.value as QuarterOutcome['operationalLoad'],
                          capacity: current[team.teamId]?.capacity ?? 'ABOUT',
                          note: current[team.teamId]?.note ?? '',
                        },
                      }))
                    }
                  >
                    {(['BELOW', 'ABOUT', 'ABOVE'] as const).map((value) => (
                      <option key={value} value={value}>
                        {t(`history.${value}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t('history.capacity')}
                  <select
                    value={outcomesByTeam[team.teamId]?.capacity ?? 'ABOUT'}
                    onChange={(event) =>
                      setOutcomesByTeam((current) => ({
                        ...current,
                        [team.teamId]: {
                          operationalLoad: current[team.teamId]?.operationalLoad ?? 'ABOUT',
                          capacity: event.target.value as QuarterOutcome['capacity'],
                          note: current[team.teamId]?.note ?? '',
                        },
                      }))
                    }
                  >
                    {(['LOWER', 'ABOUT', 'HIGHER'] as const).map((value) => (
                      <option key={value} value={value}>
                        {t(`history.${value}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t('history.note')}
                  <textarea
                    rows={2}
                    maxLength={280}
                    value={outcomesByTeam[team.teamId]?.note ?? ''}
                    onChange={(event) =>
                      setOutcomesByTeam((current) => ({
                        ...current,
                        [team.teamId]: {
                          operationalLoad: current[team.teamId]?.operationalLoad ?? 'ABOUT',
                          capacity: current[team.teamId]?.capacity ?? 'ABOUT',
                          note: event.target.value,
                        },
                      }))
                    }
                  />
                </label>
              </div>
            </article>
          ))}
          <h4>{t('history.carryOver')}</h4>
          {proposals.map((proposal) => (
            <label className="fm-quarter-review__proposal" key={proposal.originFootprintId}>
              <span>
                {proposal.commitment} · {proposal.units}
              </span>
              <select
                value={decisions[proposal.originFootprintId] === false ? 'DECLINE' : 'CARRY'}
                onChange={(event) =>
                  setDecisions((current) => ({
                    ...current,
                    [proposal.originFootprintId]: event.target.value === 'CARRY',
                  }))
                }
              >
                <option value="CARRY">{t('history.carry')}</option>
                <option value="DECLINE">{t('history.decline')}</option>
              </select>
            </label>
          ))}
          <p>{t('history.closeNotice')}</p>
          <button type="button" className="fm-primary" onClick={close}>
            {t('history.close')}
          </button>
          <button type="button" className="fm-quiet" onClick={() => setReviewing(false)}>
            {t('action.cancel')}
          </button>
        </section>
      )}
      <div className="fm-m5__table">
        <table>
          <caption>{t('history.events')}</caption>
          <thead>
            <tr>
              <th>{t('field.quarter')}</th>
              <th>{t('history.events')}</th>
            </tr>
          </thead>
          <tbody>
            {events
              .filter(
                (event) =>
                  filter.quarters.length === 0 ||
                  filter.quarters.includes(String(event.facts['quarterId']) as never),
              )
              .map((event) => (
                <tr key={event.id}>
                  <td>{event.occurredAt.slice(0, 10)}</td>
                  <td>{historyEventLabel(event.eventType)}</td>
                </tr>
              ))}
          </tbody>
        </table>
        {events.length === 0 && <p>{t('history.noEvents')}</p>}
      </div>
    </section>
  );
}

function matchesCommitmentFilter(
  state: WorkspaceState,
  filter: FilterState,
  commitmentId: string,
  footprintId?: string,
): boolean {
  const commitment = state.commitments.get(commitmentId);
  if (!commitment || commitment.archivedAt !== undefined) return false;
  const footprint = footprintId ? state.footprints.get(footprintId) : undefined;
  const candidateFootprints = footprint
    ? [footprint]
    : [...state.footprints.values()].filter(
        (item) => item.archivedAt === undefined && item.commitmentId === commitmentId,
      );
  if (
    filter.quarters.length > 0 &&
    !candidateFootprints.some((item) => filter.quarters.includes(item.quarterId))
  )
    return false;
  if (
    filter.teams.length > 0 &&
    !candidateFootprints.some((item) => filter.teams.includes(item.teamId))
  )
    return false;
  if (filter.lifecycles.length > 0 && !filter.lifecycles.includes(commitment.lifecycle))
    return false;
  if (filter.classes.length > 0 && !filter.classes.includes(commitment.class)) return false;
  return (
    filter.text.trim().length === 0 ||
    commitment.name.toLowerCase().includes(filter.text.trim().toLowerCase())
  );
}

function historyEventLabel(eventType: string): string {
  switch (eventType) {
    case 'QUARTER_CLOSED':
      return t('history.eventQuarterClosed');
    case 'QUARTER_REOPENED':
      return t('history.eventQuarterReopened');
    default:
      return t('history.eventChange');
  }
}
