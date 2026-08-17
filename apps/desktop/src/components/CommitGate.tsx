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
  readonly tradeoff?: {
    readonly constrained: readonly {
      name: string;
      reason: 'MANDATORY' | 'IN_DELIVERY' | 'HARD_DEPENDENCY';
    }[];
    readonly movable: readonly {
      name: string;
      units: number;
      earliestAlternativeQuarter?: string;
    }[];
    readonly crossTeam: readonly { name: string; team: string; quarter: string }[];
    readonly products: readonly { product: string; impact: string }[];
    readonly dependencies: readonly { commitment: string; direction: 'INBOUND' | 'OUTBOUND' }[];
  };
  readonly onCommit: () => void;
  readonly onDismiss: () => void;
};

export function CommitGate({
  name,
  readiness,
  overflow,
  tradeoff,
  onCommit,
  onDismiss,
}: CommitGateProps) {
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
        <>
          <p className="fm-gate__overflow">{t('gate.overflow', { units: overflow })}</p>
          {tradeoff && (
            <section className="fm-tradeoff" aria-label={t('tradeoff.label')}>
              <h4>{t('tradeoff.label')}</h4>
              <p>{t('tradeoff.excess', { units: overflow })}</p>
              <h5>{t('tradeoff.constrained')}</h5>
              <ul>
                {tradeoff.constrained.map((item) => (
                  <li key={`${item.name}:${item.reason}`}>
                    {item.name} · {t(`tradeoff.reason.${item.reason}`)}
                  </li>
                ))}
              </ul>
              <h5>{t('tradeoff.movable')}</h5>
              {tradeoff.movable.length === 0 ? (
                <p>{t('tradeoff.none')}</p>
              ) : (
                <ul>
                  {tradeoff.movable.map((item) => (
                    <li key={item.name}>
                      {item.name} · {item.units}
                      {item.earliestAlternativeQuarter
                        ? ` · ${t('tradeoff.alternative', { quarter: item.earliestAlternativeQuarter })}`
                        : ''}
                    </li>
                  ))}
                </ul>
              )}
              <h5>{t('tradeoff.crossTeam')}</h5>
              <ul>
                {tradeoff.crossTeam.map((item) => (
                  <li key={`${item.name}:${item.team}:${item.quarter}`}>
                    {t('tradeoff.crossTeamItem', item)}
                  </li>
                ))}
              </ul>
              <h5>{t('tradeoff.products')}</h5>
              <ul>
                {tradeoff.products.map((item) => (
                  <li key={`${item.product}:${item.impact}`}>
                    {t('tradeoff.productItem', {
                      product: item.product,
                      impact: t(`impact.${item.impact}`),
                    })}
                  </li>
                ))}
              </ul>
              <h5>{t('tradeoff.dependencies')}</h5>
              <ul>
                {tradeoff.dependencies.map((item) => (
                  <li key={`${item.commitment}:${item.direction}`}>
                    {t('tradeoff.dependencyItem', {
                      commitment: item.commitment,
                      direction: t(`tradeoff.direction.${item.direction}`),
                    })}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
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
