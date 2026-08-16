/**
 * The Commit Gate, shown rather than merely enforced.
 *
 * Two lists that behave completely differently, and the difference is the whole
 * point (spec 02 §5):
 *
 *   **Blockers** stop the transition. Each names the specific thing that is
 *   missing, so the answer is "add a target date", never "not ready".
 *   **Advisories** never stop anything. They are what a good lead would ask
 *   about, offered once and dismissible — a checklist that blocks is a form,
 *   and a form is what this product exists to avoid.
 *
 * Overflow is deliberately in neither list. Committing past capacity is allowed
 * and drawn; the gate's job is completeness, not permission.
 *
 * `assessCommitGate` is the same pure function the handler runs, so this panel
 * and the refusal can never disagree about what is blocking.
 */

import { useState } from 'react';
import type { GateReadiness } from '@flowmap/domain';

import { t } from '../i18n/t.js';

export type CommitGateProps = {
  readonly name: string;
  readonly readiness: GateReadiness;
  /** Units past deliverable capacity if this were committed. Never blocks. */
  readonly overflow: number;
  readonly onCommit: () => void;
  readonly onDismiss: () => void;
};

export function CommitGate({ name, readiness, overflow, onCommit, onDismiss }: CommitGateProps) {
  const [reviewed, setReviewed] = useState(false);

  return (
    <section className="fm-gate" aria-label={t('gate.label', { name })}>
      <h3>{t('gate.title')}</h3>

      {readiness.blockers.length > 0 ? (
        <>
          <p className="fm-gate__verdict" data-blocked="">
            {t('gate.blocked', { count: readiness.blockers.length })}
          </p>
          <ul className="fm-gate__blockers">
            {readiness.blockers.map((code) => (
              <li key={code}>{t(`errors.${code}`)}</li>
            ))}
          </ul>
        </>
      ) : (
        <p className="fm-gate__verdict">{t('gate.ready')}</p>
      )}

      {readiness.advisories.length > 0 && (
        <>
          <p className="fm-gate__advisoryHead">{t('gate.advisories')}</p>
          <ul className="fm-gate__advisories">
            {readiness.advisories.map((code) => (
              <li key={code}>{t(`errors.${code}`)}</li>
            ))}
          </ul>
        </>
      )}

      {/* Stated, not prevented. A lead who can see the number and commits
          anyway has made a decision; hiding it would make it an accident. */}
      {overflow > 0 && (
        <p className="fm-gate__overflow">{t('gate.overflow', { units: overflow })}</p>
      )}

      <label className="fm-gate__reviewed">
        <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
        {t('gate.dependenciesReviewed')}
      </label>

      <div className="fm-gate__actions">
        <button
          type="button"
          className="fm-primary"
          disabled={readiness.blockers.length > 0}
          onClick={onCommit}
        >
          {t('gate.commit')}
        </button>
        <button type="button" onClick={onDismiss}>
          {t('gate.notYet')}
        </button>
      </div>
    </section>
  );
}
