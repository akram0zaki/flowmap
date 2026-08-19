/**
 * Teams lens: team × horizon capacity pressure.
 *
 * Same aggregates as Portfolio Map L1 (spec 02 §3). Different emphasis —
 * no commitment blocks, no Ideas lane, no zoom. Open lands on the matching
 * team-quarter of the Portfolio map.
 */

import { useId, useMemo, useRef, useState, type KeyboardEvent, type CSSProperties } from 'react';
import { type HorizonPreset, type QuarterId, type WorkspaceState } from '@flowmap/domain';
import {
  buildTeamsLens,
  type FilterState,
  type TeamsCell,
  type TeamsRow,
} from '@flowmap/visual-model';

import { t } from '../i18n/t.js';

export function TeamsView({
  state,
  filter,
  onOpenCell,
}: {
  readonly state: WorkspaceState;
  readonly filter: FilterState;
  readonly onOpenCell: (teamId: string, quarterId: QuarterId) => void;
}) {
  const [preset, setPreset] = useState<HorizonPreset>('HORIZON');
  const [cursor, setCursor] = useState({ row: 0, col: 0 });
  const gridRef = useRef<HTMLDivElement>(null);
  const model = useMemo(() => buildTeamsLens(state, preset), [state, preset]);

  const visibleRows = useMemo(
    () =>
      model.rows.filter((row) => {
        const matches = matchesTeamFilter(row, filter);
        return filter.hideFiltered ? matches : true;
      }),
    [model.rows, filter],
  );

  const visibleQuarters = useMemo(
    () =>
      model.quarters.filter((quarterId) => {
        const matches = filter.quarters.length === 0 || filter.quarters.includes(quarterId);
        return filter.hideFiltered ? matches : true;
      }),
    [model.quarters, filter],
  );

  const focusCell = (row: number, col: number) => {
    const next = {
      row: Math.max(0, Math.min(row, visibleRows.length - 1)),
      col: Math.max(0, Math.min(col, visibleQuarters.length - 1)),
    };
    setCursor(next);
    const teamId = visibleRows[next.row]?.teamId;
    const quarterId = visibleQuarters[next.col];
    if (!teamId || !quarterId) return;
    gridRef.current
      ?.querySelector<HTMLButtonElement>(
        `[data-team="${cssEscape(teamId)}"][data-quarter="${cssEscape(quarterId)}"]`,
      )
      ?.focus();
  };

  const onGridKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!(event.target instanceof HTMLElement)) return;
    const origin = event.target.closest<HTMLElement>('[data-team][data-quarter]');
    if (!origin) return;
    const row = visibleRows.findIndex((item) => item.teamId === origin.dataset['team']);
    const col = visibleQuarters.findIndex((item) => item === origin.dataset['quarter']);
    if (row < 0 || col < 0) return;
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        focusCell(row, col + 1);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        focusCell(row, col - 1);
        break;
      case 'ArrowDown':
        event.preventDefault();
        focusCell(row + 1, col);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusCell(row - 1, col);
        break;
      case 'Home':
        event.preventDefault();
        focusCell(event.ctrlKey || event.metaKey ? 0 : row, 0);
        break;
      case 'End':
        event.preventDefault();
        focusCell(
          event.ctrlKey || event.metaKey ? visibleRows.length - 1 : row,
          visibleQuarters.length - 1,
        );
        break;
      default:
        break;
    }
  };

  const empty =
    model.rows.length === 0
      ? t('teams.empty')
      : visibleRows.length === 0
        ? t('teams.filtered')
        : null;

  return (
    <section className="fm-m5" aria-labelledby="teams-title">
      <header className="fm-m5__header">
        <div>
          <h2 id="teams-title">{t('teams.title')}</h2>
          <p>{t('teams.description')}</p>
        </div>
        <div className="fm-m5__controls">
          <label>
            {t('teams.preset')}
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
        </div>
      </header>

      {empty ? (
        <p className="fm-empty">{empty}</p>
      ) : (
        <div
          ref={gridRef}
          className="fm-teams"
          role="grid"
          aria-label={t('teams.grid')}
          style={{ '--fm-cols': visibleQuarters.length } as CSSProperties}
          onKeyDown={onGridKeyDown}
        >
          <div className="fm-teams__row fm-teams__row--head" role="row">
            <div className="fm-teams__corner" role="columnheader">
              {t('list.team')}
            </div>
            {visibleQuarters.map((quarterId) => (
              <div
                key={quarterId}
                className="fm-teams__quarter"
                role="columnheader"
                data-current={quarterId === model.currentQuarterId || undefined}
              >
                {quarterId}
                {quarterId === model.currentQuarterId && <span>{t('map.now')}</span>}
              </div>
            ))}
            <div className="fm-teams__horizon-head" role="columnheader">
              {t('teams.horizon')}
              <ConceptTip name="teamLoad" />
            </div>
          </div>

          {visibleRows.map((row, rowIndex) => {
            const dimmedRow = !matchesTeamFilter(row, filter);
            return (
              <div className="fm-teams__row" role="row" key={row.teamId}>
                <div
                  className="fm-teams__team"
                  role="rowheader"
                  data-dimmed={dimmedRow || undefined}
                >
                  <strong>{row.teamName}</strong>
                  {row.overflowingCells > 0 && (
                    <span>{t('map.rowOverflow', { count: row.overflowingCells })}</span>
                  )}
                </div>
                {visibleQuarters.map((quarterId, colIndex) => {
                  const cell = row.cells.find((item) => item.quarterId === quarterId);
                  if (!cell) return null;
                  const dimmed =
                    dimmedRow ||
                    (filter.quarters.length > 0 && !filter.quarters.includes(quarterId));
                  const selected =
                    Math.min(cursor.row, visibleRows.length - 1) === rowIndex &&
                    Math.min(cursor.col, visibleQuarters.length - 1) === colIndex;
                  return (
                    <div key={cell.quarterId} role="gridcell" className="fm-teams__cell-wrap">
                      <PressureCell
                        cell={cell}
                        current={quarterId === model.currentQuarterId}
                        dimmed={dimmed}
                        tabIndex={selected ? 0 : -1}
                        onFocus={() => setCursor({ row: rowIndex, col: colIndex })}
                        onOpen={() => onOpenCell(cell.teamId, cell.quarterId)}
                      />
                    </div>
                  );
                })}
                <div
                  className="fm-teams__total"
                  role="gridcell"
                  data-over={row.overflowingCells > 0 || undefined}
                  data-dimmed={dimmedRow || undefined}
                >
                  <strong>
                    {row.utilisationPercent === null ? '—' : `${row.utilisationPercent}%`}
                  </strong>
                  <span>{t('teams.rowTotal', { load: row.load, capacity: row.capacity })}</span>
                </div>
              </div>
            );
          })}

          <div className="fm-teams__row fm-teams__row--foot" role="row">
            <div className="fm-teams__team" role="rowheader">
              {t('teams.pressure')}
              <ConceptTip name="portfolioPressure" />
            </div>
            {visibleQuarters.map((quarterId) => {
              const summary = model.quartersSummary.find((item) => item.quarterId === quarterId);
              if (!summary) return null;
              return (
                <div
                  key={quarterId}
                  className="fm-teams__pressure"
                  role="gridcell"
                  data-over={summary.overflowCount > 0 || undefined}
                  data-current={summary.isCurrent || undefined}
                >
                  <strong>
                    {summary.pressurePercent === null
                      ? t('teams.noPressure')
                      : `${summary.pressurePercent}%`}
                  </strong>
                  <span>
                    {summary.overflowCount === 0
                      ? t('teams.quarterClear', { quarter: quarterId })
                      : t('map.rowOverflow', { count: summary.overflowCount })}
                  </span>
                </div>
              );
            })}
            <div
              className="fm-teams__total"
              role="gridcell"
              data-over={model.totals.overflowingCells > 0 || undefined}
            >
              <strong>
                {model.totals.pressurePercent === null
                  ? t('teams.noPressure')
                  : `${model.totals.pressurePercent}%`}
              </strong>
              <span>
                {t('teams.rowTotal', {
                  load: model.totals.load,
                  capacity: model.totals.capacity,
                })}
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="fm-m5__table">
        <table>
          <caption>{t('teams.table')}</caption>
          <thead>
            <tr>
              <th>{t('list.team')}</th>
              <th>{t('list.quarter')}</th>
              <th>{t('list.totalLoad')}</th>
              <th>{t('list.totalCapacity')}</th>
              <th>{t('teams.headroom')}</th>
              <th>{t('fields.utilisation.label')}</th>
              <th>{t('fields.overflow.label')}</th>
              <th>{t('teams.open')}</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.flatMap((row) =>
              visibleQuarters.map((quarterId) => {
                const cell = row.cells.find((item) => item.quarterId === quarterId);
                if (!cell) return null;
                return (
                  <tr key={`${cell.teamId}:${cell.quarterId}`}>
                    <td>{cell.teamName}</td>
                    <td>{cell.quarterId}</td>
                    <td>{cell.planned ? cell.load : '—'}</td>
                    <td>{cell.planned ? cell.capacity : '—'}</td>
                    <td>{cell.headroom === null ? '—' : cell.headroom}</td>
                    <td>
                      {cell.utilisationPercent === null
                        ? t('capacity.noDeliverable')
                        : `${cell.utilisationPercent}%`}
                    </td>
                    <td>{cell.overflow > 0 ? cell.overflow : '—'}</td>
                    <td>
                      <button
                        type="button"
                        className="fm-link"
                        onClick={() => onOpenCell(cell.teamId, cell.quarterId)}
                      >
                        {t('teams.open')}
                      </button>
                    </td>
                  </tr>
                );
              }),
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PressureCell({
  cell,
  current,
  dimmed,
  tabIndex,
  onFocus,
  onOpen,
}: {
  readonly cell: TeamsCell;
  readonly current: boolean;
  readonly dimmed: boolean;
  readonly tabIndex: number;
  readonly onFocus: () => void;
  readonly onOpen: () => void;
}) {
  const over = cell.overflow > 0;
  const percent = cell.utilisationPercent;
  const axisMax = Math.max(100, percent ?? 0);
  const fill =
    cell.capacity > 0 ? Math.min(100, (cell.load / cell.capacity) * (100 / axisMax) * 100) : 0;

  return (
    <button
      type="button"
      className="fm-teams__cell"
      data-team={cell.teamId}
      data-quarter={cell.quarterId}
      data-current={current || undefined}
      data-over={over || undefined}
      data-empty={!cell.planned || undefined}
      data-dimmed={dimmed || undefined}
      tabIndex={tabIndex}
      aria-label={describeCell(cell)}
      onFocus={onFocus}
      onClick={onOpen}
    >
      <span className="fm-teams__figure">
        <strong>{percent === null ? '—' : `${percent}%`}</strong>
        {over && <em>{t('capacity.overBy', { units: cell.overflow })}</em>}
      </span>
      <span
        className="fm-teams__track"
        aria-hidden="true"
        style={
          {
            '--fm-rule-at': `${100 / axisMax}`,
            '--fm-fill': `${fill}%`,
          } as CSSProperties
        }
      >
        <span className="fm-teams__fill" />
        {over && <span className="fm-teams__excess" />}
      </span>
      <span className="fm-teams__meta">
        {cell.planned
          ? t('teams.unitsOf', { load: cell.load, capacity: cell.capacity })
          : t('map.cellIdle')}
      </span>
    </button>
  );
}

function describeCell(cell: TeamsCell): string {
  if (!cell.planned) {
    return t('teams.cellEmpty', { team: cell.teamName, quarter: cell.quarterId });
  }
  if (cell.overflow > 0) {
    return t('teams.cellOver', {
      team: cell.teamName,
      quarter: cell.quarterId,
      utilisation:
        cell.utilisationPercent === null
          ? t('capacity.noDeliverable')
          : t('capacity.utilisation', { percent: cell.utilisationPercent }),
      load: cell.load,
      capacity: cell.capacity,
      overflow: cell.overflow,
    });
  }
  return t('teams.cell', {
    team: cell.teamName,
    quarter: cell.quarterId,
    utilisation:
      cell.utilisationPercent === null
        ? t('capacity.noDeliverable')
        : t('capacity.utilisation', { percent: cell.utilisationPercent }),
    load: cell.load,
    capacity: cell.capacity,
  });
}

function matchesTeamFilter(row: TeamsRow, filter: FilterState): boolean {
  if (filter.teams.length > 0 && !filter.teams.includes(row.teamId)) return false;
  const text = filter.text.trim().toLowerCase();
  return text.length === 0 || row.teamName.toLowerCase().includes(text);
}

function ConceptTip({ name }: { readonly name: string }) {
  const tipId = useId();
  const [open, setOpen] = useState(false);
  const example = t(`fields.${name}.eg`);
  const hasExample = example !== `fields.${name}.eg`;
  return (
    <span className="fm-teams__tip">
      <button
        type="button"
        className="fm-teams__what"
        aria-expanded={open}
        aria-controls={tipId}
        aria-label={t('field.explain', { field: t(`fields.${name}.label`) })}
        onClick={() => setOpen((was) => !was)}
      >
        ?
      </button>
      <span id={tipId} className="fm-field__tip" hidden={!open}>
        <p>{t(`fields.${name}.def`)}</p>
        <p className="fm-field__not">
          <em>{t('field.isNot')}</em> {t(`fields.${name}.not`)}
        </p>
        {hasExample && (
          <p className="fm-field__eg">
            <em>{t('field.example')}</em> {example}
          </p>
        )}
      </span>
    </span>
  );
}

function cssEscape(value: string): string {
  return typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(value)
    : value.replace(/"/g, '\\"');
}
