/**
 * Editing what a team-quarter is built from.
 *
 * Reserves are the part of a quarter spoken for before anyone commits anything,
 * and they are what makes deliverable capacity smaller than the headline
 * figure. Every utilisation percentage on the board is measured against that
 * smaller number, so until these were editable a team whose BAU is really 30
 * had no way to say so and every figure it showed was wrong by a fifth.
 *
 * Three levels, and the panel is laid out as the sentence they make:
 *
 *   workspace defaults → this team's defaults → this quarter
 *
 * Each is the starting point for the next, and each is a copy taken once. A
 * default is what a *new* container starts from, never a live reference — which
 * is why changing one shows you how many existing quarters it will not touch,
 * and offers to write it onto them as a separate, explicit decision.
 *
 * See docs/spec/02-capacity-model.md §5 and 03-commands-permissions.md §3.1–3.2.
 */

import { useMemo, useState } from 'react';

import type { EntityId, ReserveInput, ReserveType, WorkspaceState } from '@flowmap/domain';

import { t } from '../i18n/t.js';

/** `HOLD` is created and removed by holding work, never by a person. */
const EDITABLE_TYPES: readonly ReserveType[] = [
  'BAU_SUPPORT',
  'REFINEMENT',
  'LCM',
  'OVERHEAD',
  'OTHER',
];

export type CapacitySettingsProps = {
  readonly state: WorkspaceState;
  readonly onSaveDefaults: (input: {
    defaultTeamQuarterCapacity: number;
    reserves: readonly ReserveInput[];
  }) => void;
  readonly onSaveTeam: (input: {
    teamId: EntityId;
    defaultQuarterCapacity: number;
    reserves: readonly ReserveInput[] | null;
    applyToOpenQuarters: boolean;
  }) => void;
  readonly onSaveQuarter: (teamQuarterId: EntityId, reserves: readonly ReserveInput[]) => void;
  /**
   * Which levels to show. `TEAM` is the same editor opened from a team's own
   * row — the workspace defaults are not that team's business at that moment,
   * and reaching this from the board should not mean reading past them.
   */
  readonly scope?: 'ALL' | 'TEAM';
  /** The team to start on. Defaults to the first. */
  readonly teamId?: EntityId;
};

/** A row being edited. Amounts are strings so a half-typed number is not zero. */
type Row = { readonly type: ReserveType; readonly label: string; readonly amount: string };

const toRows = (reserves: readonly { type: ReserveType; label: string; amount: number }[]): Row[] =>
  reserves.map((reserve) => ({
    type: reserve.type,
    label: reserve.label,
    amount: String(reserve.amount),
  }));

const toInput = (rows: readonly Row[]): ReserveInput[] =>
  rows.map((row) => ({ type: row.type, label: row.label, amount: Number(row.amount) }));

const total = (rows: readonly Row[]): number =>
  rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);

export function CapacitySettings({
  state,
  onSaveDefaults,
  onSaveTeam,
  onSaveQuarter,
  scope = 'ALL',
  teamId: initialTeamId,
}: CapacitySettingsProps) {
  const teams = useMemo(
    () =>
      [...state.teams.values()]
        .filter((team) => team.archivedAt === undefined)
        .sort((a, b) => a.displayOrder - b.displayOrder),
    [state.teams],
  );

  const defaults = state.workspace.settings.capacity;
  const [wsCapacity, setWsCapacity] = useState(String(defaults.defaultTeamQuarterCapacity));
  const [wsRows, setWsRows] = useState<Row[]>(() => toRows(defaults.defaultReserves));

  const [teamId, setTeamId] = useState<EntityId | ''>(initialTeamId ?? teams[0]?.id ?? '');
  const team = teams.find((candidate) => candidate.id === teamId);
  const [overrides, setOverrides] = useState(team?.defaultReserves !== undefined);
  const [teamCapacity, setTeamCapacity] = useState(String(team?.defaultQuarterCapacity ?? ''));
  const [teamRows, setTeamRows] = useState<Row[]>(() =>
    toRows(team?.defaultReserves ?? defaults.defaultReserves),
  );
  const [retrofit, setRetrofit] = useState(false);

  /** Reloads the team editor when the chosen team changes. */
  const chooseTeam = (id: EntityId) => {
    const next = teams.find((candidate) => candidate.id === id);
    setTeamId(id);
    setOverrides(next?.defaultReserves !== undefined);
    setTeamCapacity(String(next?.defaultQuarterCapacity ?? ''));
    setTeamRows(toRows(next?.defaultReserves ?? defaults.defaultReserves));
    setRetrofit(false);
  };

  // Open quarters only. A closed one is history, and the domain will not edit it.
  const openQuarters = useMemo(
    () =>
      [...state.teamQuarters.values()]
        .filter(
          (teamQuarter) =>
            teamQuarter.teamId === teamId &&
            teamQuarter.closedAt === undefined &&
            teamQuarter.archivedAt === undefined,
        )
        .sort((a, b) => a.quarterId.localeCompare(b.quarterId)),
    [state.teamQuarters, teamId],
  );

  return (
    <div className="fm-capacity" data-scope={scope === 'TEAM' ? 'team' : undefined}>
      {scope === 'ALL' && (
        <>
          <h3>{t('capacitySettings.title')}</h3>
          <p>{t('capacitySettings.description')}</p>

          <ReserveForm
            legend={t('capacitySettings.workspace')}
            note={t('capacitySettings.workspaceNote')}
            capacity={wsCapacity}
            onCapacity={setWsCapacity}
            rows={wsRows}
            onRows={setWsRows}
            onSave={() =>
              onSaveDefaults({
                defaultTeamQuarterCapacity: Number(wsCapacity),
                reserves: toInput(wsRows),
              })
            }
          />
        </>
      )}

      {team && (
        <fieldset className="fm-capacity__group">
          <legend>{scope === 'TEAM' ? team.name : t('capacitySettings.team')}</legend>
          {/* No picker when the editor was opened from one team's own row: the
              team is the reason you are here, not a choice to make again. */}
          {scope === 'ALL' && (
            <label className="fm-capacity__pick">
              {t('list.team')}
              <select value={teamId} onChange={(event) => chooseTeam(event.target.value)}>
                {teams.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {/* Absent, not empty. "This team reserves nothing" is a different
              statement from "this team follows the workspace", and only one of
              them is a default. */}
          <label className="fm-capacity__follows">
            <input
              type="checkbox"
              checked={!overrides}
              onChange={(event) => {
                setOverrides(!event.target.checked);
                if (event.target.checked) setTeamRows(toRows(defaults.defaultReserves));
              }}
            />
            {t('capacitySettings.follows')}
          </label>

          <ReserveForm
            capacity={teamCapacity}
            onCapacity={setTeamCapacity}
            rows={teamRows}
            onRows={setTeamRows}
            disabled={!overrides}
            note={t('capacitySettings.teamNote', { name: team.name })}
            extra={
              openQuarters.length > 0 && (
                <label className="fm-capacity__retrofit">
                  <input
                    type="checkbox"
                    checked={retrofit}
                    onChange={(event) => setRetrofit(event.target.checked)}
                  />
                  {t('capacitySettings.retrofit', {
                    count: openQuarters.length,
                    name: team.name,
                  })}
                </label>
              )
            }
            onSave={() =>
              onSaveTeam({
                teamId: team.id,
                defaultQuarterCapacity: Number(teamCapacity),
                reserves: overrides ? toInput(teamRows) : null,
                applyToOpenQuarters: retrofit,
              })
            }
          />
        </fieldset>
      )}

      {team && openQuarters.length > 0 && (
        <fieldset className="fm-capacity__group">
          <legend>{t('capacitySettings.quarters', { name: team.name })}</legend>
          <p>{t('capacitySettings.quartersNote')}</p>
          {openQuarters.map((teamQuarter) => (
            <QuarterRow
              key={teamQuarter.id}
              quarterId={teamQuarter.quarterId}
              capacity={teamQuarter.capacityBaseline + teamQuarter.capacityAdjustment}
              reserves={teamQuarter.reserves.filter((reserve) => !reserve.systemManaged)}
              onSave={(reserves) => onSaveQuarter(teamQuarter.id, reserves)}
            />
          ))}
        </fieldset>
      )}
    </div>
  );
}

type ReserveFormProps = {
  readonly legend?: string;
  readonly note: string;
  readonly capacity: string;
  readonly onCapacity: (value: string) => void;
  readonly rows: readonly Row[];
  readonly onRows: (rows: Row[]) => void;
  readonly disabled?: boolean;
  readonly extra?: React.ReactNode;
  readonly onSave: () => void;
};

function ReserveForm({
  legend,
  note,
  capacity,
  onCapacity,
  rows,
  onRows,
  disabled = false,
  extra,
  onSave,
}: ReserveFormProps) {
  const reserved = total(rows);
  const available = Number(capacity) || 0;
  // Shown, not enforced here: the handler is the authority and refuses it. What
  // this does is stop you finding out after you press the button.
  const overReserved = reserved > available;
  const spare = EDITABLE_TYPES.filter((type) => !rows.some((row) => row.type === type));

  const body = (
    <>
      <p className="fm-capacity__note">{note}</p>
      <label className="fm-capacity__capacity">
        {t('capacitySettings.capacity')}
        <input
          type="number"
          min="1"
          value={capacity}
          disabled={disabled}
          onChange={(event) => onCapacity(event.target.value)}
        />
      </label>

      <ul className="fm-capacity__rows">
        {rows.map((row, index) => (
          <li key={row.type}>
            <input
              type="text"
              value={row.label}
              disabled={disabled}
              aria-label={t('capacitySettings.label', { type: t(`reserve.${row.type}`) })}
              onChange={(event) =>
                onRows(rows.map((r, i) => (i === index ? { ...r, label: event.target.value } : r)))
              }
            />
            <input
              type="number"
              min="0"
              value={row.amount}
              disabled={disabled}
              aria-label={t('capacitySettings.amount', { type: t(`reserve.${row.type}`) })}
              onChange={(event) =>
                onRows(rows.map((r, i) => (i === index ? { ...r, amount: event.target.value } : r)))
              }
            />
            <button
              type="button"
              className="fm-quiet"
              disabled={disabled}
              aria-label={t('capacitySettings.remove', { type: t(`reserve.${row.type}`) })}
              onClick={() => onRows(rows.filter((_, i) => i !== index))}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>

      {spare.length > 0 && !disabled && (
        <label className="fm-capacity__add">
          {t('capacitySettings.add')}
          <select
            value=""
            onChange={(event) => {
              const type = event.target.value as ReserveType;
              if (type) onRows([...rows, { type, label: t(`reserve.${type}`), amount: '0' }]);
            }}
          >
            <option value="">{t('capacitySettings.add')}</option>
            {spare.map((type) => (
              <option key={type} value={type}>
                {t(`reserve.${type}`)}
              </option>
            ))}
          </select>
        </label>
      )}

      {/* The figure the board will actually measure against, worked out while
          you type. It is the whole reason for this panel. */}
      <p className="fm-capacity__deliverable" data-over={overReserved || undefined}>
        {overReserved
          ? t('capacitySettings.overReserved', { reserved, capacity: available })
          : t('capacitySettings.deliverable', {
              units: available - reserved,
              capacity: available,
              reserved,
            })}
      </p>

      {extra}

      <button type="button" className="fm-primary" disabled={overReserved} onClick={onSave}>
        {t('capacitySettings.save')}
      </button>
    </>
  );

  return legend ? (
    <fieldset className="fm-capacity__group">
      <legend>{legend}</legend>
      {body}
    </fieldset>
  ) : (
    <div className="fm-capacity__group fm-capacity__group--plain">{body}</div>
  );
}

function QuarterRow({
  quarterId,
  capacity,
  reserves,
  onSave,
}: {
  readonly quarterId: string;
  readonly capacity: number;
  readonly reserves: readonly { type: ReserveType; label: string; amount: number }[];
  readonly onSave: (reserves: readonly ReserveInput[]) => void;
}) {
  const [rows, setRows] = useState<Row[]>(() => toRows(reserves));
  const reserved = total(rows);
  const overReserved = reserved > capacity;

  return (
    <div className="fm-capacity__quarter">
      <strong>{quarterId}</strong>
      {rows.map((row, index) => (
        <label key={row.type}>
          {row.label}
          <input
            type="number"
            min="0"
            value={row.amount}
            aria-label={t('capacitySettings.quarterAmount', {
              quarter: quarterId,
              type: t(`reserve.${row.type}`),
            })}
            onChange={(event) =>
              setRows(rows.map((r, i) => (i === index ? { ...r, amount: event.target.value } : r)))
            }
          />
        </label>
      ))}
      <span className="fm-capacity__deliverable" data-over={overReserved || undefined}>
        {t('capacitySettings.deliverableShort', { units: capacity - reserved })}
      </span>
      <button
        type="button"
        className="fm-quiet"
        disabled={overReserved}
        onClick={() => onSave(toInput(rows))}
      >
        {t('capacitySettings.save')}
      </button>
    </div>
  );
}
