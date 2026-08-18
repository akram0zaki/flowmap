/** Workspace navigation stays explicit: switching never mutates the current portfolio. */

import { useRef, useState } from 'react';

import { t } from '../i18n/t.js';
import { HEADER_MENU_NAME, useDismissibleDetails } from '../state/use-dismissible-details.js';

export type WorkspaceOption = {
  readonly id: string;
  readonly name: string;
  readonly updatedAt: string;
  readonly isSample?: boolean;
};

export type WorkspaceLocation = 'LOCAL' | 'FILE';

export type WorkspaceSwitcherProps = {
  readonly workspaces: readonly WorkspaceOption[];
  readonly archivedWorkspaces: readonly (WorkspaceOption & { readonly archivedAt: string })[];
  readonly activeWorkspaceId: string | null;
  readonly timezone: string;
  readonly onSwitch: (workspaceId: string) => void;
  readonly onCreate: (name: string, location: WorkspaceLocation) => void;
  readonly onArchive: () => void;
  readonly onRestore: (workspaceId: string) => void;
};

export function WorkspaceSwitcher({
  workspaces,
  archivedWorkspaces,
  activeWorkspaceId,
  timezone,
  onSwitch,
  onCreate,
  onArchive,
  onRestore,
}: WorkspaceSwitcherProps) {
  const [name, setName] = useState('');
  const [location, setLocation] = useState<WorkspaceLocation>('LOCAL');
  const menu = useRef<HTMLDetailsElement>(null);
  useDismissibleDetails(menu);
  const ordered = [...workspaces].sort((left, right) => {
    if (Boolean(left.isSample) !== Boolean(right.isSample)) return left.isSample ? 1 : -1;
    return right.updatedAt.localeCompare(left.updatedAt);
  });
  const active = ordered.find((workspace) => workspace.id === activeWorkspaceId);
  const personalCount = workspaces.filter((workspace) => !workspace.isSample).length;
  const canArchive = active !== undefined && !active.isSample && personalCount >= 2;

  return (
    <details
      ref={menu}
      className="fm-header-menu fm-header-menu--context fm-workspace-switcher"
      name={HEADER_MENU_NAME}
    >
      <summary aria-label={t('workspace.current', { name: labelFor(active) })}>
        {labelFor(active)}
      </summary>
      <section aria-label={t('workspace.switch')}>
        <h2>{t('workspace.switch')}</h2>
        <div role="list" className="fm-workspace-switcher__list">
          {ordered.map((workspace) => (
            <div key={workspace.id} role="listitem">
              <button
                type="button"
                aria-pressed={workspace.id === activeWorkspaceId}
                onClick={() => {
                  onSwitch(workspace.id);
                  if (menu.current) menu.current.open = false;
                }}
              >
                {labelFor(workspace)}
              </button>
            </div>
          ))}
        </div>
        <button type="button" onClick={onArchive} disabled={!canArchive}>
          {t('workspace.archive')}
        </button>
        {archivedWorkspaces.length > 0 && (
          <div role="list" className="fm-workspace-switcher__list">
            {archivedWorkspaces.map((workspace) => (
              <div key={workspace.id} role="listitem">
                <button type="button" onClick={() => onRestore(workspace.id)}>
                  {t('workspace.restore', { name: workspace.name })}
                </button>
              </div>
            ))}
          </div>
        )}
        <form
          className="fm-workspace-switcher__create"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim()) return;
            onCreate(name.trim(), location);
            setName('');
          }}
        >
          <label>
            <span>{t('workspace.name')}</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('workspace.nameHint')}
            />
          </label>
          <fieldset className="fm-workspace-switcher__location">
            <legend>{t('workspace.location')}</legend>
            <label>
              <input
                type="radio"
                name="workspace-location"
                checked={location === 'LOCAL'}
                onChange={() => setLocation('LOCAL')}
              />
              {t('workspace.location.local')}
            </label>
            <label>
              <input
                type="radio"
                name="workspace-location"
                checked={location === 'FILE'}
                onChange={() => setLocation('FILE')}
              />
              {t('workspace.location.file')}
            </label>
          </fieldset>
          {location === 'FILE' && <p>{t('workspace.location.fileHint')}</p>}
          <p>{t('workspace.timezone', { timezone })}</p>
          <button type="submit" className="fm-primary">
            {t('workspace.create')}
          </button>
        </form>
      </section>
    </details>
  );
}

function labelFor(workspace: WorkspaceOption | undefined): string {
  if (!workspace) return t('workspace.switch');
  return workspace.isSample ? t('workspace.sampleMark', { name: workspace.name }) : workspace.name;
}
