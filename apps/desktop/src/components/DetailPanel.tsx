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
  Theme,
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
  /** The workspace's agreed list. Value drivers are chosen from it, never typed. */
  readonly valueDrivers: readonly string[];
  readonly themes: readonly Theme[];
  readonly commitmentThemeIds: readonly string[];
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
  /** Full-set replace: the ticked labels are the answer. */
  readonly onSetThemes: (themeIds: readonly string[]) => void;
  /** Themes are a workspace taxonomy, so creating one is a Planner action. */
  readonly onCreateTheme: (name: string) => void;
  /** Divide a placement across quarters, keeping the total the same. */
  readonly onSplit: (footprintId: string, toQuarterId: QuarterId, units: number) => void;
  /** Hands the address to the operating system. Never navigated to in-app. */
  readonly onOpenLink: (url: string) => void;
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
  valueDrivers,
  themes,
  commitmentThemeIds,
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
  onSetThemes,
  onCreateTheme,
  onSplit,
  onOpenLink,
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
              <ul className="fm-panel__list fm-panel__list--placements">
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

          {/* Splitting is a different statement from resizing or moving: the
              work happens in both quarters, and the total does not change.
              Kept next to the placements because that is what it acts on. */}
          {footprints.length > 0 && (
            <Field name="split">
              <SplitControl
                footprints={footprints}
                quarters={quarters}
                currentQuarterId={currentQuarterId}
                onSplit={onSplit}
              />
            </Field>
          )}

          {/* Three separate questions, and conflating them is how "confidence"
              stops meaning anything: the size can be well understood while the
              date is a guess. */}
          <Field name="sizeConfidence">
            <Choice
              options={CONFIDENCES}
              value={commitment.sizeConfidence}
              labelFor={(value) => t(`confidence.${value}`)}
              onChange={(value) => onChange({ sizeConfidence: value })}
              clearable
            />
          </Field>

          <Field name="timingConfidence">
            <Choice
              options={CONFIDENCES}
              value={commitment.timingConfidence}
              labelFor={(value) => t(`confidence.${value}`)}
              onChange={(value) => onChange({ timingConfidence: value })}
              clearable
            />
          </Field>

          <Field name="scopeConfidence">
            <Choice
              options={CONFIDENCES}
              value={commitment.scopeConfidence}
              labelFor={(value) => t(`confidence.${value}`)}
              onChange={(value) => onChange({ scopeConfidence: value })}
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

          {/* Chosen from the workspace's agreed list, never typed. A free-text
              "why" field is how eight teams end up with eight vocabularies for
              the same four reasons — which is the drift this product exists to
              prevent. */}
          <Field name="valueDrivers">
            <MultiChoice
              options={valueDrivers.map((driver) => ({ id: driver, label: driver }))}
              selected={commitment.valueDrivers}
              emptyLabel={t('panel.noValueDrivers')}
              onChange={(next) => onChange({ valueDrivers: next })}
            />
          </Field>

          {/* Themes cut across the portfolio, so they are a workspace taxonomy
              rather than a per-commitment label. Work can carry several. */}
          <Field name="themes">
            <MultiChoice
              options={themes.map((theme) => ({ id: theme.id, label: theme.name }))}
              selected={commitmentThemeIds}
              emptyLabel={t('panel.addTheme')}
              onChange={onSetThemes}
            />
            <AddText
              label={t('panel.newTheme')}
              placeholder={t('panel.newTheme')}
              onAdd={onCreateTheme}
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
                  {/* Still an anchor — it has to look, copy, and read to a
                      screen reader like a link. But the navigation is handed
                      to the OS rather than to a webview: `target="_blank"` in
                      the desktop shell opens a window that is still inside the
                      app, which is exactly the embedding spec 10 §4 forbids.
                      The href stays real so "copy link address" keeps working. */}
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    title={t('panel.openLink', { label: link.label ?? link.url })}
                    onClick={(e) => {
                      e.preventDefault();
                      onOpenLink(link.url);
                    }}
                  >
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

/**
 * A closed set where more than one answer is allowed.
 *
 * Toggle buttons rather than a multi-select listbox: the whole range stays
 * visible without opening anything, which is the same reason `Choice` is
 * buttons — and with eight value drivers the list is short enough that seeing
 * the unchosen ones is part of the decision.
 */
function MultiChoice({
  options,
  selected,
  emptyLabel,
  onChange,
}: {
  readonly options: ReadonlyArray<{ id: string; label: string }>;
  readonly selected: readonly string[];
  readonly emptyLabel: string;
  readonly onChange: (next: readonly string[]) => void;
}) {
  // Before the early return: a hook that runs conditionally is a hook that
  // desynchronises the moment the first theme is created.
  const group = useFieldGroup();

  if (options.length === 0) {
    return <p className="fm-panel__readonly">{emptyLabel}</p>;
  }

  return (
    <div className="fm-choice fm-choice--multi" role="group" {...group}>
      {options.map((option) => {
        const on = selected.includes(option.id);
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={on}
            onClick={() =>
              onChange(on ? selected.filter((id) => id !== option.id) : [...selected, option.id])
            }
          >
            {/* Never state by colour alone: the tick is the second channel,
                and `aria-pressed` is the third. */}
            <span aria-hidden="true">{on ? '✓ ' : ''}</span>
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Divide one placement across quarters.
 *
 * Asks the two questions a split actually has — how much moves, and where to —
 * and states the remainder, because the number you are deciding about is what
 * stays behind as much as what leaves. Quarters the work already occupies are
 * not offered: two placements of one commitment in one container is exactly
 * what the domain refuses.
 */
function SplitControl({
  footprints,
  quarters,
  currentQuarterId,
  onSplit,
}: {
  readonly footprints: readonly PanelFootprint[];
  readonly quarters: readonly QuarterId[];
  readonly currentQuarterId: QuarterId;
  readonly onSplit: (footprintId: string, toQuarterId: QuarterId, units: number) => void;
}) {
  const divisible = footprints.filter(({ footprint }) => footprint.units > 1);
  const [footprintId, setFootprintId] = useState(divisible[0]?.footprint.id ?? '');
  const chosen = divisible.find(({ footprint }) => footprint.id === footprintId) ?? divisible[0];

  const [units, setUnits] = useState(1);
  const [target, setTarget] = useState<QuarterId | undefined>(undefined);

  if (!chosen) {
    return <p className="fm-panel__readonly">{t('panel.splitNowhere')}</p>;
  }

  const total = chosen.footprint.units;
  const moving = Math.min(Math.max(1, units), total - 1);
  // Same team, so a quarter this commitment already sits in on that team is out.
  const taken = new Set(
    footprints
      .filter(({ footprint }) => footprint.teamId === chosen.footprint.teamId)
      .map(({ footprint }) => footprint.quarterId),
  );
  const available = quarters.filter((quarterId) => !taken.has(quarterId));

  return (
    <div className="fm-panel__split">
      {divisible.length > 1 && (
        <select
          value={chosen.footprint.id}
          aria-label={t('fields.split.label')}
          onChange={(e) => setFootprintId(e.target.value)}
        >
          {divisible.map(({ footprint, teamName }) => (
            <option key={footprint.id} value={footprint.id}>
              {teamName} · {footprint.quarterId} · {footprint.units}
            </option>
          ))}
        </select>
      )}

      <label className="fm-panel__splitunits">
        <span>{t('panel.splitFrom', { units: moving, total })}</span>
        <input
          type="number"
          min={1}
          max={total - 1}
          value={moving}
          onChange={(e) => setUnits(Number(e.target.value))}
        />
      </label>

      {available.length === 0 ? (
        <p className="fm-panel__readonly">{t('panel.splitNowhere')}</p>
      ) : (
        <QuarterStrip
          quarters={available}
          currentQuarterId={currentQuarterId}
          value={target}
          onChange={setTarget}
        />
      )}

      <button
        type="button"
        disabled={target === undefined || moving < 1 || moving >= total}
        onClick={() => {
          if (target === undefined) return;
          onSplit(chosen.footprint.id, target, moving);
          setTarget(undefined);
        }}
      >
        {t('panel.splitDo')}
      </button>
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
      {/* Labelled, not left to the option text: a select whose only name is
          its current value tells a screen reader what is chosen but never what
          is being chosen. axe flags it, and it was flagged here. */}
      <select
        value={type}
        aria-label={t('panel.linkTypeLabel')}
        onChange={(e) => setType(e.target.value as ExternalLinkType)}
      >
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
