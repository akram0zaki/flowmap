/**
 * Rule settings — docs/spec/04-rules-radar.md §7.
 *
 * Each rule shows its plain-language definition, its current threshold, and
 * **how many signals it is producing right now** — so tuning is evidence-based
 * rather than a guess followed by a week of wondering.
 *
 * Out-of-range values are rejected with the permitted range stated, never
 * silently clamped: a lead who thinks they set 400 and got 90 will plan against
 * the wrong number for a quarter.
 */

import { useState } from 'react';
import {
  allowedSeverities,
  describeSettings,
  resetAll,
  resetRule,
  validateSettings,
  type RuleCode,
  type RuleSettings as Settings,
  type SettingsProblem,
  type Severity,
} from '@flowmap/rules';

import { t } from '../i18n/t.js';

export type RuleSettingsProps = {
  readonly settings: Settings;
  /** Live counts per rule, from the current evaluation. */
  readonly counts: ReadonlyMap<string, number>;
  readonly onChange: (settings: Settings) => void;
  readonly onClose: () => void;
};

export function RuleSettings({ settings, counts, onChange, onClose }: RuleSettingsProps) {
  const [problems, setProblems] = useState<readonly SettingsProblem[]>([]);
  const rows = describeSettings(settings);

  function apply(next: Settings) {
    const found = validateSettings(next);
    setProblems(found);
    // Rejected outright rather than clamped — the value the user typed is not
    // quietly replaced by a different one.
    if (found.length === 0) onChange(next);
  }

  const problemFor = (code: RuleCode, name?: string) =>
    problems.find(
      (p) =>
        'ruleCode' in p &&
        p.ruleCode === code &&
        (name === undefined || !('name' in p) || p.name === name),
    );

  return (
    <section className="fm-rulesettings" aria-label={t('settings.rules')}>
      <header className="fm-panel__head">
        <h2>{t('settings.rules')}</h2>
        <div>
          <button
            type="button"
            onClick={() => {
              setProblems([]);
              onChange(resetAll());
            }}
          >
            {t('settings.resetAll')}
          </button>
          <button type="button" className="fm-panel__close" onClick={onClose}>
            {t('panel.close')}
          </button>
        </div>
      </header>

      <p className="fm-rulesettings__note">{t('settings.rulesNote')}</p>

      <ul className="fm-rulesettings__list">
        {rows.map((row) => {
          const count = counts.get(row.code) ?? 0;

          return (
            <li key={row.code} className="fm-rulesettings__rule" data-enabled={row.enabled}>
              <div className="fm-rulesettings__head">
                <h3>{t(`rules.${row.code}.title`)}</h3>
                {/* Evidence, not a promise: what this rule is doing right now. */}
                <span className="fm-rulesettings__count" data-zero={count === 0 || undefined}>
                  {t('settings.firingNow', { count })}
                </span>
              </div>

              <p className="fm-rulesettings__why">{t(`rules.${row.code}.why`)}</p>

              <div className="fm-rulesettings__controls">
                <label className="fm-rulesettings__toggle">
                  <input
                    type="checkbox"
                    checked={row.enabled}
                    disabled={!row.canDisable}
                    onChange={(e) =>
                      apply({
                        ...settings,
                        enabled: { ...settings.enabled, [row.code]: e.target.checked },
                      })
                    }
                  />
                  <span>{t('settings.enabled')}</span>
                </label>

                {/* Integrity and high-severity capacity rules stay on. Saying so
                    is better than a control that silently does nothing. */}
                {!row.canDisable && (
                  <span className="fm-rulesettings__locked">{t('settings.cannotDisable')}</span>
                )}

                <label className="fm-rulesettings__severity">
                  <span>{t('settings.severity')}</span>
                  <select
                    value={row.severity}
                    onChange={(e) =>
                      apply({
                        ...settings,
                        severityOverrides: {
                          ...settings.severityOverrides,
                          [row.code]: e.target.value as Severity,
                        },
                      })
                    }
                  >
                    {allowedSeverities(row.code).map((severity) => (
                      <option key={severity} value={severity}>
                        {t(`severity.${severity.toLowerCase()}`)}
                      </option>
                    ))}
                  </select>
                </label>

                {row.thresholds.map((threshold) => {
                  const problem = problemFor(row.code, threshold.name);
                  return (
                    <label key={threshold.name} className="fm-rulesettings__threshold">
                      <span>{t(`settings.threshold.${threshold.name}`)}</span>
                      <input
                        type="number"
                        value={threshold.value}
                        min={threshold.min}
                        max={threshold.max}
                        step={threshold.max <= 1 ? 0.01 : 1}
                        aria-describedby={
                          problem ? `${row.code}-${threshold.name}-error` : undefined
                        }
                        onChange={(e) =>
                          apply({
                            ...settings,
                            thresholds: {
                              ...settings.thresholds,
                              [row.code]: {
                                ...(settings.thresholds[row.code] ?? {}),
                                [threshold.name]: Number(e.target.value),
                              },
                            },
                          })
                        }
                      />
                      {/* The permitted range, always visible — not only once it
                          has been breached. */}
                      <span className="fm-rulesettings__range">
                        {t('settings.range', { min: threshold.min, max: threshold.max })}
                        {!threshold.isDefault &&
                          ` · ${t('settings.default', { value: threshold.defaultValue })}`}
                      </span>
                      {problem?.kind === 'OUT_OF_RANGE' && (
                        <span
                          id={`${row.code}-${threshold.name}-error`}
                          className="fm-panel__error"
                          role="alert"
                        >
                          {t('settings.outOfRange', {
                            value: problem.value,
                            min: problem.min,
                            max: problem.max,
                          })}
                        </span>
                      )}
                    </label>
                  );
                })}

                {(row.thresholds.some((th) => !th.isDefault) || row.severityOverride) && (
                  <button
                    type="button"
                    onClick={() => {
                      setProblems([]);
                      onChange(resetRule(settings, row.code));
                    }}
                  >
                    {t('settings.reset')}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
