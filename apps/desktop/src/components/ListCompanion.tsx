/**
 * The list companion.
 *
 * Every graphical view has one, and its totals MUST equal the projection's —
 * a list that quietly disagrees with the board is worse than no list at all.
 *
 * "Visual for understanding; structured lists for precision."
 * See docs/spec/06-views-interaction.md §10.
 */

import type { BoardModel, FilterState } from '@flowmap/visual-model';
import { allBlocks, matchesFilter, isFilterActive } from '@flowmap/visual-model';

import { t } from '../i18n/t.js';

export function ListCompanion({
  board,
  filter,
}: {
  readonly board: BoardModel;
  readonly filter: FilterState;
}) {
  const rows = allBlocks(board)
    .filter((block) => !filter.hideFiltered || matchesFilter(filter, block, block.cell))
    .map((block) => ({
      key: block.footprintId,
      commitment: block.name,
      lifecycle: block.lifecycle,
      team: block.cell.teamName,
      quarter: block.cell.quarterId,
      units: block.units,
      counted: block.counted,
      filtered: !matchesFilter(filter, block, block.cell),
    }));

  // Totals come from the board's own summaries, so they cannot drift from what
  // the vessels draw.
  const { load, capacity } = board.totals;

  return (
    <section className="fm-list" aria-label={t('nav.listCompanion')}>
      <table>
        <caption>
          {t('list.caption')}
          {isFilterActive(filter) && ` · ${t('list.filtered', { count: rows.length })}`}
        </caption>
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
            <tr key={row.key} data-filtered={row.filtered || undefined}>
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
              {load}
            </td>
            <td />
          </tr>
          <tr>
            <th scope="row" colSpan={4}>
              {t('list.totalCapacity')}
            </th>
            <td className="fm-num" data-figure="" data-testid="total-capacity">
              {capacity}
            </td>
            <td />
          </tr>
        </tfoot>
      </table>
    </section>
  );
}
