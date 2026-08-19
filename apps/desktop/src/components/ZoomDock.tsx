/**
 * Semantic zoom, parked on the map.
 *
 * Overview / Areas / Detail has to stay in reach while you are looking at a
 * lower team row. Sitting it at the top of the shell meant scrolling away
 * from the cell, then losing that cell when the scale changed.
 */

import type { ZoomLevel } from '@flowmap/visual-model';

import { t } from '../i18n/t.js';

export type ZoomDockProps = {
  readonly level: ZoomLevel;
  readonly scale: number;
  readonly onLevel: (level: ZoomLevel) => void;
  readonly onZoomBy: (factor: number) => void;
};

const LEVELS: readonly ZoomLevel[] = [1, 2, 3];

export function ZoomDock({ level, scale, onLevel, onZoomBy }: ZoomDockProps) {
  return (
    <div className="fm-zoom-dock fm-editing-chrome">
      <div className="fm-zoom-dock__bar">
        <div className="fm-levels" role="group" aria-label={t('map.level.group')}>
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
        <div className="fm-zoom" role="group" aria-label={t('map.zoom')}>
          <button type="button" aria-label={t('map.zoomOut')} onClick={() => onZoomBy(1 / 1.25)}>
            −
          </button>
          <span className="fm-zoom__figure" aria-live="polite">
            {t('map.zoomLevel', { percent: Math.round(scale * 100) })}
          </span>
          <button type="button" aria-label={t('map.zoomIn')} onClick={() => onZoomBy(1.25)}>
            +
          </button>
        </div>
        <span className="fm-lens__hint" aria-live="polite">
          {t('map.level.hint', { level })}
        </span>
      </div>
    </div>
  );
}
