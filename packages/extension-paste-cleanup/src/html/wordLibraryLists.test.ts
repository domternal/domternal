// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { normalizePasteHTML } from './index.js';
import type { PasteDiagnostic } from './types.js';

/*
 * English text variants of recorded Word for Mac 16.113 clipboard shapes, not new native captures. The lists come from Word's own
 * libraries, from the owner's captures of 2026-10-03 (e2e/native-office-capture/fixtures, the
 * word-default-numbering fixtures): Word's raw HTML as Chrome 154 carries it, with CRLF line ends, and as
 * Firefox 155 carries it, with LF, and the list quirks shape of Safari 26.5. Word writes the third level of
 * its library numbering right aligned and pads its label with a spacer run of 7 pt no-break spaces that
 * fills the indent before it. The links Word writes to its local temporary files are left out.
 */
const policies = ['preserve', 'adapt'] as const;
const warnings = (diagnostics: readonly PasteDiagnostic[]): string[] => diagnostics.filter(entry => entry.severity !== 'info').map(entry => entry.code);
const codes = (diagnostics: readonly PasteDiagnostic[]): string[] => [...new Set(warnings(diagnostics))].sort();
// Word's raw HTML keeps the line breaks between its paragraphs, which stay between the rebuilt elements and render nothing.
const markup = (html: string): string => html.replace(/>[\t\n\f\r ]+</gu, '><').trim();

const LEVELS = '@list l0\n\t{mso-list-id:1085103442;\n\tmso-list-type:hybrid;\n\tmso-list-template-ids:-316794874 134807567 134807577 134807579 134807567 134807577 134807579 134807567 134807577 134807579;}\n'
  + '@list l0:level1\n\t{mso-level-tab-stop:none;\n\tmso-level-number-position:left;\n\ttext-indent:-18.0pt;}\n'
  + '@list l0:level2\n\t{mso-level-number-format:alpha-lower;\n\tmso-level-tab-stop:none;\n\tmso-level-number-position:left;\n\ttext-indent:-18.0pt;}\n'
  + '@list l0:level3\n\t{mso-level-number-format:roman-lower;\n\tmso-level-tab-stop:none;\n\tmso-level-number-position:right;\n\ttext-indent:-9.0pt;}';

interface Item { kind: string; level: number; label: string; text: string; lead?: number; trail: number }
/** L07 to L12 as Word shows them: 1. a. i. ii. b. 2.; the third level's spacer before its label is 92 and 89 units long. */
const NUMBERING: readonly Item[] = [
  { kind: 'CxSpFirst', level: 1, label: '1.', text: 'L07 First number', trail: 7 },
  { kind: 'CxSpMiddle', level: 2, label: 'a.', text: 'L08 Letter a', trail: 7 },
  { kind: 'CxSpMiddle', level: 3, label: 'i.', text: 'L09 Roman i', lead: 92, trail: 8 },
  { kind: 'CxSpMiddle', level: 3, label: 'ii.', text: 'L10 Roman ii', lead: 89, trail: 8 },
  { kind: 'CxSpMiddle', level: 2, label: 'b.', text: 'L11 Letter b', trail: 7 },
  { kind: 'CxSpLast', level: 1, label: '2.', text: 'L12 Second number', trail: 7 },
];

/** The paragraph style Word writes for a level: the third is right aligned, so its first line starts at the margin. */
const paragraphStyle = (level: number, eol: string): string => level === 1 ? 'text-indent:-18.0pt;mso-list:l0 level1 lfo1'
  : `margin-left:${String(level * 36)}.0pt;mso-add-space:${eol}auto;text-indent:${level === 3 ? '-108.0pt;mso-text-indent-alt:-9.0pt' : '-18.0pt'};mso-list:l0 level${String(level)} lfo1`;

/** Recorded raw Word shape with authored text: downlevel-revealed conditionals and line wraps inside tags. */
function rawWord(items: readonly Item[], eol: string, levels = LEVELS): string {
  const spacer = (count: number): string => `<span style='font:7.0pt "Times New Roman"'>${'&nbsp;'.repeat(count)}${eol}</span>`;
  const paragraphs = items.map(item => `<p class=MsoListParagraph${item.kind} style='${paragraphStyle(item.level, eol)}'><![if !supportLists]><span${eol}`
    + `style='mso-bidi-font-family:Aptos;mso-bidi-theme-font:minor-latin'><span${eol}style='mso-list:Ignore'>`
    + `${item.lead === undefined ? '' : spacer(item.lead)}${item.label}${spacer(item.trail)}</span></span><![endif]>${item.text}<o:p></o:p></p>`);
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office"${eol}xmlns:w="urn:schemas-microsoft-com:office:word"${eol}`
    + `xmlns:m="http://schemas.microsoft.com/office/2004/12/omml"${eol}xmlns="http://www.w3.org/TR/REC-html40">${eol}${eol}<head>${eol}`
    + `<meta http-equiv=Content-Type content="text/html; charset=utf-8">${eol}<meta name=ProgId content=Word.Document>${eol}`
    + `<meta name=Generator content="Microsoft Word 15">${eol}<meta name=Originator content="Microsoft Word 15">${eol}`
    + `<style>${eol}<!--${eol} /* List Definitions */${eol} ${levels.replaceAll('\n', eol)}${eol}-->${eol}</style>${eol}</head>${eol}${eol}`
    + `<body lang=en-HR style='tab-interval:36.0pt;word-wrap:break-word'>${eol}<!--StartFragment-->${eol}${eol}`
    + `${paragraphs.join(`${eol}${eol}`)}${eol}${eol}<!--EndFragment-->${eol}</body>${eol}${eol}</html>`;
}

/** Safari's list quirks shape: the stylesheet kept for list paragraphs, no-break spaces as characters and a converted space ending each spacer. */
function safariWord(items: readonly Item[], levels = LEVELS): string {
  const spacer = (count: number): string => `<span style="font:7.0pt &quot;Times New Roman&quot;">${'\u00a0'.repeat(count)}<span class="Apple-converted-space">\u00a0</span></span>`;
  const paragraphs = items.map(item => `<p class="MsoListParagraph${item.kind}" style="${paragraphStyle(item.level, '\n')}"><!--[if !supportLists]-->`
    + '<span style="mso-bidi-font-family:Aptos;mso-bidi-theme-font:minor-latin"><span style="mso-list:Ignore">'
    + `${item.lead === undefined ? '' : spacer(item.lead)}${item.label}${spacer(item.trail)}</span></span><!--[endif]-->${item.text}<o:p></o:p></p>`);
  return '<html xmlns:o="urn:schemas-microsoft-com:office:office"\nxmlns:w="urn:schemas-microsoft-com:office:word"\n'
    + 'xmlns:m="http://schemas.microsoft.com/office/2004/12/omml"\nxmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="UTF-8"></head>'
    + `<head><style class="WebKit-mso-list-quirks-style">\n<!--\n/* List Definitions */\n ${levels}\n-->\n</style></head>${paragraphs.join('')}</html>`;
}

const shapes = [
  ['Chrome', (items: readonly Item[], levels?: string): string => rawWord(items, '\r\n', levels)],
  ['Firefox', (items: readonly Item[], levels?: string): string => rawWord(items, '\n', levels)],
  ['Safari', safariWord],
] as const;

/** The nested lists of L07 to L12, with the marker wrapper's empty span that each reconstructed item keeps. */
const NESTED = '<ol style="list-style-type:decimal" start="1"><li><p><span></span>L07 First number</p>'
  + '<ol style="list-style-type:lower-alpha" start="1"><li><p><span></span>L08 Letter a</p>'
  + '<ol style="list-style-type:lower-roman" start="1"><li><p><span></span>L09 Roman i</p></li><li><p><span></span>L10 Roman ii</p></li></ol></li>'
  + '<li><p><span></span>L11 Letter b</p></li></ol></li><li><p><span></span>L12 Second number</p></li></ol>';

describe('Word library numbering with a right aligned level', () => {
  for (const [browser, html] of shapes) {
    it.each(policies)(`reconstructs the right aligned third level, whose label Word pads with a spacer, in ${browser}'s shape and %s`, formatting => {
      const result = normalizePasteHTML(html(NUMBERING), { formatting });
      expect(warnings(result.diagnostics)).toEqual([]);
      expect(markup(result.html)).toBe(NESTED);
      // The spacer is marker geometry the rebuilt list owns: none of it reaches the document.
      expect(result.html).not.toMatch(/\u00a0|&nbsp;/u);
    });

    it(`keeps the ordinals of a selection that starts inside the second level, in ${browser}'s shape`, () => {
      // word-list-partial-selection: from inside L08 to inside L11, so the first level opens above it.
      const items: Item[] = [{ kind: 'CxSpFirst', level: 2, label: 'a.', text: '<span>&nbsp;</span>a', trail: 7 }, ...NUMBERING.slice(2, 4),
        { kind: 'CxSpLast', level: 2, label: 'b.', text: 'L11 Letter', trail: 7 }];
      const result = normalizePasteHTML(html(items));
      expect(warnings(result.diagnostics)).toEqual([]);
      expect(markup(result.html)).toContain('<ol style="list-style-type:lower-roman" start="1"><li><p><span></span>L09 Roman i</p></li><li><p><span></span>L10 Roman ii</p></li></ol>');
      expect(markup(result.html)).toMatch(/^<ol style="list-style-type:decimal" start="1"><li><p><\/p><ol style="list-style-type:lower-alpha" start="1">/u);
    });
  }

  it('reads a deeper right aligned level, whose spacer fills a wider indent, the same way', () => {
    // Synthetic from the captured shape: the library's sixth level is right aligned too, with a longer spacer at its deeper indent.
    const levels = `${LEVELS}\n@list l0:level4\n\t{mso-level-tab-stop:none;\n\tmso-level-number-position:left;\n\ttext-indent:-18.0pt;}\n`
      + '@list l0:level5\n\t{mso-level-number-format:alpha-lower;\n\tmso-level-tab-stop:none;\n\tmso-level-number-position:left;\n\ttext-indent:-18.0pt;}\n'
      + '@list l0:level6\n\t{mso-level-number-format:roman-lower;\n\tmso-level-tab-stop:none;\n\tmso-level-number-position:right;\n\ttext-indent:-9.0pt;}';
    const items: Item[] = [...NUMBERING.slice(0, 3), { kind: 'CxSpMiddle', level: 4, label: '1.', text: 'Fourth', trail: 7 },
      { kind: 'CxSpMiddle', level: 5, label: 'a.', text: 'Fifth', trail: 7 }, { kind: 'CxSpLast', level: 6, label: 'iii.', text: 'Sixth', lead: 380, trail: 8 }];
    for (const [, html] of shapes) {
      const result = normalizePasteHTML(html(items, levels));
      expect(warnings(result.diagnostics)).toEqual([]);
      expect(markup(result.html)).toContain('<ol style="list-style-type:lower-roman" start="3"><li><p><span></span>Sixth</p></li></ol>');
    }
  });

  it('keeps the list of a label right aligned at the widest indent Word allows, and a marker literal whose spacing passes it', () => {
    // The captured spacer holds about one no-break space per point of the label's position: 92 before i. at 99 pt,
    // 89 before ii. So a label at Word's widest indent, 22 inches or 1,584 pt, follows about 1,600 of them.
    const item = (lead: number): Item[] => [{ kind: '', level: 3, label: 'i.', text: 'Spacing', lead, trail: 8 }];
    const ROMAN = '<ol style="list-style-type:lower-roman" start="1"><li><p><span></span>Spacing</p></li></ol>';
    for (const [browser, html] of shapes) {
      for (const lead of [900, 1_584, 1_650]) {
        const result = normalizePasteHTML(html(item(lead)));
        expect(warnings(result.diagnostics), `${browser} ${String(lead)}`).toEqual([]);
        expect(markup(result.html), `${browser} ${String(lead)}`).toContain(ROMAN);
      }
      expect(codes(normalizePasteHTML(html(item(2_100))).diagnostics), browser).toContain('office-list-unsupported');
    }
  });
});
