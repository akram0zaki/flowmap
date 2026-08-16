/**
 * Picking a target quarter by pointing at it.
 *
 * A dropdown of quarter ids makes you translate "two quarters out" into
 * "2027-Q1" and back again. The strip is the same horizon the board draws, in
 * the same order, with now marked — so the choice is made in the units the
 * board already taught you.
 *
 * Spec 06 §8: target quarter is chosen on a visual strip.
 */

import type { QuarterId } from '@flowmap/domain';

import { useFieldGroup } from './Field.jsx';
import { t } from '../i18n/t.js';

export type QuarterStripProps = {
  readonly quarters: readonly QuarterId[];
  readonly currentQuarterId: QuarterId;
  readonly value: QuarterId | undefined;
  readonly onChange: (quarterId: QuarterId | undefined) => void;
  readonly disabled?: boolean;
};

export function QuarterStrip({
  quarters,
  currentQuarterId,
  value,
  onChange,
  disabled,
}: QuarterStripProps) {
  return (
    // Labelled by the field above it when it sits in one; the standalone label
    // is the fallback for anywhere else it might be used.
    <div
      className="fm-strip"
      role="radiogroup"
      aria-label={t('fields.targetQuarter.label')}
      {...useFieldGroup()}
    >
      {quarters.map((quarterId) => {
        const selected = quarterId === value;
        return (
          <button
            key={quarterId}
            type="button"
            role="radio"
            aria-checked={selected}
            className="fm-strip__quarter"
            data-current={quarterId === currentQuarterId || undefined}
            data-past={quarterId < currentQuarterId || undefined}
            disabled={disabled}
            // Clicking the chosen quarter again clears it: a target is a
            // statement, and there has to be a way to stop making it.
            onClick={() => onChange(selected ? undefined : quarterId)}
          >
            <span className="fm-strip__label">{quarterId}</span>
            {quarterId === currentQuarterId && (
              <span className="fm-strip__now">{t('map.now')}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
