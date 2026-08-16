/**
 * A labelled field, and the tooltip contract that goes with it.
 *
 * Spec 06 §8 makes the format a hard requirement on every capacity, lifecycle,
 * impact, dependency, health, attention and confidence field: a definition,
 * what the thing is *not*, and an example where one helps. The second part is
 * the one that earns its keep — "size is not a story-point estimate" is what
 * stops five teams inventing five different meanings for the same word.
 *
 * The parts live in the `fields` catalogue and `pnpm i18n:check` fails if any
 * of them is missing, so this component can render them without checking.
 */

import { createContext, useContext, useId, useState, type ReactNode } from 'react';

import { t } from '../i18n/t.js';

/**
 * How a control finds the label above it.
 *
 * The label has to be a real `<label for>` — a styled `<span>` gives a screen
 * reader nothing, which is exactly what the panel shipped with. Passing the id
 * through context rather than a render prop keeps the call sites readable:
 * `<Field name="units"><TextInput …/></Field>` is the shape that made this
 * mistake easy to make, so it is the shape that has to keep working.
 */
const FieldContext = createContext<{ id: string; labelId: string } | null>(null);

/** For a single control: `<input {...useFieldId()} />`. */
export function useFieldId(): { id?: string } {
  const field = useContext(FieldContext);
  return field ? { id: field.id } : {};
}

/** For a group of controls, which is labelled rather than pointed at. */
export function useFieldGroup(): { 'aria-labelledby'?: string } {
  const field = useContext(FieldContext);
  return field ? { 'aria-labelledby': field.labelId } : {};
}

export type FieldProps = {
  /** Key into the `fields` catalogue, e.g. `units` or `targetQuarter`. */
  readonly name: string;
  readonly children: ReactNode;
  /** Rendered instead of the control when the panel is read-only. */
  readonly value?: ReactNode;
};

export function Field({ name, children }: FieldProps) {
  const tipId = useId();
  const id = useId();
  const labelId = useId();
  const [open, setOpen] = useState(false);

  const definition = t(`fields.${name}.def`);
  const isNot = t(`fields.${name}.not`);
  const example = t(`fields.${name}.eg`);
  // `t` returns the key when there is no entry, and an example is optional.
  const hasNot = isNot !== `fields.${name}.not`;
  const hasExample = example !== `fields.${name}.eg`;

  return (
    <div className="fm-field">
      <div className="fm-field__head">
        <label id={labelId} className="fm-field__label" htmlFor={id}>
          {t(`fields.${name}.label`)}
        </label>
        <button
          type="button"
          className="fm-field__what"
          aria-expanded={open}
          aria-controls={tipId}
          aria-label={t('field.explain', { field: t(`fields.${name}.label`) })}
          onClick={() => setOpen((was) => !was)}
        >
          ?
        </button>
      </div>

      {/* Always in the DOM so a screen reader can reach it, hidden visually
          until asked for — a definition nobody can find is not a definition. */}
      <div id={tipId} className="fm-field__tip" hidden={!open}>
        <p>{definition}</p>
        {hasNot && (
          <p className="fm-field__not">
            <em>{t('field.isNot')}</em> {isNot}
          </p>
        )}
        {hasExample && (
          <p className="fm-field__eg">
            <em>{t('field.example')}</em> {example}
          </p>
        )}
      </div>

      <div className="fm-field__control">
        <FieldContext.Provider value={{ id, labelId }}>{children}</FieldContext.Provider>
      </div>
    </div>
  );
}

/** A section of the panel. Empty ones offer to be filled rather than sitting blank. */
export function Section({
  title,
  count,
  addLabel,
  onAdd,
  children,
}: {
  readonly title: string;
  readonly count?: number;
  readonly addLabel?: string;
  readonly onAdd?: () => void;
  readonly children?: ReactNode;
}) {
  const empty = count === 0;

  return (
    <section className="fm-panel__section">
      <h3>
        {title}
        {count !== undefined && count > 0 && <span className="fm-panel__count">{count}</span>}
      </h3>
      {/* Progressive disclosure: a section with nothing in it shows the way in,
          not a row of empty inputs. */}
      {empty && onAdd ? (
        <button type="button" className="fm-panel__add" onClick={onAdd}>
          {addLabel ?? t('panel.add')}
        </button>
      ) : (
        children
      )}
    </section>
  );
}
