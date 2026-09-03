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

/**
 * A chip carries the filter's raw value — a team id, a lifecycle enum — because
 * `filterChips` is pure and has no catalogue to read from. Naming it is the
 * render layer's job: a ULID on screen is not a filter anyone can read.
 */
function chipDisplay(
  chip: { readonly key: string; readonly value: string },
  teamNames: ReadonlyMap<string, string>,
): string {
  const [kind] = chip.key.split(':');
  if (kind === 'team') return teamNames.get(chip.value) ?? chip.value;
  if (kind === 'lifecycle') return t(`lifecycle.${chip.value}`);
  if (kind === 'class') return t(`class.${chip.value}`);
  return chip.value;
}

export type LensStripProps = {
  readonly filter: FilterState;
  readonly focusedName: string | null;
  readonly teamNames: ReadonlyMap<string, string>;
  readonly onRemoveChip: (key: string) => void;
  readonly onClearFilters: () => void;
  readonly onToggleHide: () => void;
  readonly onClearFocus: () => void;
};

export function LensStrip({
  filter,
  focusedName,
  teamNames,
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
              {t(chip.labelKey)}: {chipDisplay(chip, teamNames)} ✕
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
