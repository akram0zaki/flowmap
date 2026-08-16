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
  Dependency,
  DependencyType,
  ExternalLink,
  ExternalLinkType,
  GateReadiness,
  Milestone,
  Person,
  ProductImpact,
  ProductImpactType,
  ProductService,
  QuarterId,
  Team,
} from '@flowmap/domain';

import { CommitGate } from './CommitGate.jsx';
import { Field, Section, useFieldGroup, useFieldId } from './Field.jsx';
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
  readonly impacts: readonly ProductImpact[];
  readonly milestones: readonly Milestone[];
  readonly links: readonly ExternalLink[];
  readonly dependencies: readonly Dependency[];
  /** How to name whatever a dependency points at, whichever kind it is. */
  readonly nameOfTarget: (target: Dependency['target']) => string;
  readonly onChange: (patch: Record<string, unknown>) => void;
  readonly onSetImpact: (productServiceId: string, type: ProductImpactType) => void;
  readonly onRemoveImpact: (impactId: string) => void;
  readonly onAddMilestone: (name: string) => void;
  readonly onRemoveMilestone: (milestoneId: string) => void;
  readonly onAddLink: (type: ExternalLinkType, url: string, label: string) => void;
  readonly onRemoveLink: (linkId: string) => void;
  readonly onSetDependencyType: (dependencyId: string, type: DependencyType) => void;
  readonly onRemoveDependency: (dependencyId: string) => void;
  /** The gate, for work that has not passed it yet. */
  readonly gate: {
    readonly readiness: GateReadiness;
    readonly overflow: number;
    readonly onCommit: () => void;
  } | null;
  readonly onClose: () => void;
};

const IMPACT_TYPES: readonly ProductImpactType[] = ['PRIMARY', 'MAJOR', 'MINOR', 'DEPENDENCY'];
const LINK_TYPES: readonly ExternalLinkType[] = [
  'AZURE_DEVOPS',
  'SERVICENOW',
  'SERVICENOW_PPM',
  'CONFLUENCE',
  'FORGE',
  'TEAMS',
  'GENERIC',
];
const DEPENDENCY_TYPES: readonly DependencyType[] = [
  'REQUIRES',
  'BLOCKED_BY',
  'DEPENDS_ON_DELIVERY',
  'NEEDS_CAPACITY_FROM',
  'NEEDS_DECISION_APPROVAL_FROM',
];

const CLASSES = ['MANDATORY', 'STRATEGIC', 'OPERATIONAL', 'DISCRETIONARY'] as const;
const IMPORTANCES = ['HIGH', 'MEDIUM', 'LOW'] as const;
const CONFIDENCES: readonly Confidence[] = ['LOW', 'MEDIUM', 'HIGH'];

export function DetailPanel({
  commitment,
  teams,
  people,
  products,
  footprints,
  quarters,
  currentQuarterId,
  impacts,
  milestones,
  links,
  dependencies,
  nameOfTarget,
  onChange,
  onSetImpact,
  onRemoveImpact,
  onAddMilestone,
  onRemoveMilestone,
  onAddLink,
  onRemoveLink,
  onSetDependencyType,
  onRemoveDependency,
  gate,
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
        {/* First, because for an Idea it is the only question that matters. */}
        {gate && (
          <CommitGate
            name={commitment.name}
            readiness={gate.readiness}
            overflow={gate.overflow}
            onCommit={gate.onCommit}
            onDismiss={onClose}
          />
        )}

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

        {/* Impact. Exactly one product may be PRIMARY — the domain enforces
            it, and the UI shows which one holds it rather than letting you
            discover the rule by being refused. */}
        <Section
          title={t('panel.impact')}
          count={impacts.length}
          addLabel={t('panel.addImpact')}
          onAdd={() => products[0] && onSetImpact(products[0].id, 'MAJOR')}
        >
          <Field name="productImpact">
            <ul className="fm-panel__list">
              {impacts.map((impact) => (
                <li key={impact.id}>
                  <span>
                    {products.find((p) => p.id === impact.productServiceId)?.name ??
                      impact.productServiceId}
                  </span>
                  <Choice
                    options={IMPACT_TYPES}
                    value={impact.type}
                    labelFor={(value) => t(`impact.${value}`)}
                    onChange={(type) => type && onSetImpact(impact.productServiceId, type)}
                  />
                  <RemoveButton
                    label={t('panel.removeImpact')}
                    onClick={() => onRemoveImpact(impact.id)}
                  />
                </li>
              ))}
            </ul>
            {impacts.length > 0 && products.length > impacts.length && (
              <AddFromList
                label={t('panel.addImpact')}
                options={products
                  .filter((p) => !impacts.some((i) => i.productServiceId === p.id))
                  .map((p) => ({ id: p.id, name: p.name }))}
                onPick={(productId: string) => onSetImpact(productId, 'MAJOR')}
              />
            )}
          </Field>
        </Section>

        <Section
          title={t('panel.dependencies')}
          count={dependencies.length}
          addLabel={t('panel.addDependency')}
        >
          <Field name="dependencyType">
            <ul className="fm-panel__list">
              {dependencies.map((dependency) => (
                <li key={dependency.id}>
                  <span>{nameOfTarget(dependency.target)}</span>
                  <Choice
                    options={DEPENDENCY_TYPES}
                    value={dependency.type}
                    labelFor={(value) => t(`dependency.${value}`)}
                    onChange={(type) => type && onSetDependencyType(dependency.id, type)}
                  />
                  <span className="fm-panel__tag">
                    {t(`dependencyStatus.${dependency.status}`)}
                    {dependency.isHard && ` · ${t('dependency.hard')}`}
                  </span>
                  <RemoveButton
                    label={t('panel.removeDependency')}
                    onClick={() => onRemoveDependency(dependency.id)}
                  />
                </li>
              ))}
            </ul>
          </Field>
        </Section>

        {/* Capped at six by the domain, so the list stays a summary rather than
            becoming a project plan. The cap is stated before you hit it. */}
        <Section
          title={t('panel.milestones')}
          count={milestones.length}
          addLabel={t('panel.addMilestone')}
          onAdd={() => onAddMilestone(t('panel.newMilestone'))}
        >
          <Field name="milestone">
            <ul className="fm-panel__list">
              {milestones.map((milestone) => (
                <li key={milestone.id}>
                  <span>{milestone.name}</span>
                  <span className="fm-panel__tag">
                    {milestone.targetDate ?? t('panel.unset')} ·{' '}
                    {t(`milestone.${milestone.status}`)}
                  </span>
                  <RemoveButton
                    label={t('panel.removeMilestone')}
                    onClick={() => onRemoveMilestone(milestone.id)}
                  />
                </li>
              ))}
            </ul>
            {milestones.length > 0 && milestones.length < 6 && (
              <AddText
                label={t('panel.addMilestone')}
                placeholder={t('panel.milestonePlaceholder')}
                onAdd={onAddMilestone}
              />
            )}
            {milestones.length >= 6 && <p className="fm-panel__hint">{t('panel.milestoneCap')}</p>}
          </Field>
        </Section>

        {/* Referenced, never embedded, and https only — the record lives in the
            system it came from and Flowmap stores the address. */}
        <Section
          title={t('panel.links')}
          count={links.length}
          addLabel={t('panel.addLink')}
          onAdd={() => undefined}
        >
          <Field name="externalLink">
            <ul className="fm-panel__list">
              {links.map((link) => (
                <li key={link.id}>
                  <a href={link.url} target="_blank" rel="noreferrer noopener">
                    {link.label ?? link.url}
                  </a>
                  <span className="fm-panel__tag">{t(`linkType.${link.type}`)}</span>
                  <RemoveButton
                    label={t('panel.removeLink')}
                    onClick={() => onRemoveLink(link.id)}
                  />
                </li>
              ))}
            </ul>
            <AddLink types={LINK_TYPES} onAdd={onAddLink} />
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
      {...useFieldId()}
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
        {...useFieldId()}
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
      {...useFieldId()}
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
    <div className="fm-choice" role="radiogroup" {...useFieldGroup()}>
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

/** Removing a relation is a small destructive act; it says what it removes. */
function RemoveButton({
  label,
  onClick,
}: {
  readonly label: string;
  readonly onClick: () => void;
}) {
  return (
    <button type="button" className="fm-panel__remove" aria-label={label} onClick={onClick}>
      ✕
    </button>
  );
}

function AddFromList({
  label,
  options,
  onPick,
}: {
  readonly label: string;
  readonly options: ReadonlyArray<{ id: string; name: string }>;
  readonly onPick: (id: string) => void;
}) {
  return (
    <label className="fm-panel__addrow">
      <span className="fm-visually-hidden">{label}</span>
      <select
        value=""
        onChange={(e) => {
          if (e.target.value) onPick(e.target.value);
        }}
      >
        <option value="">{label}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function AddText({
  label,
  placeholder,
  onAdd,
}: {
  readonly label: string;
  readonly placeholder: string;
  readonly onAdd: (value: string) => void;
}) {
  const [draft, setDraft] = useState('');

  return (
    <div className="fm-panel__addrow">
      <input
        type="text"
        value={draft}
        placeholder={placeholder}
        aria-label={label}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || !draft.trim()) return;
          onAdd(draft.trim());
          setDraft('');
        }}
      />
      <button
        type="button"
        disabled={!draft.trim()}
        onClick={() => {
          onAdd(draft.trim());
          setDraft('');
        }}
      >
        {label}
      </button>
    </div>
  );
}

/**
 * Links are typed and https-only. The domain refuses anything else; refusing
 * here as well means the reason arrives next to the field rather than as a
 * message somewhere else on the screen.
 */
function AddLink({
  types,
  onAdd,
}: {
  readonly types: readonly ExternalLinkType[];
  readonly onAdd: (type: ExternalLinkType, url: string, label: string) => void;
}) {
  const [type, setType] = useState<ExternalLinkType>(types[0]!);
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');

  const insecure = url.trim().length > 0 && !url.startsWith('https://');

  return (
    <div className="fm-panel__addlink">
      <select value={type} onChange={(e) => setType(e.target.value as ExternalLinkType)}>
        {types.map((option) => (
          <option key={option} value={option}>
            {t(`linkType.${option}`)}
          </option>
        ))}
      </select>
      <input
        type="url"
        value={url}
        placeholder="https://"
        aria-label={t('fields.externalLink.label')}
        onChange={(e) => setUrl(e.target.value)}
      />
      <input
        type="text"
        value={label}
        placeholder={t('panel.linkLabelPlaceholder')}
        aria-label={t('panel.linkLabelPlaceholder')}
        onChange={(e) => setLabel(e.target.value)}
      />
      <button
        type="button"
        disabled={insecure || url.trim().length === 0}
        onClick={() => {
          onAdd(type, url.trim(), label.trim());
          setUrl('');
          setLabel('');
        }}
      >
        {t('panel.addLink')}
      </button>
      {insecure && <p className="fm-panel__error">{t('panel.linkMustBeHttps')}</p>}
    </div>
  );
}
