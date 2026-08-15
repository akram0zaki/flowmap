/**
 * The lens strip: zoom level, filter chips, and focus state.
 *
 * Two rules from the spec show up here directly:
 *   · zoom is reachable without a precise pointer, so the explicit Level
 *     control sits next to the scroll-wheel zoom (§3.3);
 *   · what is filtered is always visible as chips, and the default response to
 *     a filter is to fade rather than remove (§10).
 */

import type { FilterState, ZoomLevel } from '@flowmap/visual-model';
import { filterChips, isFilterActive } from '@flowmap/visual-model';

import { t } from '../i18n/t.js';

export type LensStripProps = {
  readonly level: ZoomLevel;
  readonly filter: FilterState;
  readonly focusedName: string | null;
  readonly onLevel: (level: ZoomLevel) => void;
  readonly onRemoveChip: (key: string) => void;
  readonly onClearFilters: () => void;
  readonly onToggleHide: () => void;
  readonly onClearFocus: () => void;
};

const LEVELS: readonly ZoomLevel[] = [1, 2, 3];

export function LensStrip({
  level,
  filter,
  focusedName,
  onLevel,
  onRemoveChip,
  onClearFilters,
  onToggleHide,
  onClearFocus,
}: LensStripProps) {
  const chips = filterChips(filter);

  return (
    <div className="fm-lens">
      <div className="fm-levels" role="group" aria-label={t('map.level')}>
        {LEVELS.map((candidate) => (
          <button
            key={candidate}
            type="button"
            aria-pressed={level === candidate}
            onClick={() => onLevel(candidate)}
          >
            {t(`map.level.${candidate}`)}
          </button>
        ))}
      </div>

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
          <button type="button" className="fm-chip" onClick={onClearFilters}>
            {t('filter.clear')}
          </button>
          {/* Fade preserves spatial context; hiding is opt-in for density. */}
          <button
            type="button"
            className="fm-chip"
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

      <span className="fm-lens__hint" aria-live="polite">
        {t('map.level.hint', { level })}
      </span>
    </div>
  );
}

export { isFilterActive };
