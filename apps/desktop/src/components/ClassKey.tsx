/**
 * The class key.
 *
 * Colour on the board answers "why does this work exist", and a hue nobody can
 * name is decoration. The key names all four so the board can be read by
 * someone who did not build it — which, in a room, is everyone.
 *
 * It doubles as the class filter rather than sitting there as a caption: the
 * question a legend provokes is almost always "show me just those", and the
 * filter state already had a `classes` axis waiting for a control.
 */

import type { FilterState } from '@flowmap/visual-model';

import { t } from '../i18n/t.js';

const CLASSES = ['MANDATORY', 'STRATEGIC', 'OPERATIONAL', 'DISCRETIONARY'] as const;

export type ClassKeyProps = {
  readonly filter: FilterState;
  readonly onToggleClass: (value: (typeof CLASSES)[number]) => void;
};

export function ClassKey({ filter, onToggleClass }: ClassKeyProps) {
  return (
    <div className="fm-classkey">
      <span className="fm-classkey__title">{t('map.classKey')}</span>
      {CLASSES.map((value) => (
        <button
          key={value}
          type="button"
          className="fm-classkey__item"
          data-class={value}
          aria-pressed={filter.classes.includes(value)}
          onClick={() => onToggleClass(value)}
        >
          <span className="fm-classkey__swatch" aria-hidden="true" />
          {t(`class.${value}`)}
        </button>
      ))}
    </div>
  );
}
