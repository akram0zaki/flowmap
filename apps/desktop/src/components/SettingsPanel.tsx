/**
 * Instance settings: where data lives, which WebView is in use, and how to
 * make this copy fully portable (spec 10 §3.1–3.2).
 */

import type { Runtime } from '../state/workspace-store.js';
import { t } from '../i18n/t.js';
import { Field } from './Field.jsx';

export type SettingsPanelProps = {
  readonly runtime: Runtime;
  readonly shared?: boolean;
  readonly onClearLocalData: () => void;
  readonly onClose: () => void;
};

export function SettingsPanel({
  runtime,
  shared = false,
  onClearLocalData,
  onClose,
}: SettingsPanelProps) {
  const version = runtime.version ?? t('settings.versionUnknown');
  const webview = runtime.webview ?? 'browser';
  const modeKey = modeMessageKey(runtime);

  return (
    <div className="fm-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="fm-dialog fm-settings"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <header className="fm-panel__head">
          <h2 id="settings-title">{t('settings.title')}</h2>
          <button type="button" className="fm-panel__close" onClick={onClose}>
            {t('settings.close')}
          </button>
        </header>

        <p>{t('settings.version', { version })}</p>

        <Field name="dataDirectory">
          {runtime.dataDir ? (
            <p className="fm-settings__path">
              <code>{runtime.dataDir}</code>
            </p>
          ) : (
            <p>{t('settings.mode.browserNote')}</p>
          )}
        </Field>

        {runtime.workspacesDir && (
          <p>
            <span className="fm-settings__label">{t('settings.workspacesDir')}</span>
            <code className="fm-settings__path">{runtime.workspacesDir}</code>
          </p>
        )}
        {runtime.logsDir && (
          <p>
            <span className="fm-settings__label">{t('settings.logsDir')}</span>
            <code className="fm-settings__path">{runtime.logsDir}</code>
          </p>
        )}

        <Field name="portableMode">
          <p>{t(modeKey)}</p>
        </Field>
        <p>{t(runtime.dataDir ? 'settings.portableHow' : 'settings.portableHow.browser')}</p>

        <p>
          <span className="fm-settings__label">{t('settings.webview')}</span>
          {t(`settings.webview.${webview}`)}
        </p>
        {webview !== 'wkwebview' && <p>{t('settings.webview.missingHint', { version })}</p>}

        <h3>{t('settings.rolesTitle')}</h3>
        <p>{t('settings.rolesAdvisory')}</p>
        {shared && <p>{t('settings.filePropagation')}</p>}

        <div className="fm-dialog__actions">
          <button type="button" className="fm-danger" onClick={onClearLocalData}>
            {t('action.clearLocalData')}
          </button>
        </div>
      </section>
    </div>
  );
}

function modeMessageKey(runtime: Runtime): string {
  if (!runtime.dataDir) return 'settings.mode.browser';
  if (runtime.portableSource === 'ENV') return 'settings.mode.portableEnv';
  if (runtime.portableSource === 'BESIDE_EXE' || runtime.portable) {
    return 'settings.mode.portableBeside';
  }
  return 'settings.mode.appData';
}
