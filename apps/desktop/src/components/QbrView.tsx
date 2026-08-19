/**
 * QBR lens chrome: one portfolio, three surfaces behind a dropdown.
 *
 * Capacity is the QBR map (current quarter plus two). Demand is the intake
 * pipe. Review is what the last quarter taught us. Switching surfaces never
 * copies data — it changes emphasis, like every other lens.
 */

import { t } from '../i18n/t.js';

export const QBR_SURFACES = ['CAPACITY', 'DEMAND', 'REVIEW'] as const;
export type QbrSurface = (typeof QBR_SURFACES)[number];

export function QbrToolbar({
  surface,
  onSurface,
}: {
  readonly surface: QbrSurface;
  readonly onSurface: (surface: QbrSurface) => void;
}) {
  return (
    <header className="fm-m5__header fm-qbr-bar">
      <div>
        <h2 id="qbr-title">{t('qbr.title')}</h2>
        <p>{t('qbr.description')}</p>
      </div>
      <div className="fm-m5__controls">
        <label>
          {t('qbr.view')}
          <select
            value={surface}
            aria-label={t('qbr.view')}
            onChange={(event) => onSurface(event.target.value as QbrSurface)}
          >
            {QBR_SURFACES.map((item) => (
              <option key={item} value={item}>
                {t(`qbr.view.${item}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
    </header>
  );
}
