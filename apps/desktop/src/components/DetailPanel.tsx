/**
 * The commitment detail panel.
 *
 * Progressive disclosure, per spec 06 §8: creating an Idea needs a title only,
 * and the panel reveals sections as they gain content, with a way in for the
 * empty ones. Sections in the order the spec sets — Identity, Planning,
 * Outcome, Impact, Attention, Dependencies, Milestones, Links, Management.
 *
 * Every edit is a command. Fields commit on blur rather than on each keystroke,
 * so the undo stack holds decisions rather than typing, and a field that fails
 * validation says so where it was typed instead of in a toast somewhere else.
 */

import { useEffect, useState } from 'react';
import type {
  Commitment,
  CapacityFootprint,
  Confidence,
  Person,
  ProductService,
  QuarterId,
  Team,
} from '@flowmap/domain';

import { Field, Section } from './Field.jsx';
import { QuarterStrip } from './QuarterStrip.jsx';
import { t } from '../i18n/t.js';

export type PanelFootprint = {
  readonly footprint: CapacityFootprint;
  readonly teamName: string;
  readonly percentAfter: number | null;
};

export type DetailPanelProps = {
  readonly commitment: Commitment;
  readonly teams: readonly Team[];
  readonly products: readonly ProductService[];
  readonly people: readonly Person[];
  readonly footprints: readonly PanelFootprint[];
  readonly quarters: readonly QuarterId[];
  readonly currentQuarterId: QuarterId;
  readonly onChange: (patch: Record<string, unknown>) => void;
  readonly onClose: () => void;
};

const CLASSES = ['MANDATORY', 'STRATEGIC', 'OPERATIONAL', 'DISCRETIONARY'] as const;
const IMPORTANCES = ['HIGH', 'MEDIUM', 'LOW'] as const;
const CONFIDENCES: readonly Confidence[] = ['LOW', 'MEDIUM', 'HIGH'];

export function DetailPanel({
  commitment,
  teams,
  people,
  footprints,
  quarters,
  currentQuarterId,
  onChange,
  onClose,
}: DetailPanelProps) {
  const owner = commitment.ownerRef;

  return (
    <aside className="fm-panel" aria-label={t('panel.label', { name: commitment.name })}>
      <header className="fm-panel__head">
        <div>
          <h2>{commitment.name}</h2>
          <p className="fm-panel__lifecycle">
            {t(`lifecycle.${commitment.lifecycle}`)} · {t(`class.${commitment.class}`)}
          </p>
        </div>
        <button type="button" className="fm-panel__close" onClick={onClose}>
          {t('panel.close')}
        </button>
      </header>

      <div className="fm-panel__body">
        <Section title={t('panel.identity')}>
          <Field name="name">
            <TextInput value={commitment.name} onCommit={(name) => onChange({ name })} />
          </Field>

          <Field name="class">
            <Choice
              options={CLASSES}
              value={commitment.class}
              labelFor={(value) => t(`class.${value}`)}
              onChange={(value) => onChange({ class: value })}
            />
          </Field>

          <Field name="importance">
            <Choice
              options={IMPORTANCES}
              value={commitment.importance}
              labelFor={(value) => t(`importance.${value}`)}
              onChange={(value) => onChange({ importance: value })}
            />
          </Field>

          <Field name="primaryTeam">
            <p className="fm-panel__readonly">
              {teams.find((team) => team.id === commitment.primaryTeamId)?.name ?? t('panel.unset')}
              <span className="fm-panel__hint">{t('panel.primaryTeamHint')}</span>
            </p>
          </Field>

          {/* An owner is a reference, not a name: a person or a team. There is
              no UI for creating people yet, so a person owner is shown as
              recorded rather than being silently overwritten by a team. */}
          <Field name="owner">
            {owner?.kind === 'PERSON' ? (
              <p className="fm-panel__readonly">
                {people.find((person) => person.id === owner.personId)?.displayName ??
                  t('panel.unknownPerson')}
                <span className="fm-panel__hint">{t('panel.personOwnerHint')}</span>
              </p>
            ) : (
              <Choice
                options={teams.map((team) => team.id)}
                value={owner?.kind === 'TEAM' ? owner.teamId : undefined}
                labelFor={(id) => teams.find((team) => team.id === id)?.name ?? id}
                onChange={(teamId) =>
                  onChange({ ownerRef: teamId ? { kind: 'TEAM', teamId } : null })
                }
                clearable
              />
            )}
          </Field>
        </Section>

        <Section title={t('panel.planning')}>
          <Field name="targetQuarter">
            <QuarterStrip
              quarters={quarters}
              currentQuarterId={currentQuarterId}
              value={commitment.targetQuarterId}
              onChange={(targetQuarterId) => onChange({ targetQuarterId: targetQuarterId ?? null })}
            />
          </Field>

          <Field name="targetDate">
            <DateInput
              value={commitment.targetDate}
              onCommit={(targetDate) => onChange({ targetDate: targetDate ?? null })}
            />
          </Field>

          {/* Where the work actually sits, and what each placement costs the
              quarter it is in. Read-only here: placement is a drag. */}
          <Field name="units">
            {footprints.length === 0 ? (
              <p className="fm-panel__readonly">{t('panel.notPlaced')}</p>
            ) : (
              <ul className="fm-panel__list">
                {footprints.map(({ footprint, teamName, percentAfter }) => (
                  <li key={footprint.id}>
                    <span>
                      {teamName} · {footprint.quarterId}
                    </span>
                    <span className="fm-panel__figure">
                      {t('capacity.units', { units: footprint.units })}
                      {percentAfter !== null && ` · ${percentAfter}%`}
                    </span>
                    {footprint.carryOverFromQuarterId !== undefined && (
                      <span className="fm-panel__tag">
                        {t('carryover.from', { quarter: footprint.carryOverFromQuarterId })}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Field>

          <Field name="sizeConfidence">
            <Choice
              options={CONFIDENCES}
              value={commitment.sizeConfidence}
              labelFor={(value) => t(`confidence.${value}`)}
              onChange={(value) => onChange({ sizeConfidence: value })}
              clearable
            />
          </Field>
        </Section>

        <Section title={t('panel.outcome')}>
          <Field name="outcome">
            <TextArea
              value={commitment.outcome}
              rows={3}
              placeholder={t('panel.outcomePlaceholder')}
              onCommit={(outcome) => onChange({ outcome: outcome.trim() ? outcome : null })}
            />
          </Field>
        </Section>

        <Section title={t('panel.attention')}>
          <Field name="attentionDate">
            <DateInput
              value={commitment.attentionDate}
              onCommit={(attentionDate) => onChange({ attentionDate: attentionDate ?? null })}
            />
          </Field>

          <Field name="nextAction">
            <TextInput
              value={commitment.nextAction}
              placeholder={t('panel.unset')}
              onCommit={(nextAction) => onChange({ nextAction: nextAction.trim() || null })}
            />
          </Field>

          <Field name="latestSafeStart">
            <DateInput
              value={commitment.latestSafeStart}
              onCommit={(latestSafeStart) => onChange({ latestSafeStart: latestSafeStart ?? null })}
            />
          </Field>
        </Section>

        <Section title={t('panel.management')}>
          <Field name="managementNote">
            <TextArea
              value={commitment.managementNote}
              rows={4}
              maxLength={2000}
              placeholder={t('panel.notePlaceholder')}
              onCommit={(managementNote) =>
                onChange({ managementNote: managementNote.trim() || null })
              }
            />
          </Field>
        </Section>
      </div>
    </aside>
  );
}

/**
 * Commits on blur, not on keystroke.
 *
 * A command per character would fill the undo stack with typing and send a
 * write to storage for every letter. The local value is what you see while you
 * type; the committed value is what the workspace holds.
 */
function TextInput({
  value,
  placeholder,
  onCommit,
}: {
  readonly value: string | undefined;
  readonly placeholder?: string;
  readonly onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value ?? '');
  useEffect(() => setDraft(value ?? ''), [value]);

  return (
    <input
      type="text"
      value={draft}
      {...(placeholder !== undefined ? { placeholder } : {})}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== (value ?? '') && onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') setDraft(value ?? '');
      }}
    />
  );
}

function TextArea({
  value,
  rows,
  maxLength,
  placeholder,
  onCommit,
}: {
  readonly value: string | undefined;
  readonly rows: number;
  readonly maxLength?: number;
  readonly placeholder?: string;
  readonly onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value ?? '');
  useEffect(() => setDraft(value ?? ''), [value]);

  return (
    <>
      <textarea
        rows={rows}
        value={draft}
        {...(maxLength !== undefined ? { maxLength } : {})}
        {...(placeholder !== undefined ? { placeholder } : {})}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft !== (value ?? '') && onCommit(draft)}
      />
      {maxLength !== undefined && (
        <span className="fm-panel__count" aria-hidden="true">
          {draft.length} / {maxLength}
        </span>
      )}
    </>
  );
}

function DateInput({
  value,
  onCommit,
}: {
  readonly value: string | undefined;
  readonly onCommit: (value: string | undefined) => void;
}) {
  return (
    <input
      type="date"
      value={value ?? ''}
      onChange={(e) => onCommit(e.target.value === '' ? undefined : e.target.value)}
    />
  );
}

/** A closed enum as buttons: the whole range is visible without opening anything. */
function Choice<T extends string>({
  options,
  value,
  labelFor,
  onChange,
  clearable,
}: {
  readonly options: readonly T[];
  readonly value: T | undefined;
  readonly labelFor: (value: T) => string;
  readonly onChange: (value: T | null) => void;
  readonly clearable?: boolean;
}) {
  return (
    <div className="fm-choice" role="radiogroup">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          onClick={() => onChange(clearable && value === option ? null : option)}
        >
          {labelFor(option)}
        </button>
      ))}
    </div>
  );
}
