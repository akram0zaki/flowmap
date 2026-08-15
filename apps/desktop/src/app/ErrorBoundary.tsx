/**
 * Error boundary.
 *
 * A crash must never imply data loss, and the copy says so — the store is on
 * disk, and reloading is safe. See docs/design/design-system.md §10 on failure
 * states: explain what happened and what to do, do not apologise.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

import { t } from '../i18n/t.js';

type Props = { children: ReactNode; onError?: (error: Error, info: ErrorInfo) => void };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;

    return (
      <div className="fm-error" role="alert">
        <h1>{t('error.boundary.title')}</h1>
        <p>{t('error.boundary.body')}</p>
        <pre>{this.state.error.message}</pre>
        <button type="button" onClick={() => globalThis.location.reload()}>
          {t('error.boundary.reload')}
        </button>
      </div>
    );
  }
}
