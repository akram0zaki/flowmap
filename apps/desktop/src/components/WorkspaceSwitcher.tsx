/** Workspace navigation stays explicit: switching never mutates the current portfolio. */

import { useState } from 'react';

import { t } from '../i18n/t.js';

export type WorkspaceOption = {
  readonly id: string;
  readonly name: string;
  readonly updatedAt: string;
};

export type WorkspaceSwitcherProps = {
  readonly workspaces: readonly WorkspaceOption[];
  readonly activeWorkspaceId: string | null;
  readonly timezone: string;
  readonly onSwitch: (workspaceId: string) => void;
  readonly onCreate: (name: string) => void;
};

export function WorkspaceSwitcher({
  workspaces,
  activeWorkspaceId,
  timezone,
  onSwitch,
  onCreate,
}: WorkspaceSwitcherProps) {
  const [name, setName] = useState('');
  const active = workspaces.find((workspace) => workspace.id === activeWorkspaceId);

  return (
    <details className="fm-workspace-switcher">
      <summary>{active?.name ?? t('workspace.switch')}</summary>
      <section aria-label={t('workspace.switch')}>
        <h2>{t('workspace.switch')}</h2>
        <div role="list" className="fm-workspace-switcher__list">
          {workspaces.map((workspace) => (
            <div key={workspace.id} role="listitem">
              <button
                type="button"
                aria-pressed={workspace.id === activeWorkspaceId}
                onClick={() => onSwitch(workspace.id)}
              >
                {workspace.name}
              </button>
            </div>
          ))}
        </div>
        <form
          className="fm-workspace-switcher__create"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim()) return;
            onCreate(name.trim());
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
          <p>{t('workspace.timezone', { timezone })}</p>
          <button type="submit" className="fm-primary">
            {t('workspace.create')}
          </button>
        </form>
      </section>
    </details>
  );
}
