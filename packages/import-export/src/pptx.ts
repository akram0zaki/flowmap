/**
 * The roadmap as a PowerPoint deck.
 *
 * A .pptx is a zip of OOXML parts, and `fflate` is already here for the
 * portable package — so this writes the XML directly rather than adding a
 * presentation library for one slide shape. The parts below are the minimum a
 * conforming reader needs: content types, a master, a layout, a theme, and the
 * slides. Everything else PowerPoint fills in on open.
 *
 * The deck is drawn, not templated. Bars are rectangles, the axis is lines, and
 * the today marker is a dashed red connector — so every element stays editable
 * once it lands in someone's deck, which is the entire reason for exporting to
 * PowerPoint rather than to an image.
 *
 * Pagination keeps a theme whole. A band split across a page boundary reads as
 * two different themes with the same name, so a band that does not fit starts
 * the next slide instead.
 */

import { zipSync, strToU8 } from 'fflate';

import type { RoadmapBand, RoadmapModel } from './roadmap.js';

/** English Metric Units. 914400 per inch; a 16:9 slide is 13.333in × 7.5in. */
const EMU_IN = 914400;
const SLIDE_W = Math.round(13.333 * EMU_IN);
const SLIDE_H = Math.round(7.5 * EMU_IN);

const MARGIN = Math.round(0.4 * EMU_IN);
const THEME_COL = Math.round(1.5 * EMU_IN);
const TITLE_H = Math.round(0.75 * EMU_IN);
const AXIS_H = Math.round(0.6 * EMU_IN);
const ROW_H = Math.round(0.32 * EMU_IN);
const ROW_GAP = Math.round(0.06 * EMU_IN);
const BAND_GAP = Math.round(0.12 * EMU_IN);

const PLOT_X = MARGIN + THEME_COL;
const PLOT_W = SLIDE_W - PLOT_X - MARGIN;
const PLOT_TOP = MARGIN + TITLE_H + AXIS_H;

/** How many bar rows fit under the axis before a new slide is needed. */
const ROWS_PER_SLIDE = Math.max(1, Math.floor((SLIDE_H - PLOT_TOP - MARGIN) / (ROW_H + ROW_GAP)));

/** Band fills, mirrored from the swatch palette by value. */
const BAND_FILLS = ['1F4E79', '6A2C5A', '175C55', '7D4022', '4B3C86', '445C26', '3D4A57', '6F6757'];

const INK = '16181C';
const MUTED = '5F656E';
const RULE = 'C9C5BD';
const TODAY = 'D11A2A';

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** One page of bands, with the running row offset already applied. */
type Page = { readonly bands: readonly { band: RoadmapBand; fill: string }[] };

function paginate(model: RoadmapModel): Page[] {
  const pages: Page[] = [];
  let current: { band: RoadmapBand; fill: string }[] = [];
  let used = 0;

  model.bands.forEach((band, index) => {
    const fill = BAND_FILLS[index % BAND_FILLS.length]!;
    // +1 for the band's own heading line.
    const needed = band.rows.length + 1;
    if (used > 0 && used + needed > ROWS_PER_SLIDE) {
      pages.push({ bands: current });
      current = [];
      used = 0;
    }
    current.push({ band, fill });
    used += needed;
  });
  if (current.length > 0) pages.push({ bands: current });
  return pages.length > 0 ? pages : [{ bands: [] }];
}

function shape(id: number, name: string, x: number, y: number, w: number, h: number, body: string) {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${esc(name)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${Math.round(x)}" y="${Math.round(y)}"/><a:ext cx="${Math.max(1, Math.round(w))}" cy="${Math.max(1, Math.round(h))}"/></a:xfrm>${body}</p:spPr>`;
}

function textBox(
  id: number,
  x: number,
  y: number,
  w: number,
  h: number,
  text: string,
  opts: { size: number; color: string; bold?: boolean; align?: string; anchor?: string },
): string {
  const align = opts.align ?? 'l';
  const anchor = opts.anchor ?? 'ctr';
  return `${shape(id, `t${id}`, x, y, w, h, '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/>')}<p:txBody><a:bodyPr wrap="square" anchor="${anchor}" lIns="45720" rIns="45720" tIns="0" bIns="0"><a:normAutofit/></a:bodyPr><a:lstStyle/><a:p><a:pPr algn="${align}"/><a:r><a:rPr lang="en-GB" sz="${opts.size}" b="${opts.bold ? 1 : 0}" dirty="0"><a:solidFill><a:srgbClr val="${opts.color}"/></a:solidFill><a:latin typeface="Calibri"/></a:rPr><a:t>${esc(text)}</a:t></a:r></a:p></p:txBody></p:sp>`;
}

function bar(
  id: number,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  label: string,
): string {
  return `${shape(id, `bar${id}`, x, y, w, h, `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 18000"/></a:avLst></a:prstGeom><a:solidFill><a:srgbClr val="${fill}"/></a:solidFill><a:ln w="9525"><a:solidFill><a:srgbClr val="${fill}"/></a:solidFill></a:ln>`)}<p:txBody><a:bodyPr wrap="none" anchor="ctr" lIns="72000" rIns="72000" tIns="0" bIns="0"/><a:lstStyle/><a:p><a:pPr algn="l"/><a:r><a:rPr lang="en-GB" sz="900" b="1" dirty="0"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:latin typeface="Calibri"/></a:rPr><a:t>${esc(label)}</a:t></a:r></a:p></p:txBody></p:sp>`;
}

function line(
  id: number,
  x: number,
  y: number,
  h: number,
  color: string,
  dashed: boolean,
  width = 9525,
): string {
  const dash = dashed ? '<a:prstDash val="dash"/>' : '';
  return `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${id}" name="line${id}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr><a:xfrm><a:off x="${Math.round(x)}" y="${Math.round(y)}"/><a:ext cx="0" cy="${Math.round(h)}"/></a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:ln w="${width}"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill>${dash}</a:ln></p:spPr></p:cxnSp>`;
}

function slideXml(model: RoadmapModel, page: Page, pageNo: number, pageCount: number): string {
  const months = model.months;
  const colW = PLOT_W / Math.max(1, months.length);
  let id = 2;
  const parts: string[] = [];

  const title =
    pageCount > 1
      ? `${model.title} — ${model.workspace} (${pageNo}/${pageCount})`
      : `${model.title} — ${model.workspace}`;
  parts.push(
    textBox(id++, MARGIN, MARGIN, SLIDE_W - 2 * MARGIN, TITLE_H, title, {
      size: 2000,
      color: INK,
      bold: true,
      anchor: 'ctr',
    }),
  );

  // Axis: a quarter label on every third column, a month label on each.
  months.forEach((month, index) => {
    const x = PLOT_X + index * colW;
    if (month.firstOfQuarter) {
      parts.push(
        textBox(id++, x, MARGIN + TITLE_H, colW * 3, AXIS_H / 2, month.quarterId, {
          size: 1000,
          color: INK,
          bold: true,
        }),
      );
      parts.push(line(id++, x, MARGIN + TITLE_H, SLIDE_H - MARGIN - TITLE_H, RULE, false));
    }
    parts.push(
      textBox(id++, x, MARGIN + TITLE_H + AXIS_H / 2, colW, AXIS_H / 2, month.label, {
        size: 900,
        color: MUTED,
      }),
    );
  });

  let y = PLOT_TOP;
  for (const { band, fill } of page.bands) {
    parts.push(
      textBox(id++, MARGIN, y, THEME_COL - ROW_GAP, ROW_H, band.theme, {
        size: 1100,
        color: INK,
        bold: true,
      }),
    );
    y += ROW_H + ROW_GAP;
    for (const row of band.rows) {
      const x = PLOT_X + row.startIndex * colW;
      const w = (row.endIndex - row.startIndex + row.endFraction) * colW;
      parts.push(bar(id++, x, y, w, ROW_H, fill, row.name));
      y += ROW_H + ROW_GAP;
    }
    y += BAND_GAP;
  }

  // Drawn last so nothing paints over it: the one line a reader looks for.
  if (model.today !== null) {
    const x = PLOT_X + (model.today.index + model.today.fraction) * colW;
    parts.push(line(id++, x, MARGIN + TITLE_H, SLIDE_H - MARGIN - TITLE_H, TODAY, true, 19050));
    parts.push(
      textBox(id++, x - colW / 2, MARGIN + TITLE_H - AXIS_H / 2, colW, AXIS_H / 2, 'today', {
        size: 800,
        color: TODAY,
        bold: true,
        align: 'ctr',
      }),
    );
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${parts.join('')}</p:spTree></p:cSld><p:clrMapOvr><a:overrideClrMapping bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/></p:clrMapOvr></p:sld>`;
}

const THEME_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Flowmap"><a:themeElements><a:clrScheme name="Flowmap"><a:dk1><a:srgbClr val="16181C"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="16181C"/></a:dk2><a:lt2><a:srgbClr val="F5F4F0"/></a:lt2><a:accent1><a:srgbClr val="1F4E79"/></a:accent1><a:accent2><a:srgbClr val="6A2C5A"/></a:accent2><a:accent3><a:srgbClr val="175C55"/></a:accent3><a:accent4><a:srgbClr val="7D4022"/></a:accent4><a:accent5><a:srgbClr val="4B3C86"/></a:accent5><a:accent6><a:srgbClr val="445C26"/></a:accent6><a:hlink><a:srgbClr val="1F4E79"/></a:hlink><a:folHlink><a:srgbClr val="6A2C5A"/></a:folHlink></a:clrScheme><a:fontScheme name="Flowmap"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Flowmap"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;

const SLIDE_MASTER = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`;

const SLIDE_LAYOUT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

/** Builds a .pptx of the roadmap. One slide per page, themes never split. */
export function roadmapPptx(model: RoadmapModel): Uint8Array {
  const pages = paginate(model);
  const files: Record<string, Uint8Array> = {};
  const put = (path: string, xml: string) => {
    files[path] = strToU8(xml);
  };

  const slideOverrides = pages
    .map(
      (_p, i) =>
        `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
    )
    .join('');

  put(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${slideOverrides}</Types>`,
  );

  put(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`,
  );

  const sldIds = pages.map((_p, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('');
  put(
    'ppt/presentation.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${sldIds}</p:sldIdLst><p:sldSz cx="${SLIDE_W}" cy="${SLIDE_H}"/><p:notesSz cx="${SLIDE_H}" cy="${SLIDE_W}"/></p:presentation>`,
  );

  const presRels = pages
    .map(
      (_p, i) =>
        `<Relationship Id="rId${i + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`,
    )
    .join('');
  put(
    'ppt/_rels/presentation.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>${presRels}<Relationship Id="rId${pages.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/></Relationships>`,
  );

  put('ppt/theme/theme1.xml', THEME_XML);
  put('ppt/slideMasters/slideMaster1.xml', SLIDE_MASTER);
  put(
    'ppt/slideMasters/_rels/slideMaster1.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`,
  );
  put('ppt/slideLayouts/slideLayout1.xml', SLIDE_LAYOUT);
  put(
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
  );

  pages.forEach((page, index) => {
    put(`ppt/slides/slide${index + 1}.xml`, slideXml(model, page, index + 1, pages.length));
    put(
      `ppt/slides/_rels/slide${index + 1}.xml.rels`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`,
    );
  });

  // A fixed timestamp, not the clock: the same workspace exported twice must
  // produce the same bytes, and zip stores an mtime per entry. 1980 is the
  // earliest the format allows.
  return zipSync(files, { level: 6, mtime: Date.UTC(1980, 0, 1) });
}

export const ROADMAP_SLIDE_ROW_BUDGET = ROWS_PER_SLIDE;
