/**
 * Assigning a palette swatch to each commitment class.
 *
 * Which hue means which class is a house convention, so the workspace owns it.
 * The control is a grid of swatch buttons per class rather than a `<select>` of
 * colour names: the thing being chosen is visible, and "Plum" is not a word
 * anyone should have to translate into a mental image to use this.
 *
 * Saved as one command for the whole mapping, so swapping two classes around
 * each other is one undo rather than two — see `setClassColours`.
 */

import { CLASS_SWATCHES, type ClassColours, type ClassSwatch } from '@flowmap/domain';
import { useState } from 'react';

import { t } from '../i18n/t.js';

const CLASSES = ['MANDATORY', 'STRATEGIC', 'OPERATIONAL', 'DISCRETIONARY'] as const;

export type ClassColourSettingsProps = {
  readonly colours: ClassColours;
  readonly onSave: (colours: ClassColours) => void;
};

export function ClassColourSettings({ colours, onSave }: ClassColourSettingsProps) {
  const [draft, setDraft] = useState<ClassColours>(colours);

  // The saved mapping can move while this panel is open — undo is a command
  // like any other, and it lands here. Adjusting during render rather than in
  // an effect means the panel never paints one frame of a stale draft.
  const [seen, setSeen] = useState<ClassColours>(colours);
  if (seen !== colours) {
    setSeen(colours);
    setDraft(colours);
  }

  const dirty = CLASSES.some((key) => draft[key] !== colours[key]);

  return (
    <section className="fm-swatches">
      <h3>{t('settings.classColours')}</h3>
      <p>{t('settings.classColoursHint')}</p>

      {CLASSES.map((key) => (
        <div className="fm-swatches__row" key={key}>
          <span className="fm-swatches__class" id={`swatch-label-${key}`}>
            {t(`class.${key}`)}
          </span>
          {/* A radiogroup rather than four toggles: exactly one swatch per
              class, and arrow keys move between them the way a reader expects. */}
          <div
            className="fm-swatches__set"
            role="radiogroup"
            aria-labelledby={`swatch-label-${key}`}
          >
            {CLASS_SWATCHES.map((swatch) => (
              <button
                key={swatch}
                type="button"
                role="radio"
                aria-checked={draft[key] === swatch}
                aria-label={t(`swatch.${swatch}`)}
                title={t(`swatch.${swatch}`)}
                className="fm-swatches__chip"
                data-swatch={swatch}
                data-solid={key === 'MANDATORY' || undefined}
                onClick={() => setDraft((d) => ({ ...d, [key]: swatch as ClassSwatch }))}
              />
            ))}
          </div>
        </div>
      ))}

      <div className="fm-swatches__actions">
        <button
          type="button"
          className="fm-primary"
          disabled={!dirty}
          onClick={() => onSave(draft)}
        >
          {t('settings.classColoursSave')}
        </button>
        <button
          type="button"
          className="fm-quiet"
          disabled={!dirty}
          onClick={() => setDraft(colours)}
        >
          {t('action.revert')}
        </button>
      </div>
    </section>
  );
}
