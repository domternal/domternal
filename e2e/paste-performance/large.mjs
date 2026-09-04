/**
 * Deterministic large clipboard documents for limit and latency measurement. These are authored
 * synthetic shapes, not native Office captures. Every block carries a unique ordinal token so a
 * consumer can prove that nothing was dropped, duplicated or reordered. Inputs contain no images,
 * scripts, links or resource URLs.
 */

// English prose with explicit Unicode tokens and typographic quotes, independent of any document.
const sentences = Object.freeze([
  'čćšžđ Reading „long“ documents requires patience and care',
  'ČĆŠŽĐ The note says: »Everything is ready for the morning meeting«',
  'čćšžđ Two friends walk along the shore while dinner slowly cooks',
  'ČĆŠŽĐ After rain ‚small‘ streams flow down the steep old streets',
  'čćšžđ The budget report contains twelve chapters and four appendices',
  'ČĆŠŽĐ Students read the poem before their teacher explained its verses',
]);

function sentence(index, words) {
  const source = sentences[index % sentences.length].split(' ');
  const result = [];
  for (let offset = 0; result.length < words; offset++) result.push(source[offset % source.length]);
  return result.join(' ');
}

/** A unique ordinal token that never occurs inside another token or the envelope. */
export function token(index) {
  return `Q${String(index).padStart(6, '0')}x`;
}

// A representative Word clipboard stylesheet: font and paragraph style definitions, the page,
// and the default bullet (l0) and numbering (l1) level definitions for all nine levels.
const bulletLevels = [
  ['\\F0B7', 'Symbol'], ['o', '"Courier New"'], ['\\F0A7', 'Wingdings'],
];
const numberLevels = [undefined, 'alpha-lower', 'roman-lower'];
function listDefinitions() {
  let css = ' /* List Definitions */\n @list l0\n\t{mso-list-id:1105148761;\n\tmso-list-type:hybrid;\n'
    + '\tmso-list-template-ids:-1 67698689 67698691 67698693 67698689 67698691 67698693 67698689 67698691 67698693;}\n';
  for (let level = 1; level <= 9; level++) {
    const [text, font] = bulletLevels[(level - 1) % 3];
    css += `@list l0:level${String(level)}\n\t{mso-level-number-format:bullet;\n\tmso-level-text:${text};\n`
      + `\tmso-level-tab-stop:none;\n\tmso-level-number-position:left;\n\tmargin-left:${String(level / 2)}in;\n`
      + `\ttext-indent:-.25in;\n\tfont-family:${font};}\n`;
  }
  css += '@list l1\n\t{mso-list-id:1795442339;\n\tmso-list-type:hybrid;\n'
    + '\tmso-list-template-ids:-1 67698703 67698713 67698715 67698703 67698713 67698715 67698703 67698713 67698715;}\n';
  for (let level = 1; level <= 9; level++) {
    const format = numberLevels[(level - 1) % 3];
    css += `@list l1:level${String(level)}\n\t{${format === undefined ? '' : `mso-level-number-format:${format};\n\t`}`
      + `mso-level-tab-stop:none;\n\tmso-level-number-position:${format === 'roman-lower' ? 'right' : 'left'};\n`
      + `\tmargin-left:${String(level / 2)}in;\n\ttext-indent:${format === 'roman-lower' ? '-9.0pt' : '-.25in'};}\n`;
  }
  return css;
}
const fonts = ['Cambria Math', 'Calibri', 'Calibri Light', 'Aptos', 'Aptos Display', 'Symbol', 'Wingdings', 'Courier New'];
const styleDefinitions = [
  ['p.MsoNormal, li.MsoNormal, div.MsoNormal', 'margin-top:0in;\n\tmargin-right:0in;\n\tmargin-bottom:8.0pt;\n\tmargin-left:0in;\n\tline-height:107%;\n\tmso-pagination:widow-orphan;\n\tfont-size:12.0pt;\n\tfont-family:"Aptos",sans-serif;\n\tmso-ascii-font-family:Aptos;\n\tmso-fareast-font-family:Aptos;\n\tmso-hansi-font-family:Aptos;\n\tmso-bidi-font-family:"Times New Roman";\n\tmso-font-kerning:1.0pt;\n\tmso-ligatures:standardcontextual;\n\tmso-fareast-language:EN-US;'],
  ['h1', 'mso-style-priority:9;\n\tmso-style-qformat:yes;\n\tmso-style-link:"Heading 1 Char";\n\tmso-style-next:Normal;\n\tmargin-top:18.0pt;\n\tmargin-bottom:4.0pt;\n\tpage-break-after:avoid;\n\tmso-outline-level:1;\n\tfont-size:20.0pt;\n\tfont-family:"Aptos Display",sans-serif;\n\tcolor:#0F4761;\n\tfont-weight:normal;'],
  ['h2', 'mso-style-priority:9;\n\tmso-style-unhide:no;\n\tmso-style-qformat:yes;\n\tmso-style-link:"Heading 2 Char";\n\tmargin-top:8.0pt;\n\tmargin-bottom:4.0pt;\n\tpage-break-after:avoid;\n\tmso-outline-level:2;\n\tfont-size:16.0pt;\n\tfont-family:"Aptos Display",sans-serif;\n\tcolor:#0F4761;\n\tfont-weight:normal;'],
  ['p.MsoTitle, li.MsoTitle, div.MsoTitle', 'mso-style-priority:10;\n\tmso-style-qformat:yes;\n\tmso-style-link:"Title Char";\n\tmargin-bottom:4.0pt;\n\tmso-add-space:auto;\n\tline-height:normal;\n\tfont-size:28.0pt;\n\tfont-family:"Aptos Display",sans-serif;\n\tletter-spacing:-.5pt;'],
  ['p.MsoListParagraph, li.MsoListParagraph, div.MsoListParagraph', 'mso-style-priority:34;\n\tmso-style-qformat:yes;\n\tmargin-top:0in;\n\tmargin-right:0in;\n\tmargin-bottom:8.0pt;\n\tmargin-left:.5in;\n\tmso-add-space:auto;\n\tline-height:107%;\n\tfont-size:12.0pt;\n\tfont-family:"Aptos",sans-serif;'],
  ['p.MsoListParagraphCxSpFirst, li.MsoListParagraphCxSpFirst, div.MsoListParagraphCxSpFirst', 'mso-style-priority:34;\n\tmso-style-type:export-only;\n\tmargin-top:0in;\n\tmargin-right:0in;\n\tmargin-bottom:0in;\n\tmargin-left:.5in;\n\tmso-add-space:auto;\n\tfont-size:12.0pt;\n\tfont-family:"Aptos",sans-serif;'],
  ['p.MsoListParagraphCxSpMiddle, li.MsoListParagraphCxSpMiddle, div.MsoListParagraphCxSpMiddle', 'mso-style-priority:34;\n\tmso-style-type:export-only;\n\tmargin-top:0in;\n\tmargin-right:0in;\n\tmargin-bottom:0in;\n\tmargin-left:.5in;\n\tmso-add-space:auto;\n\tfont-size:12.0pt;\n\tfont-family:"Aptos",sans-serif;'],
  ['p.MsoListParagraphCxSpLast, li.MsoListParagraphCxSpLast, div.MsoListParagraphCxSpLast', 'mso-style-priority:34;\n\tmso-style-type:export-only;\n\tmargin-top:0in;\n\tmargin-right:0in;\n\tmargin-bottom:8.0pt;\n\tmargin-left:.5in;\n\tmso-add-space:auto;\n\tfont-size:12.0pt;\n\tfont-family:"Aptos",sans-serif;'],
  ['span.Heading1Char', 'mso-style-name:"Heading 1 Char";\n\tmso-style-priority:9;\n\tmso-style-unhide:no;\n\tmso-style-locked:yes;\n\tmso-style-link:"Heading 1";\n\tmso-ansi-font-size:20.0pt;\n\tfont-family:"Aptos Display",sans-serif;\n\tcolor:#0F4761;'],
  ['.MsoChpDefault', 'mso-style-type:export-only;\n\tmso-default-props:yes;\n\tfont-family:"Aptos",sans-serif;\n\tmso-font-kerning:1.0pt;\n\tmso-ligatures:standardcontextual;'],
  ['.MsoPapDefault', 'mso-style-type:export-only;\n\tmargin-bottom:8.0pt;\n\tline-height:115%;'],
  ['@page WordSection1', 'size:8.5in 11.0in;\n\tmargin:1.0in 1.0in 1.0in 1.0in;\n\tmso-header-margin:.5in;\n\tmso-footer-margin:.5in;\n\tmso-paper-source:0;'],
  ['div.WordSection1', 'page:WordSection1;'],
  ['ol', 'margin-bottom:0in;'],
  ['ul', 'margin-bottom:0in;'],
];
function wordStylesheet() {
  let css = '<!--\n /* Font Definitions */\n';
  for (const [index, family] of fonts.entries()) {
    css += ` @font-face\n\t{font-family:"${family}";\n\tpanose-1:2 ${String(index)} 5 3 5 4 6 3 2 4;\n`
      + '\tmso-font-charset:0;\n\tmso-generic-font-family:roman;\n\tmso-font-pitch:variable;\n'
      + '\tmso-font-signature:-536870145 1107305727 0 0 415 0;}\n';
  }
  css += ' /* Style Definitions */\n';
  for (const [selector, body] of styleDefinitions) css += ` ${selector}\n\t{${body}}\n`;
  return `${css}${listDefinitions()}-->`;
}
const WORD_HEAD = '<html xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" '
  + 'xmlns:w="urn:schemas-microsoft-com:office:word" xmlns:m="http://schemas.microsoft.com/office/2004/12/omml" '
  + 'xmlns="http://www.w3.org/TR/REC-html40"><head><meta http-equiv=Content-Type content="text/html; charset=utf-8">'
  + '<meta name=ProgId content=Word.Document><meta name=Generator content="Microsoft Word 15">'
  + '<meta name=Originator content="Microsoft Word 15"><!--[if gte mso 9]><xml>\n<o:OfficeDocumentSettings>\n'
  + '<o:AllowPNG/>\n</o:OfficeDocumentSettings>\n</xml><![endif]--><!--[if gte mso 9]><xml>\n<w:WordDocument>\n'
  + '<w:View>Normal</w:View>\n<w:Zoom>0</w:Zoom>\n<w:TrackMoves/>\n<w:TrackFormatting/>\n<w:HyphenationZone>21</w:HyphenationZone>\n'
  + '<w:ValidateAgainstSchemas/>\n<w:DoNotPromoteQF/>\n<w:LidThemeOther>HR</w:LidThemeOther>\n</w:WordDocument>\n</xml><![endif]-->'
  + `<style>\n${wordStylesheet()}\n</style></head><body lang=HR style='tab-interval:35.4pt;word-wrap:break-word'><!--StartFragment-->`;
const WORD_TAIL = '<!--EndFragment--></body></html>';

const run = (text, style = 'mso-ansi-language:HR') => `<span lang=HR style='${style}'>${text}</span>`;
const bulletMarkers = [['·', 'Symbol'], ['o', '"Courier New"'], ['§', 'Wingdings']];
const numberMarkers = [ordinal => `${String(ordinal)}.`, ordinal => `${String.fromCharCode(96 + ((ordinal - 1) % 26) + 1)}.`,
  ordinal => `${['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'][(ordinal - 1) % 10]}.`];

/** One Word list paragraph in the shape Word writes: level metadata, a marker run font and level geometry. */
function wordListItem(list, level, marker, font, body) {
  const runFont = font === undefined ? 'mso-bidi-font-family:Aptos;mso-bidi-theme-font:minor-latin'
    : `font-family:${font};mso-fareast-font-family:${font};mso-bidi-font-family:${font}`;
  const spacer = `<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; </span>`;
  return `<p class=MsoListParagraphCxSpMiddle style='margin-left:${String(level / 2)}in;mso-add-space:auto;text-indent:-.25in;`
    + `mso-list:${list} level${String(level)} lfo${list === 'l0' ? '1' : '2'}'><![if !supportLists]><span lang=HR style='${runFont};mso-ansi-language:HR'>`
    + `<span style='mso-list:Ignore'>${marker}${spacer}</span></span><![endif]>${run(body)}<o:p></o:p></p>`;
}

/**
 * Profiles, each measured in its own block unit. `block(index)` returns the block HTML, its
 * tokens in order, its visible words and its expected contribution to the editor document.
 */
const PROFILES = {
  'word-short-paragraphs': {
    envelope: 'word', unit: 'paragraph',
    block(index) {
      const id = token(index);
      return { html: `<p class=MsoNormal>${run(`${id} ${sentence(index, 3)}`)}<o:p></o:p></p>`, tokens: [id], words: 4, counts: { paragraph: 1 } };
    },
  },
  'word-fragmented-runs': {
    envelope: 'word', unit: 'paragraph',
    block(index) {
      const tokens = []; let html = '<p class=MsoNormal>';
      for (let part = 0; part < 5; part++) {
        const id = token(index * 5 + part); tokens.push(id);
        const text = `${id} ${sentence(index + part, 2)}`;
        const piece = part % 3 === 0 ? `<b>${run(text, 'font-size:12.0pt;mso-bidi-font-size:11.0pt;mso-ansi-language:HR')}</b>`
          : part % 3 === 1 ? `<i>${run(text, 'color:#0F4761;mso-ansi-language:HR')}</i>` : run(text, 'mso-bidi-font-family:Aptos;mso-ansi-language:HR');
        html += piece + (part < 4 ? "<span lang=HR style='mso-ansi-language:HR'> </span>" : '');
      }
      return { html: `${html}<o:p></o:p></p>`, tokens, words: 15, counts: { paragraph: 1 } };
    },
  },
  'word-default-lists': {
    envelope: 'word', unit: 'list item',
    block(index) {
      // Groups of six: three bullet levels, then three numbering levels.
      const id = token(index); const group = Math.floor(index / 6); const position = index % 6;
      const level = (position % 3) + 1;
      const body = `${id} ${sentence(index, 3)}`;
      const html = position < 3
        ? wordListItem('l0', level, bulletMarkers[level - 1][0], bulletMarkers[level - 1][1], body)
        // Word restarts the lower levels under each new first-level item.
        : wordListItem('l1', level, numberMarkers[level - 1](level === 1 ? group + 1 : 1), undefined, body);
      return { html, tokens: [id], words: 4, counts: { listItem: 1 } };
    },
  },
  'word-table': {
    envelope: 'word', unit: 'table row',
    wrap: html => `<table class=MsoTableGrid border=1 cellspacing=0 cellpadding=0 style='border-collapse:collapse;border:none;mso-border-alt:solid windowtext .5pt;mso-yfti-tbllook:1184'>${html}</table>`,
    block(index) {
      const tokens = []; let html = `<tr style='mso-yfti-irow:${String(index)}'>`;
      for (let cell = 0; cell < 3; cell++) {
        const id = token(index * 3 + cell); tokens.push(id);
        html += `<td width=208 valign=top style='width:155.8pt;border:solid windowtext 1.0pt;mso-border-alt:solid windowtext .5pt;padding:0in 5.4pt 0in 5.4pt'>`
          + `<p class=MsoNormal style='margin-bottom:0in;line-height:normal'>${run(`${id} ${sentence(index + cell, 2)}`)}<o:p></o:p></p></td>`;
      }
      return { html: `${html}</tr>`, tokens, words: 9, counts: { tableRow: 1, tableCell: 3 } };
    },
  },
  'word-mixed-document': {
    envelope: 'word', unit: 'section',
    block(index) {
      // One heading, two plain paragraphs, one fragmented paragraph, three list items and a two-row table.
      const base = index * 12; const ids = Array.from({ length: 12 }, (_, offset) => token(base + offset));
      let html = `<h${index % 2 === 0 ? '1' : '2'}>${run(`${ids[0]} ${sentence(index, 3)}`)}<o:p></o:p></h${index % 2 === 0 ? '1' : '2'}>`;
      html += `<p class=MsoNormal>${run(`${ids[1]} ${sentence(index + 1, 14)}`)}<o:p></o:p></p>`;
      html += `<p class=MsoNormal>${run(`${ids[2]} ${sentence(index + 2, 14)}`)}<o:p></o:p></p>`;
      html += `<p class=MsoNormal><b>${run(`${ids[3]} ${sentence(index + 3, 4)}`)}</b>${run(' ')}<i>${run(`${ids[4]} ${sentence(index + 4, 4)}`)}</i>${run(' ')}`
        + `${run(`${ids[5]} ${sentence(index + 5, 4)}`, 'color:#C00000;mso-ansi-language:HR')}<o:p></o:p></p>`;
      html += wordListItem('l0', 1, '·', 'Symbol', `${ids[6]} ${sentence(index, 5)}`);
      html += wordListItem('l0', 2, 'o', '"Courier New"', `${ids[7]} ${sentence(index + 1, 5)}`);
      html += wordListItem('l1', 1, `${String(index + 1)}.`, undefined, `${ids[8]} ${sentence(index + 2, 5)}`);
      html += `<table class=MsoTableGrid border=1 cellspacing=0 cellpadding=0 style='border-collapse:collapse;border:none'>`
        + `<tr><td valign=top style='border:solid windowtext 1.0pt;padding:0in 5.4pt'><p class=MsoNormal>${run(`${ids[9]} ${sentence(index, 3)}`)}</p></td>`
        + `<td valign=top style='border:solid windowtext 1.0pt;padding:0in 5.4pt'><p class=MsoNormal>${run(`${ids[10]} ${sentence(index + 1, 3)}`)}</p></td></tr>`
        + `<tr><td colspan=2 valign=top style='border:solid windowtext 1.0pt;padding:0in 5.4pt'><p class=MsoNormal>${run(`${ids[11]} ${sentence(index + 2, 3)}`)}</p></td></tr></table>`;
      return { html, tokens: ids, words: 4 + 15 + 15 + 15 + 18 + 12, counts: { heading: 1, listItem: 3, table: 1, tableCell: 3 } };
    },
  },
  'gdocs-document': {
    envelope: 'gdocs', unit: 'paragraph',
    block(index) {
      const id = token(index);
      const span = 'font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;'
        + 'font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;';
      return { html: `<p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;"><span style="${span}">${id} ${sentence(index, 14)}</span></p>`,
        tokens: [id], words: 15, counts: { paragraph: 1 } };
    },
  },
  'heavily-formatted-runs': {
    envelope: 'plain', unit: 'paragraph',
    block(index) {
      const tokens = []; const words = [];
      for (let word = 0; word < 10; word++) {
        const id = token(index * 10 + word); tokens.push(id);
        words.push(`<b><i><span style="color:#123456;font-family:Georgia">${id}</span></i></b>`);
      }
      return { html: `<p>${words.join(' ')}</p>`, tokens, words: 10, counts: { paragraph: 1 } };
    },
  },
};

export const LARGE_PROFILES = Object.freeze(Object.keys(PROFILES));

/** The D4 qualification target, a target rather than current support. */
export const D4_TARGET_WORDS = 10_000;

/**
 * Single dispatch protocol for large fixtures: per engine, profile, policy and selected size, one
 * first paste and a few measured dispatches, each in a fresh editor. No paired baseline.
 */
export const LARGE_PROTOCOL = Object.freeze({
  id: 'domternal-paste-large-v1', browsers: Object.freeze(['chromium', 'firefox', 'webkit']),
  formatting: Object.freeze(['preserve', 'adapt']), measuredDispatches: 5,
  viewport: Object.freeze({ width: 1280, height: 800 }), deviceScaleFactor: 1,
  blockTimeoutMs: 120_000, runTimeoutMs: 45 * 60_000,
  // One synthetic RTF flavor above the per-flavor ceiling, next to HTML that alone would be accepted.
  rtfFlavor: Object.freeze({ profile: 'word-short-paragraphs', formatting: 'preserve', size: 10, units: 2_000_001 }),
});
export const LARGE_SMOKE = Object.freeze({ measuredDispatches: 1 });

const encoder = new TextEncoder();

/** Generate one profile at `size` block units. Identical inputs always produce identical output. */
export function generateLarge(profile, size) {
  const definition = Object.hasOwn(PROFILES, profile) ? PROFILES[profile] : undefined;
  if (!definition) throw new Error('Unknown large paste profile');
  if (!Number.isSafeInteger(size) || size < 1 || size > 200_000) throw new Error('Invalid large paste size');
  const pieces = []; const tokens = []; const counts = {}; let words = 0;
  for (let index = 0; index < size; index++) {
    const block = definition.block(index);
    pieces.push(block.html); tokens.push(...block.tokens); words += block.words;
    for (const [name, count] of Object.entries(block.counts)) counts[name] = (counts[name] ?? 0) + count;
  }
  let body = pieces.join('');
  if (definition.wrap) { body = definition.wrap(body); counts.table = 1; }
  const html = definition.envelope === 'word' ? WORD_HEAD + body + WORD_TAIL
    : definition.envelope === 'gdocs' ? `<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-0f1e2d3c-7fff-1234-5678-9abcdef01234">${body}</b>`
      : body;
  return Object.freeze({
    profile, size, unit: definition.unit, html, words, tokens: Object.freeze(tokens), counts: Object.freeze(counts),
    // The plain flavor browsers carry beside HTML, one CRLF line per token group.
    plain: tokens.join('\r\n'), utf16Units: html.length, utf8Bytes: encoder.encode(html).byteLength,
  });
}

/** Smallest size whose visible words reach the D4 target. */
export function sizeForWords(profile, words = D4_TARGET_WORDS) {
  const perBlock = generateLarge(profile, 1).words;
  return Math.ceil(words / perBlock);
}
