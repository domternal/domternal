// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { normalizePasteHTML } from './index.js';
import type { PasteDiagnostic } from './types.js';

// English text authored in Word's raw clipboard shape, not a new native capture; the captures in
// e2e/native-office-capture pin the native form. Word writes a run of hidden text (Format > Font > Hidden) as a span
// it hides with display:none and mso-hide:all.
const HIDDEN = "style='display:none;mso-hide:all'";
const word = (body: string, style = ''): string => '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">'
  + `<head><meta name=Generator content="Microsoft Word 15">${style === '' ? '' : `<style>\n<!--\n${style}\n-->\n</style>`}</head>`
  + `<body lang=EN-US><!--StartFragment-->${body}<!--EndFragment--></body></html>`;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC';
const warnings = (diagnostics: readonly PasteDiagnostic[]): string[] => diagnostics.filter(entry => entry.severity !== 'info').map(entry => entry.code);
const policies = ['preserve', 'adapt'] as const;
const item = (label: string, body: string, position = 'Middle'): string => `<p class=MsoListParagraphCxSp${position} style="mso-list:l0 level1 lfo1">`
  + `<![if !supportLists]><span style="mso-list:Ignore">${label}<span>&nbsp; </span></span><![endif]>${body}</p>`;

describe('Word hidden text', () => {
  it('is never pasted: a hidden run goes, with a warning at its offset, in both policies', () => {
    const html = word(`<p class=MsoNormal>B15 Visible part <span ${HIDDEN}>HIDDEN</span>\nend.<o:p></o:p></p>`);
    for (const formatting of policies) {
      const result = normalizePasteHTML(html, { formatting });
      expect(result.html).toBe('<p>B15 Visible part \nend.</p>');
      expect(result.diagnostics.filter(entry => entry.severity !== 'info'))
        .toEqual([{ code: 'hidden-text-removed', severity: 'warning', offset: html.indexOf(`<span ${HIDDEN}`) }]);
    }
  });

  it('is what both CSS and Word hide: display:none together with mso-hide:all, read as CSS reads a style', () => {
    for (const style of ['display:none;mso-hide:all', 'mso-hide:all;display:none', 'DISPLAY: NONE; MSO-HIDE: ALL', 'color:red;display:none;mso-hide:all;',
      'display:none !important;mso-hide:all;display:inline', 'display:/* hidden */none;mso-hide:all', 'font-family:"a;b";display:none;mso-hide:all']) {
      const result = normalizePasteHTML(word(`<p class=MsoNormal>Seen <span style='${style}'>Unseen</span></p>`));
      expect(result.html, style).not.toContain('Unseen');
      expect(warnings(result.diagnostics), style).toEqual(['hidden-text-removed']);
    }
    // One of the two is no hidden text of Word's: the text stays, its hiding a reported formatting loss, as before.
    for (const style of ['display:none', 'mso-hide:all', 'display:none;mso-hide:all;display:inline', 'display:none;mso-hide:all;mso-hide:none',
      'font-family:"a;display:none;mso-hide:all;b"', 'display:none ! important;mso-hide:screen']) {
      const result = normalizePasteHTML(word(`<p class=MsoNormal>Seen <span style='${style}'>Shown</span></p>`));
      expect(result.html, style).toContain('Shown');
      expect(warnings(result.diagnostics), style).not.toContain('hidden-text-removed');
    }
  });

  it('keeps Word\'s web hidden text, which Word shows on the page, such as a table of contents\' leaders and page numbers', () => {
    const toc = word('<p class=MsoToc1><span class=MsoHyperlink><a href="#_Toc1">Introduction'
      + "<span style='color:windowtext;display:none;mso-hide:screen;text-decoration:none'><span style='mso-tab-count:1 dotted'>. . . </span></span>"
      + "<span style='color:windowtext;display:none;mso-hide:screen;text-decoration:none'>3</span></a></span><o:p></o:p></p>");
    const result = normalizePasteHTML(toc);
    expect(result.html).toContain('. . . ');
    expect(result.html).toContain('3');
    expect(warnings(result.diagnostics)).not.toContain('hidden-text-removed');
    expect(warnings(result.diagnostics)).toContain('unsupported-formatting');
  });

  it('is read from the class rules of Word\'s stylesheet, as a hidden character or paragraph style writes it', () => {
    const style = '/* Font Definitions */\n@font-face\n\t{font-family:Aptos;\n\tpanose-1:2 11 0 4 2 2 2 2 2 4;}\n'
      + '/* Style Definitions */\np.MsoNormal, li.MsoNormal, div.MsoNormal\n\t{margin:0cm;\n\tfont-size:12.0pt;}\n'
      + 'span.HiddenChar\n\t{mso-style-name:"Hidden Char";\n\tdisplay:none;\n\tmso-hide:all;}\n'
      + 'p.HiddenParagraph, li.HiddenParagraph, div.HiddenParagraph\n\t{mso-style-name:"Hidden Paragraph";\n\tdisplay:none;\n\tmso-hide:all;}\n'
      + '.WebOnly\n\t{display:none;}\n@list l0:level1\n\t{mso-level-tab-stop:none;}';
    const result = normalizePasteHTML(word('<p class=MsoNormal>Visible <span class=HiddenChar>SECRET</span> end<o:p></o:p></p>'
      + '<p class=HiddenParagraph>Hidden paragraph<o:p></o:p></p>'
      + '<p class=MsoNormal><span class=WebOnly>Kept</span> <span class=HiddenChar style="mso-hide:none">Shown</span><o:p></o:p></p>'
      // A rule for another element type does not apply.
      + '<p class=MsoNormal><b class=HiddenParagraph>Bold</b><o:p></o:p></p>', style));
    expect(result.html).toBe('<p>Visible  end</p><p><span>Kept</span> <span>Shown</span></p><p><span><strong>Bold</strong></span></p>');
    expect(warnings(result.diagnostics)).toEqual(['hidden-text-removed', 'hidden-text-removed']);
  });

  it('takes a wholly hidden paragraph, heading or list item with it, its paragraph mark hidden too, and no empty block is left', () => {
    const html = word(`<p class=MsoNormal><span ${HIDDEN}>Hidden paragraph<o:p></o:p></span></p>`
      + `<h2><span ${HIDDEN}>Hidden heading<o:p></o:p></span></h2>`
      + `<p class=MsoNormal style='display:none;mso-hide:all'>Hidden block<o:p></o:p></p>`
      + '<p class=MsoNormal>Visible<o:p></o:p></p>');
    for (const formatting of policies) {
      const result = normalizePasteHTML(html, { formatting });
      expect(result.html).toBe('<p>Visible</p>');
      expect(warnings(result.diagnostics)).toEqual(['hidden-text-removed', 'hidden-text-removed', 'hidden-text-removed']);
    }
  });

  it('keeps a paragraph whose text alone is hidden as the empty line Word shows for its visible paragraph mark', () => {
    const result = normalizePasteHTML(word(`<p class=MsoNormal>A<o:p></o:p></p><p class=MsoNormal><span ${HIDDEN}>gone</span><o:p>&nbsp;</o:p></p>`
      + `<h2><span ${HIDDEN}>Hidden heading</span><o:p></o:p></h2><p class=MsoNormal>B<o:p></o:p></p>`));
    expect(result.html).toBe('<p>A</p><p></p><h2></h2><p>B</p>');
    expect(warnings(result.diagnostics)).toEqual(['hidden-text-removed', 'hidden-text-removed']);
  });

  it('leaves a hidden list item out of one list, numbered as if it were not there', () => {
    const middle = normalizePasteHTML(word(item('1.', 'First<o:p></o:p>', 'First') + item('2.', `<span ${HIDDEN}>Hidden item<o:p></o:p></span>`)
      + item('3.', 'Third<o:p></o:p>', 'Last')));
    expect(middle.html).toBe('<ol style="list-style-type:decimal" start="1"><li><p>First</p></li><li><p>Third</p></li></ol>');
    expect(warnings(middle.diagnostics)).toEqual(['hidden-text-removed']);
    // The marker Word writes in the paragraph mark's formatting goes with it, as the list's own marker.
    const first = normalizePasteHTML(word(`<p class=MsoListParagraphCxSpFirst style="mso-list:l0 level1 lfo1"><![if !supportLists]><span ${HIDDEN}>`
      + '<span style="mso-list:Ignore">1.<span>&nbsp; </span></span></span><![endif]>'
      + `<span ${HIDDEN}>Hidden item<o:p></o:p></span></p>` + item('2.', 'Second<o:p></o:p>') + item('3.', 'Third<o:p></o:p>', 'Last')));
    expect(first.html).toBe('<ol style="list-style-type:decimal" start="1"><li><p>Second</p></li><li><p>Third</p></li></ol>');
    expect(warnings(first.diagnostics)).toEqual(['hidden-text-removed']);
    // An item cleanup cannot rebuild is no finding when it is hidden: it is not pasted.
    const literal = normalizePasteHTML(word(item('1.', 'First<o:p></o:p>', 'First') + item('(x)', `<span ${HIDDEN}>Hidden item<o:p></o:p></span>`)
      + item('2.', 'Second<o:p></o:p>', 'Last')));
    expect(literal.html).not.toContain('Hidden item');
    expect(literal.html).not.toContain('(x)');
    expect(warnings(literal.diagnostics)).toEqual(['hidden-text-removed']);
  });

  it('keeps a cell, its table and the visible text around a hidden run', () => {
    const html = word(`<table class=MsoTableGrid><tr><td><p class=MsoNormal><span ${HIDDEN}>Hidden cell text<o:p></o:p></span></p></td>`
      + '<td><p class=MsoNormal>Visible cell<o:p></o:p></p></td></tr></table>'
      + `<p class=MsoNormal>Before<span ${HIDDEN}>hidden</span>after<o:p></o:p></p>`);
    const result = normalizePasteHTML(html);
    expect(result.html).not.toContain('Hidden cell text');
    expect(result.html.match(/<td/g)).toHaveLength(2);
    expect(result.html).toContain('Visible cell');
    // Word shows the words around a hidden run together, as the paste does.
    expect(result.html).toContain('Beforeafter');
    expect(warnings(result.diagnostics)).toEqual(['hidden-text-removed', 'hidden-text-removed']);
  });

  it('keeps a hidden cell\'s and column\'s place in the table, without their content and without a formatting finding', () => {
    const result = normalizePasteHTML(word(`<table class=MsoTableGrid><colgroup><col width=80 ${HIDDEN}><col width=80></colgroup>`
      + `<tr><td ${HIDDEN}><p class=MsoNormal>Hidden cell<o:p></o:p></p></td><td><p class=MsoNormal>Visible<o:p></o:p></p></td></tr></table>`));
    expect(result.html).not.toContain('Hidden cell');
    expect(result.html.match(/<td/g)).toHaveLength(2);
    expect(warnings(result.diagnostics)).toEqual(['hidden-text-removed']);
  });

  it('takes a hidden picture with it, without reporting a removed image', () => {
    const result = normalizePasteHTML(word(`<p class=MsoNormal>Text<span ${HIDDEN}><img src="${PNG}" alt="Hidden picture"></span><o:p></o:p></p>`));
    expect(result.html).toBe('<p>Text</p>');
    expect(warnings(result.diagnostics)).toEqual(['hidden-text-removed']);
  });

  it('reports nothing for a hidden run that holds no text, such as a hidden paragraph mark', () => {
    const result = normalizePasteHTML(word(`<p class=MsoNormal>Visible<span ${HIDDEN}><o:p></o:p></span></p><p class=MsoNormal><span ${HIDDEN}> </span>Next</p>`));
    expect(result.html).toBe('<p>Visible</p><p>Next</p>');
    expect(warnings(result.diagnostics)).toEqual([]);
  });

  it('applies to Word sources only: a page that hides an element keeps today\'s behavior, its text kept with unsupported-formatting', () => {
    for (const html of ['<p>Seen <span style="display:none">Menu</span></p>', '<p>Seen <span style="visibility:hidden">Kept</span></p>',
      '<b style="font-weight:normal;" id="docs-internal-guid-1a2b3c"><p dir="ltr"><span style="display:none">Kept</span></p></b>',
      // A page that only names Office's properties in its text, or carries a class Word once wrote, is read as Word's but hides nothing of Word's.
      '<p>Outlook tip: mso-hide keeps things out.</p><div style="display:none"><p>Menu</p></div>',
      '<p class="MsoNormal">Policy text</p><p><span style="display:none">Kept</span>Visible</p>']) {
      const result = normalizePasteHTML(html);
      expect(result.html, html).toMatch(/Menu|Kept/);
      expect(warnings(result.diagnostics), html).toEqual(['unsupported-formatting']);
    }
    // Hidden in Word only as invisible text: visibility is no hiding signal of Word's.
    const invisible = normalizePasteHTML(word('<p class=MsoNormal>Seen <span style="visibility:hidden">Kept</span></p>'));
    expect(invisible.html).toContain('Kept');
    expect(warnings(invisible.diagnostics)).toEqual(['unsupported-formatting']);
  });
});
