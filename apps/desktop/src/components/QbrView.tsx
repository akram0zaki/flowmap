/**
 * Demand Flow / QBR — spec 05 §6.
 *
 * Ideas stay in the lane until Commit Gate. The pipe sizes and targets them.
 * Containers show baseline, carry-over, and scenario ghosts as separate groups.
 * This is not the Portfolio map: the pipe exists only here.
 */

import { useMemo, useState, type CSSProperties } from 'react';
import { type WorkspaceState } from '@flowmap/domain';
import { buildQbrLens, type FilterState, type QbrCell } from '@flowmap/visual-model';

import { DemandFlow } from './DemandFlow.jsx';
import { t } from '../i18n/t.js';

export function QbrView({
  state,
  filter,
  scenarioId,
  defaultUnits,
  onPlace,
  onOpen,
}: {
  readonly state: WorkspaceState;
  readonly filter: FilterState;
  readonly scenarioId: string | null;
  readonly defaultUnits: number;
  readonly onPlace: (input: {
    commitmentId: string;
    teamId: string;
    quarterId: string;
    units: number;
  }) => void;
  readonly onOpen: (commitmentId: string) => void;
}) {
  const model = useMemo(() => buildQbrLens(state, scenarioId !== null), [state, scenarioId]);
  const [target, setTarget] = useState<{ teamId: string; quarterId: string } | null>(null);

  const rows = model.rows.filter((row) => {
    if (filter.teams.length > 0 && !filter.teams.includes(row.teamId)) return false;
    const text = filter.text.trim().toLowerCase();
    return text.length === 0 || row.teamName.toLowerCase().includes(text);
  });
  const quarters = model.quarters.filter(
    (quarterId) => filter.quarters.length === 0 || filter.quarters.includes(quarterId),
  );

  const ideas = [...state.commitments.values()]
    .filter((item) => item.archivedAt === undefined && item.lifecycle === 'IDEA')
    .map((item) => ({ id: item.id, name: item.name }));
  const teams = rows.map((row) => ({ id: row.teamId, name: row.teamName }));

  const headroomFor = (teamId: string, quarterId: string) => {
    const cell = model.rows
      .find((row) => row.teamId === teamId)
      ?.cells.find((item) => item.quarterId === quarterId);
    if (!cell || !cell.planned) return 0;
    return cell.capacity - cell.committed - cell.carryOver - cell.ghost;
  };

  return (
    <section className="fm-m5" aria-labelledby="qbr-title">
      <header className="fm-m5__header">
        <div>
          <h2 id="qbr-title">{t('qbr.title')}</h2>
          <p>{t('qbr.description')}</p>
        </div>
      </header>

      <DemandFlow
        ideas={ideas}
        teams={
          teams.length > 0
            ? teams
            : model.rows.map((row) => ({ id: row.teamId, name: row.teamName }))
        }
        quarters={model.quarters}
        currentQuarter={model.currentQuarterId}
        scenarioId={scenarioId}
        defaultUnits={defaultUnits}
        headroomFor={headroomFor}
        onPlace={onPlace}
        onOpen={onOpen}
        {...(target ? { targetTeamId: target.teamId, targetQuarterId: target.quarterId } : {})}
        onTargetChange={(teamId, quarterId) => setTarget({ teamId, quarterId })}
      />

      <section className="fm-qbr-summary" aria-label={t('qbr.summary')}>
        <p>{t('qbr.summaryCommitted', { units: model.summary.committed })}</p>
        <p>{t('qbr.summaryCarryOver', { units: model.summary.carryOver })}</p>
        <p>{t('qbr.summaryGhost', { units: model.summary.ghost })}</p>
        {model.summary.overflowingCells > 0 && (
          <p>{t('map.rowOverflow', { count: model.summary.overflowingCells })}</p>
        )}
      </section>

      <div
        className="fm-qbr-board"
        role="grid"
        aria-label={t('qbr.containers')}
        style={{ '--fm-cols': quarters.length } as CSSProperties}
      >
        <div className="fm-qbr-board__row" role="row">
          <div role="columnheader">{t('list.team')}</div>
          {quarters.map((quarterId) => (
            <div
              key={quarterId}
              role="columnheader"
              data-current={quarterId === model.currentQuarterId || undefined}
            >
              {quarterId}
              {quarterId === model.currentQuarterId ? ` · ${t('map.now')}` : ''}
            </div>
          ))}
        </div>
        {rows.map((row) => (
          <div className="fm-qbr-board__row" role="row" key={row.teamId}>
            <div role="rowheader">{row.teamName}</div>
            {quarters.map((quarterId) => {
              const cell = row.cells.find((item) => item.quarterId === quarterId);
              if (!cell) return null;
              const selected =
                target?.teamId === cell.teamId && target.quarterId === cell.quarterId;
              return (
                <div key={quarterId} role="gridcell">
                  <QbrContainer
                    cell={cell}
                    selected={selected}
                    onSelect={() => setTarget({ teamId: cell.teamId, quarterId: cell.quarterId })}
                  />
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="fm-m5__table">
        <table>
          <caption>{t('qbr.table')}</caption>
          <thead>
            <tr>
              <th>{t('list.team')}</th>
              <th>{t('list.quarter')}</th>
              <th>{t('qbr.committed')}</th>
              <th>{t('qbr.carryOver')}</th>
              <th>{t('qbr.newDemand')}</th>
              <th>{t('fields.overflow.label')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.flatMap((row) =>
              quarters.map((quarterId) => {
                const cell = row.cells.find((item) => item.quarterId === quarterId);
                if (!cell) return null;
                return (
                  <tr key={`${cell.teamId}:${cell.quarterId}`}>
                    <td>{cell.teamName}</td>
                    <td>{cell.quarterId}</td>
                    <td>{cell.planned ? cell.committed : '—'}</td>
                    <td>{cell.carryOver || '—'}</td>
                    <td>{cell.ghost || '—'}</td>
                    <td>{cell.overflow || '—'}</td>
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

function QbrContainer({
  cell,
  selected,
  onSelect,
}: {
  readonly cell: QbrCell;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  const total = cell.committed + cell.carryOver + cell.ghost;
  const axis = Math.max(cell.capacity, total, 1);
  const share = (units: number) => `${(units / axis) * 100}%`;
  return (
    <button
      type="button"
      className="fm-qbr-cell"
      data-selected={selected || undefined}
      data-over={cell.overflow > 0 || undefined}
      data-empty={!cell.planned || undefined}
      aria-pressed={selected}
      aria-label={describeQbrCell(cell)}
      onClick={onSelect}
    >
      <span className="fm-qbr-cell__track" aria-hidden="true">
        <span
          className="fm-qbr-cell__band fm-qbr-cell__band--carry"
          style={{ width: share(cell.carryOver) }}
        />
        <span
          className="fm-qbr-cell__band fm-qbr-cell__band--committed"
          style={{ width: share(cell.committed) }}
        />
        <span
          className="fm-qbr-cell__band fm-qbr-cell__band--ghost"
          style={{ width: share(cell.ghost) }}
        />
      </span>
      <span className="fm-qbr-cell__meta">
        {cell.planned
          ? t('qbr.cellMeta', {
              committed: cell.committed,
              carry: cell.carryOver,
              ghost: cell.ghost,
              capacity: cell.capacity,
            })
          : t('map.cellIdle')}
      </span>
      {cell.overflow > 0 && <em>{t('capacity.overBy', { units: cell.overflow })}</em>}
    </button>
  );
}

function describeQbrCell(cell: QbrCell): string {
  if (!cell.planned) {
    return t('teams.cellEmpty', { team: cell.teamName, quarter: cell.quarterId });
  }
  return t('qbr.cell', {
    team: cell.teamName,
    quarter: cell.quarterId,
    committed: cell.committed,
    carry: cell.carryOver,
    ghost: cell.ghost,
    capacity: cell.capacity,
  });
}
