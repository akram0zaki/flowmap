/**
 * Graphical Excel sheets for the workspace data export.
 *
 * Excel cannot run the Portfolio Map, so these sheets reconstruct its two
 * spatial arguments as cells: the wall (team × quarter) and the timeline
 * (commitment fragments across the horizon). They are pictures of capacity,
 * not a schedule — no percent complete, no critical path.
 *
 * Colour is never the only channel: every filled cell also carries text.
 */

import type ExcelJS from 'exceljs';
import {
  horizonWindow,
  isActive,
  isCounted,
  summariseCapacity,
  utilisationPercent,
  type CapacityFootprint,
  type Commitment,
  type QuarterId,
  type Team,
  type WorkspaceState,
} from '@flowmap/domain';

/** Excel ARGB fills, mirrored from the token set for a format that has no CSS. */
const INK = 'FF16181C';
const INK_ON_DARK = 'FFFFFFFF';
const RULE = 'FFE3E0D9';
const GRAPHITE_1 = 'FFEFEDE8';
const GRAPHITE_2 = 'FFDCD8D0';
const GRAPHITE_4 = 'FF8C877D';
const ACCENT = 'FF24457C';
const ACCENT_SURFACE = 'FFE8EEF8';
const CRITICAL_SURFACE = 'FFFBEBE7';
const CRITICAL_FG = 'FFA6301F';
const WARNING_SURFACE = 'FFFBF1DC';

export const PORTFOLIO_WALL_SHEET = 'Portfolio wall';
export const TIMELINE_SHEET = 'Timeline';

export type WallCellTone = 'none' | 'ok' | 'over' | 'closed';

export type WallCell = {
  readonly team: string;
  readonly quarterId: QuarterId;
  readonly current: boolean;
  readonly text: string;
  readonly tone: WallCellTone;
  readonly lines: number;
  readonly percent: number | null;
  readonly bar: string;
};

export type WallModel = {
  readonly title: string;
  readonly workspace: string;
  readonly quarters: readonly QuarterId[];
  readonly currentQuarterId: QuarterId;
  readonly rows: readonly {
    readonly team: string;
    readonly cells: readonly WallCell[];
  }[];
};

export type TimelineSegment = {
  readonly quarterId: QuarterId;
  readonly units: number;
  readonly counted: boolean;
};

export type TimelineExportRow = {
  readonly team: string;
  readonly commitment: string;
  readonly lifecycle: Commitment['lifecycle'];
  readonly segments: readonly TimelineSegment[];
};

export type TimelineExportModel = {
  readonly title: string;
  readonly caption: string;
  readonly workspace: string;
  readonly quarters: readonly QuarterId[];
  readonly currentQuarterId: QuarterId;
  readonly rows: readonly TimelineExportRow[];
};

export function portfolioWallModel(state: WorkspaceState): WallModel {
  const quarters = horizonWindow(state.workspace.currentQuarterId, 'HORIZON');
  const currentQuarterId = state.workspace.currentQuarterId;
  const teams = orderedTeams(state);
  const liveFootprints = [...state.footprints.values()].filter(isActive);

  return {
    title: 'Portfolio wall',
    workspace: state.workspace.name,
    quarters,
    currentQuarterId,
    rows: teams.map((team) => ({
      team: team.name,
      cells: quarters.map((quarterId) =>
        wallCell(state, team, quarterId, currentQuarterId, liveFootprints),
      ),
    })),
  };
}

export function timelineExportModel(state: WorkspaceState): TimelineExportModel {
  const quarters = horizonWindow(state.workspace.currentQuarterId, 'HORIZON');
  const visible = new Set(quarters);
  const teamsById = new Map(orderedTeams(state).map((team) => [team.id, team]));
  const grouped = new Map<
    string,
    {
      team: string;
      commitment: string;
      lifecycle: Commitment['lifecycle'];
      segments: TimelineSegment[];
    }
  >();

  for (const footprint of state.footprints.values()) {
    if (!isActive(footprint) || !visible.has(footprint.quarterId)) continue;
    const commitment = state.commitments.get(footprint.commitmentId);
    if (!commitment || !isActive(commitment) || commitment.lifecycle === 'DROPPED') continue;
    const team = teamsById.get(footprint.teamId);
    if (!team) continue;

    const key = `${team.id}:${commitment.id}`;
    const row = grouped.get(key) ?? {
      team: team.name,
      commitment: commitment.name,
      lifecycle: commitment.lifecycle,
      segments: [],
    };
    row.segments.push({
      quarterId: footprint.quarterId,
      units: footprint.units,
      counted: isCounted(footprint, commitment, state.workspace.currentQuarterId),
    });
    grouped.set(key, row);
  }

  const rows = [...grouped.values()]
    .map((row) => ({
      ...row,
      segments: [...row.segments].sort((left, right) =>
        left.quarterId.localeCompare(right.quarterId),
      ),
    }))
    .sort(
      (left, right) =>
        left.team.localeCompare(right.team) || left.commitment.localeCompare(right.commitment),
    );

  return {
    title: 'Timeline',
    caption:
      'How footprints line up across quarters. Not a schedule: no percent complete, no critical path. Filter Team or Lifecycle from the header.',
    workspace: state.workspace.name,
    quarters,
    currentQuarterId: state.workspace.currentQuarterId,
    rows,
  };
}

export function paintGraphicalSheets(book: ExcelJS.Workbook, state: WorkspaceState): void {
  paintPortfolioWall(book, portfolioWallModel(state));
  paintTimeline(book, timelineExportModel(state));
}

const HEADER_ROW = 3;
const DATA_START = 4;

function paintPortfolioWall(book: ExcelJS.Workbook, model: WallModel): void {
  const lastCol = 1 + model.quarters.length;
  const lastRow = Math.max(HEADER_ROW, DATA_START + model.rows.length - 1);
  const sheet = book.addWorksheet(PORTFOLIO_WALL_SHEET);
  sheet.properties.tabColor = { argb: ACCENT };
  sheet.views = [
    {
      state: 'frozen',
      xSplit: 1,
      ySplit: HEADER_ROW,
      topLeftCell: 'B4',
      showGridLines: false,
      zoomScale: 110,
    },
  ];
  chromePage(sheet, lastCol, lastRow);

  paintBanner(sheet, 1, lastCol, `${model.title}  ·  ${model.workspace}`);
  paintLegend(sheet, 2, lastCol, [
    { label: 'Fits', fill: GRAPHITE_1, ink: INK },
    { label: 'Over capacity', fill: CRITICAL_SURFACE, ink: CRITICAL_FG },
    { label: 'Closed', fill: GRAPHITE_2, ink: INK },
    { label: 'No container', fill: 'FFFFFFFF', ink: INK },
  ]);
  sheet.getCell(2, 1).value =
    'Team × quarter. The bar is utilisation; the names are the work. Filter from the header.';

  const header = sheet.getRow(HEADER_ROW);
  header.height = 22;
  header.getCell(1).value = 'Team';
  styleHeader(header.getCell(1), false);
  model.quarters.forEach((quarterId, index) => {
    const current = quarterId === model.currentQuarterId;
    header.getCell(index + 2).value = current ? `${quarterId} · now` : quarterId;
    styleHeader(header.getCell(index + 2), current);
  });

  model.rows.forEach((row, rowIndex) => {
    const excelRow = sheet.getRow(rowIndex + DATA_START);
    const name = excelRow.getCell(1);
    name.value = row.team;
    name.font = { bold: true, size: 11, color: { argb: INK } };
    name.alignment = { vertical: 'top', wrapText: true, indent: 1 };
    name.fill = solid(GRAPHITE_1);
    paintFrame(name);
    row.cells.forEach((cell, index) => {
      const target = excelRow.getCell(index + 2);
      target.value = wallRichText(cell);
      target.alignment = { wrapText: true, vertical: 'top', indent: 1 };
      target.fill = fillForTone(cell.tone);
      paintFrame(target, cell.current);
    });
    excelRow.height = Math.max(48, 16 * Math.max(3, ...row.cells.map((cell) => cell.lines)));
  });

  sheet.getColumn(1).width = 24;
  for (let index = 0; index < model.quarters.length; index += 1) {
    sheet.getColumn(index + 2).width = 28;
  }
  enableFilter(sheet, lastCol, lastRow);
}

function paintTimeline(book: ExcelJS.Workbook, model: TimelineExportModel): void {
  const lastCol = 3 + model.quarters.length;
  const lastRow = Math.max(HEADER_ROW, DATA_START + model.rows.length - 1);
  const sheet = book.addWorksheet(TIMELINE_SHEET);
  sheet.properties.tabColor = { argb: GRAPHITE_4 };
  sheet.views = [
    {
      state: 'frozen',
      xSplit: 3,
      ySplit: HEADER_ROW,
      topLeftCell: 'D4',
      showGridLines: false,
      zoomScale: 110,
    },
  ];
  chromePage(sheet, lastCol, lastRow);

  paintBanner(sheet, 1, lastCol, `${model.title}  ·  ${model.workspace}`);
  paintLegend(sheet, 2, lastCol, [
    { label: 'Committed', fill: ACCENT_SURFACE, ink: INK },
    { label: 'In delivery', fill: ACCENT, ink: INK_ON_DARK },
    { label: 'On hold / not counted', fill: WARNING_SURFACE, ink: INK },
    { label: 'Done', fill: GRAPHITE_2, ink: INK },
  ]);
  sheet.getCell(2, 1).value = model.caption;

  const header = sheet.getRow(HEADER_ROW);
  header.height = 22;
  header.getCell(1).value = 'Team';
  header.getCell(2).value = 'Commitment';
  header.getCell(3).value = 'Lifecycle';
  styleHeader(header.getCell(1), false);
  styleHeader(header.getCell(2), false);
  styleHeader(header.getCell(3), false);
  model.quarters.forEach((quarterId, index) => {
    const current = quarterId === model.currentQuarterId;
    header.getCell(index + 4).value = current ? `${quarterId} · now` : quarterId;
    styleHeader(header.getCell(index + 4), current);
  });

  const byQuarter = (row: TimelineExportRow, quarterId: QuarterId) =>
    row.segments.find((segment) => segment.quarterId === quarterId);

  model.rows.forEach((row, rowIndex) => {
    const excelRow = sheet.getRow(rowIndex + DATA_START);
    excelRow.height = 24;
    writeMeta(excelRow.getCell(1), row.team);
    writeMeta(excelRow.getCell(2), row.commitment);
    writeMeta(excelRow.getCell(3), row.lifecycle);
    model.quarters.forEach((quarterId, index) => {
      const target = excelRow.getCell(index + 4);
      const current = quarterId === model.currentQuarterId;
      const segment = byQuarter(row, quarterId);
      paintFrame(target, current);
      target.alignment = { vertical: 'middle', horizontal: 'center' };
      if (!segment) return;
      target.value = segment.units;
      target.numFmt = '0" u"';
      target.font = {
        size: 10,
        bold: true,
        color: { argb: row.lifecycle === 'IN_DELIVERY' && segment.counted ? INK_ON_DARK : INK },
      };
      target.fill = fillForLifecycle(row.lifecycle, segment.counted);
    });
  });

  sheet.getColumn(1).width = 18;
  sheet.getColumn(2).width = 32;
  sheet.getColumn(3).width = 16;
  for (let index = 0; index < model.quarters.length; index += 1) {
    sheet.getColumn(index + 4).width = 14;
  }

  enableFilter(sheet, lastCol, lastRow);
  if (model.rows.length > 0) {
    const from = `${colLetter(4)}${DATA_START}`;
    const to = `${colLetter(lastCol)}${lastRow}`;
    sheet.addConditionalFormatting({
      ref: `${from}:${to}`,
      rules: [
        {
          type: 'dataBar',
          priority: 1,
          gradient: true,
          showValue: true,
          cfvo: [{ type: 'num', value: 0 }, { type: 'max' }],
          color: { argb: ACCENT },
        } as ExcelJS.DataBarRuleType,
      ],
    });
  }
}

function wallCell(
  state: WorkspaceState,
  team: Team,
  quarterId: QuarterId,
  currentQuarterId: QuarterId,
  liveFootprints: readonly CapacityFootprint[],
): WallCell {
  const teamQuarter = [...state.teamQuarters.values()].find(
    (row) => isActive(row) && row.teamId === team.id && row.quarterId === quarterId,
  );
  const own = liveFootprints
    .filter((footprint) => footprint.teamId === team.id && footprint.quarterId === quarterId)
    .sort((left, right) => right.units - left.units);
  const lines: string[] = [];
  let tone: WallCellTone = 'none';
  let percent: number | null = null;
  let bar = '';

  if (!teamQuarter) {
    lines.push('—');
  } else {
    const summary = summariseCapacity({
      teamQuarter,
      footprints: liveFootprints,
      commitmentsById: state.commitments,
      currentQuarterId,
    });
    percent = utilisationPercent(summary);
    bar = pressureBar(percent);
    if (teamQuarter.closedAt !== undefined) {
      tone = 'closed';
      lines.push(percent === null ? `${bar}  Closed` : `${bar}  Closed · ${percent}%`);
    } else if (summary.overflow > 0) {
      tone = 'over';
      lines.push(`${bar}  ${percent}% ▲ Over by ${summary.overflow}`);
    } else {
      tone = 'ok';
      lines.push(
        percent === null
          ? `${bar}  No deliverable capacity`
          : `${bar}  ${percent}% · ${summary.headroom} headroom`,
      );
    }
    for (const footprint of own) {
      const commitment = state.commitments.get(footprint.commitmentId);
      if (!commitment || !isActive(commitment) || commitment.lifecycle === 'DROPPED') continue;
      const counted = isCounted(footprint, commitment, currentQuarterId);
      lines.push(
        counted
          ? `${commitment.name} · ${footprint.units}`
          : `${commitment.name} · ${footprint.units} (not counted)`,
      );
    }
    if (own.length === 0) lines.push('No work placed');
  }

  return {
    team: team.name,
    quarterId,
    current: quarterId === currentQuarterId,
    text: lines.join('\n'),
    tone,
    lines: lines.length,
    percent,
    bar,
  };
}

function orderedTeams(state: WorkspaceState): Team[] {
  return [...state.teams.values()]
    .filter((team) => isActive(team) && team.active)
    .sort((left, right) =>
      left.displayOrder === right.displayOrder
        ? left.name.localeCompare(right.name)
        : left.displayOrder - right.displayOrder,
    );
}

function styleHeader(cell: ExcelJS.Cell, current: boolean): void {
  cell.font = {
    bold: true,
    size: 10,
    color: { argb: current ? INK_ON_DARK : INK },
  };
  cell.fill = solid(current ? ACCENT : GRAPHITE_1);
  cell.alignment = { horizontal: 'center', vertical: 'middle' };
  paintFrame(cell, current);
}

function paintFrame(cell: ExcelJS.Cell, current = false): void {
  const color = { argb: current ? ACCENT : RULE };
  cell.border = {
    top: { style: current ? 'medium' : 'thin', color },
    left: { style: current ? 'medium' : 'thin', color },
    bottom: { style: current ? 'medium' : 'thin', color },
    right: { style: current ? 'medium' : 'thin', color },
  };
}

function fillForTone(tone: WallCellTone): ExcelJS.Fill {
  if (tone === 'over') {
    return { type: 'pattern', pattern: 'solid', fgColor: { argb: CRITICAL_SURFACE } };
  }
  if (tone === 'closed') {
    return { type: 'pattern', pattern: 'lightGray', fgColor: { argb: GRAPHITE_2 } };
  }
  if (tone === 'ok') {
    return { type: 'pattern', pattern: 'solid', fgColor: { argb: GRAPHITE_1 } };
  }
  return { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
}

function fillForLifecycle(lifecycle: Commitment['lifecycle'], counted: boolean): ExcelJS.Fill {
  if (!counted || lifecycle === 'ON_HOLD') {
    return { type: 'pattern', pattern: 'lightTrellis', fgColor: { argb: WARNING_SURFACE } };
  }
  if (lifecycle === 'IN_DELIVERY') {
    return { type: 'pattern', pattern: 'solid', fgColor: { argb: ACCENT } };
  }
  if (lifecycle === 'DONE') {
    return { type: 'pattern', pattern: 'solid', fgColor: { argb: GRAPHITE_2 } };
  }
  return { type: 'pattern', pattern: 'solid', fgColor: { argb: ACCENT_SURFACE } };
}

function pressureBar(percent: number | null): string {
  if (percent === null) return '··········';
  const filled = Math.max(0, Math.min(10, Math.round(percent / 10)));
  return `${'█'.repeat(filled)}${'░'.repeat(10 - filled)}`;
}

function wallRichText(cell: WallCell): ExcelJS.CellRichTextValue {
  const [headline = cell.text, ...rest] = cell.text.split('\n');
  const ink = cell.tone === 'over' ? CRITICAL_FG : INK;
  return {
    richText: [
      { font: { name: 'Calibri', size: 10, bold: true, color: { argb: ink } }, text: headline },
      ...(rest.length > 0
        ? [
            {
              font: { name: 'Calibri', size: 9, color: { argb: ink } },
              text: `\n${rest.join('\n')}`,
            },
          ]
        : []),
    ],
  };
}

function paintBanner(sheet: ExcelJS.Worksheet, row: number, lastCol: number, title: string): void {
  sheet.mergeCells(row, 1, row, lastCol);
  const cell = sheet.getCell(row, 1);
  cell.value = title;
  cell.font = { bold: true, size: 16, color: { argb: INK_ON_DARK }, name: 'Calibri' };
  cell.fill = solid(ACCENT);
  cell.alignment = { vertical: 'middle', indent: 1 };
  sheet.getRow(row).height = 28;
}

function paintLegend(
  sheet: ExcelJS.Worksheet,
  row: number,
  lastCol: number,
  chips: readonly { label: string; fill: string; ink: string }[],
): void {
  sheet.mergeCells(row, 1, row, Math.max(1, lastCol - chips.length));
  const caption = sheet.getCell(row, 1);
  caption.font = { italic: true, size: 9, color: { argb: INK } };
  caption.alignment = { vertical: 'middle', indent: 1 };
  chips.forEach((chip, index) => {
    const cell = sheet.getCell(row, lastCol - chips.length + 1 + index);
    cell.value = chip.label;
    cell.font = { size: 8, color: { argb: chip.ink } };
    cell.fill = solid(chip.fill);
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    paintFrame(cell);
  });
  sheet.getRow(row).height = 20;
}

function writeMeta(cell: ExcelJS.Cell, value: string): void {
  cell.value = value;
  cell.font = { size: 10, color: { argb: INK } };
  cell.alignment = { vertical: 'middle', indent: 1 };
  paintFrame(cell);
}

function chromePage(sheet: ExcelJS.Worksheet, lastCol: number, lastRow: number): void {
  sheet.pageSetup = {
    orientation: 'landscape',
    paperSize: 9,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printTitlesRow: '1:3',
    horizontalCentered: true,
    printArea: `A1:${colLetter(lastCol)}${lastRow}`,
  };
  sheet.headerFooter = {
    oddFooter: `&L&A&C${sheet.name}&RPage &P of &N`,
  };
}

function enableFilter(sheet: ExcelJS.Worksheet, lastCol: number, lastRow: number): void {
  sheet.autoFilter = {
    from: { row: HEADER_ROW, column: 1 },
    to: { row: lastRow, column: lastCol },
  };
}

function solid(argb: string): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

function colLetter(column: number): string {
  let remaining = column;
  let letters = '';
  while (remaining > 0) {
    const index = (remaining - 1) % 26;
    letters = String.fromCharCode(65 + index) + letters;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return letters;
}
