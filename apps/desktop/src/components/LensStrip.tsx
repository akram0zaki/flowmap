/**
 * Filter chips and focus state.
 *
 * Zoom lives in `ZoomDock`, over the map, so changing level does not send you
 * back to the top of the board. What is filtered stays visible here as chips;
 * the default response to a filter is to fade rather than remove (§10).
 */

import type { FilterState } from '@flowmap/visual-model';
import { filterChips, isFilterActive } from '@flowmap/visual-model';

import { t } from '../i18n/t.js';

export type LensStripProps = {
  readonly filter: FilterState;
  readonly focusedName: string | null;
  readonly onRemoveChip: (key: string) => void;
  readonly onClearFilters: () => void;
  readonly onToggleHide: () => void;
  readonly onClearFocus: () => void;
};

export function LensStrip({
  filter,
  focusedName,
  onRemoveChip,
  onClearFilters,
  onToggleHide,
  onClearFocus,
}: LensStripProps) {
  const chips = filterChips(filter);

  return (
    <div className="fm-lens">
      {chips.length > 0 ? (
        <>
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              className="fm-chip"
              aria-pressed
              onClick={() => onRemoveChip(chip.key)}
            >
              {t(chip.labelKey)}: {chip.value} ✕
            </button>
          ))}
          <button type="button" className="fm-chip fm-chip--plain" onClick={onClearFilters}>
            {t('filter.clear')}
          </button>
          {/* Fade preserves spatial context; hiding is opt-in for density. */}
          <button
            type="button"
            className="fm-chip fm-chip--plain"
            aria-pressed={filter.hideFiltered}
            onClick={onToggleHide}
          >
            {t('filter.hide')}
          </button>
        </>
      ) : (
        <span className="fm-lens__none">{t('filter.none')}</span>
      )}

      {focusedName !== null && (
        <button type="button" className="fm-chip" onClick={onClearFocus}>
          {focusedName} ✕ {t('map.clearFocus')}
        </button>
      )}
    </div>
  );
}

export { isFilterActive };
