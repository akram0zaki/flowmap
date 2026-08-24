/**
 * One team's default allocations, opened from its own row in the Teams lens.
 *
 * The same editor as Settings ▸ Capacity, scoped to the team you were already
 * looking at. Reaching a team's BAU figure should not mean opening a dialog
 * about where the database lives and scrolling past the workspace defaults to
 * find a picker for the team whose row you just clicked.
 */

import { useEffect, useRef } from 'react';

import type { EntityId, ReserveInput, WorkspaceState } from '@flowmap/domain';

import { t } from '../i18n/t.js';
import { CapacitySettings } from './CapacitySettings.jsx';

export type TeamCapacityDialogProps = {
  readonly state: WorkspaceState;
  readonly teamId: EntityId;
  readonly onSave: (input: {
    teamId: EntityId;
    defaultQuarterCapacity: number;
    reserves: readonly ReserveInput[] | null;
    applyToOpenQuarters: boolean;
  }) => void;
  readonly onSaveQuarter: (teamQuarterId: EntityId, reserves: readonly ReserveInput[]) => void;
  readonly onClose: () => void;
};

export function TeamCapacityDialog({
  state,
  teamId,
  onSave,
  onSaveQuarter,
  onClose,
}: TeamCapacityDialogProps) {
  const close = useRef<HTMLButtonElement>(null);
  // Focus lands inside the dialog, not behind it. Close rather than the first
  // field: the amounts are a form you may only be here to read.
  useEffect(() => close.current?.focus(), []);

  const team = state.teams.get(teamId);
  if (!team) return null;

  return (
    <div className="fm-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="fm-dialog fm-team-capacity"
        role="dialog"
        aria-modal="true"
        aria-labelledby="team-capacity-title"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <header className="fm-panel__head">
          <h2 id="team-capacity-title">{t('team.settingsTitle', { team: team.name })}</h2>
          <button ref={close} type="button" className="fm-panel__close" onClick={onClose}>
            {t('panel.close')}
          </button>
        </header>

        <CapacitySettings
          state={state}
          scope="TEAM"
          teamId={teamId}
          // Unreachable in this scope — the workspace section is not rendered —
          // but the prop is required, and a lie would be worse than a no-op.
          onSaveDefaults={() => undefined}
          onSaveTeam={onSave}
          onSaveQuarter={onSaveQuarter}
        />
      </section>
    </div>
  );
}
