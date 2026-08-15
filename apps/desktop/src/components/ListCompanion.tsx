/**
 * The list companion.
 *
 * Every graphical view has one, and its totals MUST equal the projection's.
 * That equality is asserted by test — a list that quietly disagrees with the
 * board is worse than no list at all.
 *
 * See docs/spec/06-views-interaction.md §10.
 */

import type { CapacitySummary, CapacityFootprint, Commitment, TeamQuarter } from '@flowmap/domain';

import { t } from '../i18n/t.js';

type Cell = {
  teamName: string;
  teamQuarter: TeamQuarter;
  summary: CapacitySummary;
  blocks: ReadonlyArray<{ footprint: CapacityFootprint; commitment: Commitment; counted: boolean }>;
};

export function ListCompanion({ cells }: { cells: readonly Cell[] }) {
  const rows = cells.flatMap((cell) =>
    cell.blocks.map((block) => ({
      key: block.footprint.id,
      commitment: block.commitment.name,
      lifecycle: block.commitment.lifecycle,
      team: cell.teamName,
      quarter: cell.teamQuarter.quarterId,
      units: block.footprint.units,
      counted: block.counted,
    })),
  );

  const totalLoad = cells.reduce((sum, cell) => sum + cell.summary.committedLoad, 0);
  const totalCapacity = cells.reduce((sum, cell) => sum + cell.summary.deliverableCapacity, 0);

  return (
    <section className="fm-list" aria-label={t('nav.listCompanion')}>
      <table>
        <caption>{t('list.caption')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('list.commitment')}</th>
            <th scope="col">{t('list.lifecycle')}</th>
            <th scope="col">{t('list.team')}</th>
            <th scope="col">{t('list.quarter')}</th>
            <th scope="col" className="fm-num">
              {t('list.units')}
            </th>
            <th scope="col">{t('list.counted')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>{row.commitment}</td>
              <td>{t(`lifecycle.${row.lifecycle}`)}</td>
              <td>{row.team}</td>
              <td className="fm-num">{row.quarter}</td>
              <td className="fm-num" data-figure="">
                {row.units}
              </td>
              <td>{row.counted ? t('yes') : t('no')}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" colSpan={4}>
              {t('list.totalLoad')}
            </th>
            <td className="fm-num" data-figure="" data-testid="total-load">
              {totalLoad}
            </td>
            <td />
          </tr>
          <tr>
            <th scope="row" colSpan={4}>
              {t('list.totalCapacity')}
            </th>
            <td className="fm-num" data-figure="" data-testid="total-capacity">
              {totalCapacity}
            </td>
            <td />
          </tr>
        </tfoot>
      </table>
    </section>
  );
}
