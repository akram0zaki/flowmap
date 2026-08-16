/**
 * The Radar — docs/spec/04-rules-radar.md §6.
 *
 * Grouped by **reason**, not by commitment name. A list sorted by name is a
 * directory of things that are wrong; a list grouped by why they are wrong is a
 * plan for the morning.
 *
 * Every row is rendered from data: the rule supplies facts, the catalogue
 * supplies the words, and there is no per-rule UI code anywhere in this file.
 * That is what "explanations are data" has to mean to be worth anything.
 */

import { useState } from 'react';
import {
  RADAR_GROUPS,
  countBySeverity,
  filterMode,
  groupSignals,
  type Disposition,
  type RadarMode,
  type RuleResult,
  type Severity,
  type SuggestedAction,
} from '@flowmap/rules';

import { t } from '../i18n/t.js';

export type RadarProps = {
  readonly signals: readonly RuleResult[];
  /** Everything, including disposed — so the count can say what is hidden. */
  readonly allSignals: readonly RuleResult[];
  readonly dispositions: ReadonlyMap<string, Disposition>;
  readonly ownedRefs: ReadonlySet<string>;
  readonly today: string;
  readonly mode: RadarMode;
  readonly onModeChange: (mode: RadarMode) => void;
  readonly onAct: (signal: RuleResult, action: SuggestedAction) => void;
  readonly onReview: (signal: RuleResult) => void;
  readonly onSnooze: (signal: RuleResult, until: string) => void;
  readonly onClear: (signal: RuleResult) => void;
  readonly onClose: () => void;
};

/** Snooze presets, per spec §3.3. A snooze always has a return date. */
function snoozePresets(today: string): ReadonlyArray<{ key: string; date: string }> {
  const add = (days: number) => {
    const [y, m, d] = today.split('-').map(Number);
    const at = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days));
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`;
  };

  return [
    { key: 'tomorrow', date: add(1) },
    { key: 'nextWeek', date: add(7) },
    { key: 'nextMonth', date: add(30) },
  ];
}

export function Radar({
  signals,
  allSignals,
  dispositions,
  ownedRefs,
  today,
  mode,
  onModeChange,
  onAct,
  onReview,
  onSnooze,
  onClear,
  onClose,
}: RadarProps) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const shown = filterMode(signals, mode, ownedRefs);
  const groups = groupSignals(shown, today);
  const counts = countBySeverity(shown);
  const hidden = allSignals.length - signals.length;

  return (
    <section className="fm-radar" aria-label={t('radar.label')}>
      <header className="fm-radar__head">
        <div className="fm-radar__modes" role="radiogroup" aria-label={t('radar.mode')}>
          {(['MINE', 'PORTFOLIO'] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={mode === option}
              onClick={() => onModeChange(option)}
            >
              {t(`radar.mode.${option}`)}
            </button>
          ))}
        </div>

        {/* Never colour alone: the counts are words and numbers. */}
        <p className="fm-radar__counts">
          {t('radar.count', { count: shown.length })}
          {counts.HIGH > 0 && ` · ${t('radar.highCount', { count: counts.HIGH })}`}
        </p>

        <button type="button" className="fm-panel__close" onClick={onClose}>
          {t('panel.close')}
        </button>
      </header>

      {/* A hidden count, always. Suppression the user cannot see is suppression
          they cannot trust — and there is no permanent dismissal to hide behind. */}
      {hidden > 0 && <p className="fm-radar__hidden">{t('radar.hidden', { count: hidden })}</p>}

      {groups.length === 0 ? (
        <p className="fm-radar__empty">
          {mode === 'MINE' ? t('radar.emptyMine') : t('radar.empty')}
        </p>
      ) : (
        groups.map((group) => (
          <section key={group.id} className="fm-radar__group">
            <h3>
              {t(`radar.group.${group.id}`)}
              <span className="fm-panel__count">{group.signals.length}</span>
            </h3>

            <ul>
              {group.signals.map((signal) => (
                <RadarRow
                  key={signal.signalKey}
                  signal={signal}
                  today={today}
                  disposition={dispositions.get(signal.signalKey)}
                  expanded={expanded === signal.signalKey}
                  onToggle={() =>
                    setExpanded((current) =>
                      current === signal.signalKey ? null : signal.signalKey,
                    )
                  }
                  onAct={onAct}
                  onReview={onReview}
                  onSnooze={onSnooze}
                  onClear={onClear}
                />
              ))}
            </ul>
          </section>
        ))
      )}

      {/* The order is the product, so it is stated rather than left to be
          inferred from whatever happens to be on screen today. */}
      <p className="fm-radar__order">{t('radar.order', { groups: RADAR_GROUPS.length })}</p>
    </section>
  );
}

function RadarRow({
  signal,
  today,
  disposition,
  expanded,
  onToggle,
  onAct,
  onReview,
  onSnooze,
  onClear,
}: {
  readonly signal: RuleResult;
  readonly today: string;
  readonly disposition: Disposition | undefined;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly onAct: (signal: RuleResult, action: SuggestedAction) => void;
  readonly onReview: (signal: RuleResult) => void;
  readonly onSnooze: (signal: RuleResult, until: string) => void;
  readonly onClear: (signal: RuleResult) => void;
}) {
  const [snoozing, setSnoozing] = useState(false);
  const title = t(`rules.${signal.ruleCode}.title`);
  const message = t(`rules.${signal.ruleCode}.message`, signal.facts);

  return (
    <li className="fm-signal" data-severity={signal.severity} data-disposed={!!disposition}>
      <div className="fm-signal__head">
        {/* Severity as a glyph and a word, never as a colour on its own. */}
        <span className="fm-signal__severity" data-severity={signal.severity}>
          <span aria-hidden="true">{severityGlyph(signal.severity)}</span>
          <span className="fm-visually-hidden">{t(`severity.${lower(signal.severity)}`)}</span>
        </span>

        <button
          type="button"
          className="fm-signal__title"
          aria-expanded={expanded}
          onClick={onToggle}
        >
          <span className="fm-signal__rule">{title}</span>
          <span className="fm-signal__message">{message}</span>
        </button>

        {signal.dueOn && (
          <span className="fm-signal__due" data-overdue={signal.dueOn < today || undefined}>
            {signal.dueOn}
          </span>
        )}
      </div>

      {expanded && (
        <div className="fm-signal__detail">
          <p className="fm-signal__explanation">
            {t(`rules.${signal.ruleCode}.explanation`, signal.facts)}
          </p>

          {/* Why it matters. The part that makes a signal arguable rather than
              merely obeyed. */}
          <p className="fm-signal__why">{t(`rules.${signal.ruleCode}.why`)}</p>

          <FactsTable signal={signal} />

          <div className="fm-signal__actions">
            {signal.actions.map((action, index) => (
              <button key={index} type="button" onClick={() => onAct(signal, action)}>
                {t(`rules.${action.labelKey}`)}
              </button>
            ))}

            {/* Health signals cannot be disposed of — spec §2. A user may
                disagree in writing; the condition stays visible either way. */}
            {!signal.surfaces.includes('HEALTH') &&
              (disposition ? (
                <button type="button" onClick={() => onClear(signal)}>
                  {t('radar.clear')}
                </button>
              ) : (
                <>
                  <button type="button" onClick={() => onReview(signal)}>
                    {t('radar.reviewed')}
                  </button>
                  <button
                    type="button"
                    aria-expanded={snoozing}
                    onClick={() => setSnoozing((v) => !v)}
                  >
                    {t('radar.defer')}
                  </button>
                </>
              ))}
          </div>

          {snoozing && !disposition && (
            <div className="fm-signal__snooze" role="group" aria-label={t('radar.defer')}>
              {snoozePresets(today).map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  onClick={() => {
                    onSnooze(signal, preset.date);
                    setSnoozing(false);
                  }}
                >
                  {t(`radar.snooze.${preset.key}`)}
                </button>
              ))}
            </div>
          )}

          {disposition && (
            <p className="fm-signal__disposed">
              {disposition.disposition === 'SNOOZED'
                ? t('radar.snoozedUntil', { date: disposition.snoozeUntil ?? '' })
                : t('radar.reviewedNote')}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * The facts the rule fired on, and the threshold it compared against.
 *
 * Rendered as a table rather than prose because it is evidence: a lead who
 * disagrees with a signal should be able to see exactly what it read.
 */
function FactsTable({ signal }: { readonly signal: RuleResult }) {
  const facts = Object.entries(signal.facts).filter(([key]) => !key.endsWith('Id'));
  const thresholds = Object.entries(signal.threshold ?? {});

  return (
    <table className="fm-signal__facts">
      <caption className="fm-visually-hidden">{t('radar.facts')}</caption>
      <tbody>
        {facts.map(([key, value]) => (
          <tr key={key}>
            <th scope="row">{key}</th>
            <td>{String(value)}</td>
          </tr>
        ))}
        {thresholds.map(([key, value]) => (
          <tr key={`t-${key}`} className="fm-signal__threshold">
            <th scope="row">{t('radar.threshold', { name: key })}</th>
            <td>{String(value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Shape carries severity alongside colour, so greyscale still reads. */
function severityGlyph(severity: Severity): string {
  switch (severity) {
    case 'HIGH':
      return '▲';
    case 'MEDIUM':
      return '◆';
    case 'LOW':
      return '●';
    case 'INFO':
      return '○';
  }
}

function lower(severity: Severity): string {
  return severity.toLowerCase();
}
