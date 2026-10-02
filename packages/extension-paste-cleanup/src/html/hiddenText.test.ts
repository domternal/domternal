// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { normalizePasteHTML } from './index.js';
import type { PasteDiagnostic } from './types.js';

// English text authored in Word's raw clipboard shape, not a new native capture; the captures in
// e2e/native-office-capture pin the native form. Word writes a run of hidden text (Format > Font > Hidden) as a span
// it hides with display:none and mso-hide:all.
const HIDDEN = "style='display:none;mso-hide:all'";
const word = (body: string): string => '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">'
  + `<head><meta name=Generator content="Microsoft Word 15"></head><body lang=EN-US><!--StartFragment-->${body}<!--EndFragment--></body></html>`;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC';
const warnings = (diagnostics: readonly PasteDiagnostic[]): string[] => diagnostics.filter(entry => entry.severity !== 'info').map(entry => entry.code);
const policies = ['preserve', 'adapt'] as const;

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

  it('is hidden by either of Word\'s signals, in any letter case and with !important, until a later declaration shows it again', () => {
    for (const style of ['display:none', 'mso-hide:all', 'DISPLAY: NONE', 'display:none !important', 'mso-hide:all;display:inline', 'color:red;display:none']) {
      const result = normalizePasteHTML(word(`<p class=MsoNormal>Seen <span style="${style}">Unseen</span></p>`));
      expect(result.html, style).not.toContain('Unseen');
      expect(warnings(result.diagnostics), style).toEqual(['hidden-text-removed']);
    }
    // mso-hide alone makes markup a Word source: Office hidden text in a bare fragment is not pasted either.
    const bare = normalizePasteHTML('<p><span style="mso-hide:all">Text</span>Seen</p>');
    expect([bare.source, bare.html, warnings(bare.diagnostics)]).toEqual(['word', '<p>Seen</p>', ['hidden-text-removed']]);
    // A later display wins over display:none, as CSS reads it, and Word writes mso-hide:all with every hidden run.
    const shown = normalizePasteHTML(word('<p class=MsoNormal>Seen <span style="display:none;display:inline">Shown</span></p>'));
    expect(shown.html).toContain('Shown');
    expect(warnings(shown.diagnostics)).toEqual(['unsupported-formatting']);
  });

  it('takes a wholly hidden paragraph, heading or list item with it, and no empty block is left in its place', () => {
    const html = word(`<p class=MsoNormal><span ${HIDDEN}>Hidden paragraph<o:p></o:p></span></p>`
      + `<h2><span ${HIDDEN}>Hidden heading</span><o:p></o:p></h2>`
      + `<p class=MsoNormal style='display:none;mso-hide:all'>Hidden block<o:p></o:p></p>`
      + '<p class=MsoNormal>Visible<o:p></o:p></p>');
    for (const formatting of policies) {
      const result = normalizePasteHTML(html, { formatting });
      expect(result.html).toBe('<p>Visible</p>');
      expect(warnings(result.diagnostics)).toEqual(['hidden-text-removed', 'hidden-text-removed', 'hidden-text-removed']);
    }
    const list = word('<p class=MsoListParagraphCxSpFirst style="mso-list:l0 level1 lfo1"><![if !supportLists]><span style="mso-list:Ignore">1.<span>&nbsp; </span></span><![endif]>First<o:p></o:p></p>'
      + `<p class=MsoListParagraphCxSpMiddle style="mso-list:l0 level1 lfo1"><![if !supportLists]><span style="mso-list:Ignore">2.<span>&nbsp; </span></span><![endif]><span ${HIDDEN}>Hidden item<o:p></o:p></span></p>`
      + '<p class=MsoListParagraphCxSpLast style="mso-list:l0 level1 lfo1"><![if !supportLists]><span style="mso-list:Ignore">3.<span>&nbsp; </span></span><![endif]>Third<o:p></o:p></p>');
    const items = normalizePasteHTML(list);
    expect(items.html).not.toContain('Hidden item');
    expect(items.html.match(/<li/g)).toHaveLength(2);
    expect(items.html).toMatch(/First[\s\S]*Third/);
    expect(warnings(items.diagnostics)).toEqual(['hidden-text-removed']);
  });

  it('keeps a cell, its table and the visible text around a hidden run', () => {
    const html = word(`<table class=MsoTableGrid><tr><td><p class=MsoNormal><span ${HIDDEN}>Hidden cell text</span><o:p></o:p></p></td>`
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
      '<b style="font-weight:normal;" id="docs-internal-guid-1a2b3c"><p dir="ltr"><span style="display:none">Kept</span></p></b>']) {
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
