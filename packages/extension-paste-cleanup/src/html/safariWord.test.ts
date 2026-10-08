// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { normalizePasteHTML } from './index.js';
import type { PasteDiagnostic } from './types.js';

/*
 * English text variants of recorded Word for Mac 16.113 to Safari 26.5 clipboard shapes, not new native captures.
 * Element shapes come from e2e/native-office-capture/fixtures (the synthetic word-mac-v1 documents). Safari writes
 * the computed style of each top-level element it copies, including the page's text and caret color, which
 * was white in these captures: Word's automatic color in a page shown in dark mode.
 */
const WORD = '<html xmlns:o="urn:schemas-microsoft-com:office:office"\nxmlns:w="urn:schemas-microsoft-com:office:word"\n'
  + 'xmlns:m="http://schemas.microsoft.com/office/2004/12/omml"\nxmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="UTF-8"></head>';
const INTERCHANGE = 'font-style: normal; font-variant-caps: normal; font-weight: 400; letter-spacing: normal; orphans: 2; text-align: start; '
  + 'text-indent: 0px; text-transform: none; white-space: normal; widows: 2; word-spacing: 0px; -webkit-text-stroke-width: 0px; '
  + 'text-decoration-line: none; text-decoration-thickness: auto; text-decoration-style: solid;';
const WHITE = 'caret-color: rgb(255, 255, 255); color: rgb(255, 255, 255);';
const normal = (text: string, box = 'margin: 0cm 0cm 8pt', extra = ''): string =>
  `<p class="MsoNormal" style="${box}; line-height: 18.4px; font-size: medium; font-family: Aptos, sans-serif; ${WHITE} ${INTERCHANGE}${extra}">${text}<o:p></o:p></p>`;
const TITLE = '<p class="MsoTitle" style="margin: 0cm 0cm 4pt; font-size: 28pt; font-family: &quot;Aptos Display&quot;, sans-serif; letter-spacing: -0.5pt; '
  + `${WHITE} font-style: normal; font-variant-caps: normal; font-weight: 400; orphans: 2; text-align: start; text-indent: 0px; text-transform: none; `
  + 'white-space: normal; widows: 2; word-spacing: 0px; -webkit-text-stroke-width: 0px; text-decoration-line: none; text-decoration-thickness: auto; '
  + 'text-decoration-style: solid;">B01 Paste test document<o:p></o:p></p>';
const heading = (tag: string, size: string, lineHeight: string, text: string): string =>
  `<${tag} style="margin: 18pt 0cm 4pt; line-height: ${lineHeight}; break-after: avoid; font-size: ${size}; font-family: &quot;Aptos Display&quot;, sans-serif; `
  + 'color: rgb(15, 71, 97); font-weight: normal; font-style: normal; font-variant-caps: normal; letter-spacing: normal; orphans: 2; text-align: start; '
  + 'text-indent: 0px; text-transform: none; white-space: normal; widows: 2; word-spacing: 0px; -webkit-text-stroke-width: 0px; text-decoration-line: none; '
  + `text-decoration-thickness: auto; text-decoration-style: solid;">${text}<o:p></o:p></${tag}>`;
const ROUTINE = `${WORD}${TITLE}${heading('h1', '20pt', '30.666664px', 'B02 Croatian characters and quotation marks')}`
  + `${normal('B03 Lowercase č ć đ š ž, uppercase Č Ć Đ Š Ž.')}${normal('B05 Nonbreaking space between 10\u00a0kg.')}</html>`;
const space = '<span class="Apple-converted-space">\u00a0</span>';
const INLINE = `${WORD}${normal(`B07${space}<b>bold</b>${space}<i>italic</i>${space}H<sub>2</sub>O x<sup>2</sup>${space}`
  + `<span style="font-size: 14pt; line-height: 21.466665px; font-family: Georgia, serif;">Georgia</span>${space}<span style="color: red;">red</span>`
  + `${space}<span style="background: yellow;">highlighted</span>`)}</html>`;
const CELL = (text: string, style: string, attributes = ''): string => `<td width="201" valign="top"${attributes} style="${style}"><p class="MsoNormal" `
  + `style="margin: 0cm 0cm 8pt; line-height: 18.4px; font-size: 12pt; font-family: Aptos, sans-serif;">${text}<o:p></o:p></p></td>`;
const TABLE = `${WORD}<table class="MsoNormalTable" border="1" cellspacing="0" cellpadding="0" width="602" style="${WHITE} font-style: normal; `
  + 'font-variant-caps: normal; font-weight: 400; letter-spacing: normal; orphans: 2; text-align: start; text-transform: none; white-space: normal; widows: 2; '
  + 'word-spacing: 0px; -webkit-text-stroke-width: 0px; text-decoration-line: none; text-decoration-thickness: auto; text-decoration-style: solid; '
  + 'border-collapse: collapse; border: medium;"><tbody><tr>'
  + CELL('T02 Column A', 'width: 150.4pt; border: 1pt solid windowtext; padding: 0cm 5.4pt;')
  + CELL('T03 Column B', 'width: 150.45pt; border-width: 1pt 1pt 1pt medium; border-style: solid solid solid none; border-color: windowtext windowtext windowtext currentcolor; border-image: none; padding: 0cm 5.4pt;')
  + '</tr><tr>'
  + CELL('<span style="color: black;">T05 Gray cell</span>', 'width: 150.4pt; border-width: medium 1pt 1pt; border-style: none solid solid; border-color: currentcolor windowtext windowtext; border-image: none; background: rgb(217, 217, 217); padding: 0cm 5.4pt;')
  + CELL('T06 Plain cell', 'width: 150.45pt; border-width: medium 1pt 1pt medium; border-style: none solid solid none; border-color: currentcolor windowtext windowtext currentcolor; padding: 0cm 5.4pt;')
  + '</tr></tbody></table></html>';

const warnings = (diagnostics: readonly PasteDiagnostic[]): string[] => diagnostics.filter(entry => entry.severity !== 'info').map(entry => entry.code);
const policies = ['preserve', 'adapt'] as const;

describe('Safari copies of Word: computed styles read as Word means them', () => {
  it.each(policies)('pastes the routine envelope in %s without a warning, Word automatic color as the default color', formatting => {
    const result = normalizePasteHTML(ROUTINE, { formatting });
    expect(warnings(result.diagnostics)).toEqual([]);
    expect(result.html).not.toMatch(/255, 255, 255|caret|white-space|text-align|stroke|thickness|letter-spacing/u);
    if (formatting === 'preserve') {
      // The heading style's own color comes without a caret color and stays.
      expect(result.html).toContain('<h1><span style="font-family:&#x22;Aptos Display&#x22;, sans-serif;font-size:20pt;color:rgb(15, 71, 97)">B02');
      expect(result.html).toContain('<p><span style="font-family:Aptos, sans-serif">B03');
    }
  });

  it('keeps a text color that differs from the caret color, and any color without one', () => {
    const differs = normalizePasteHTML(`${WORD}<p class="MsoNormal" style="caret-color: rgb(0, 0, 0); color: rgb(192, 0, 0);">Red</p></html>`);
    expect(differs.html).toBe('<p><span style="color:rgb(192, 0, 0)">Red</span></p>');
    expect(warnings(differs.diagnostics)).toEqual([]);
    const own = normalizePasteHTML('<p style="color: rgb(255, 255, 255)">White</p>');
    expect(own.html).toBe('<p><span style="color:rgb(255, 255, 255)">White</span></p>');
  });

  it('takes only Word\'s caret color for automatic text; a web page keeps a colored container and drops only its neutral text color', () => {
    // Safari's interchange copy of a web page: the computed color and caret color of each top-level element.
    const web = (color: string, text: string): string => `<meta charset="utf-8"><p style="caret-color: ${color}; color: ${color}; font-size: medium; ${INTERCHANGE}">${text}</p>`;
    const red = normalizePasteHTML(web('rgb(200, 0, 0)', 'Red warning paragraph'));
    expect(red.source).not.toBe('word');
    expect(red.html).toBe('<p><span style="color:rgb(200, 0, 0)">Red warning paragraph</span></p>');
    expect(warnings(red.diagnostics)).toEqual([]);
    // A page's default text color, light or dark, is the reader's default, not the author's.
    for (const neutral of ['rgb(224, 224, 224)', 'rgb(0, 0, 0)', 'rgb(26, 26, 26)', 'rgb(255, 255, 255)', 'rgb(51, 51, 51)', '#1a1a1a', 'rgb(40, 44, 52)']) {
      const result = normalizePasteHTML(web(neutral, 'Page text'));
      expect(result.html, neutral).toBe('<p>Page text</p>');
      expect(warnings(result.diagnostics), neutral).toEqual([]);
    }
    // Close to gray but tinted beyond the neutral spread is a color the page chose.
    expect(normalizePasteHTML(web('rgb(30, 60, 90)', 'Tinted')).html).toBe('<p><span style="color:rgb(30, 60, 90)">Tinted</span></p>');
    // In a Word copy any color equal to the caret color is Word's automatic color, white or red alike.
    for (const automatic of ['rgb(255, 255, 255)', 'rgb(200, 0, 0)']) {
      const word = normalizePasteHTML(`${WORD}<p class="MsoNormal" style="caret-color: ${automatic}; color: ${automatic}; ${INTERCHANGE}">Auto</p></html>`);
      expect(word.html, automatic).toBe('<p>Auto</p>');
    }
  });

  it.each(policies)('resets an inherited size to the default where a nested element declares font-size: medium, in %s', formatting => {
    const word = normalizePasteHTML(`${WORD}<p class="MsoNormal" style="font-size: 20pt">Big <span style="font-size: medium">normal</span> big</p></html>`, { formatting });
    const web = normalizePasteHTML('<meta charset="utf-8"><p style="font-size: 20pt">Big <span style="font-size: medium">normal</span> big</p>', { formatting });
    for (const result of [word, web]) {
      expect(warnings(result.diagnostics)).toEqual([]);
      if (formatting === 'preserve') {
        expect(result.html).toBe('<p><span style="font-size:20pt">Big </span><span>normal</span><span style="font-size:20pt"> big</span></p>');
      } else expect(result.html).toBe('<p>Big <span>normal</span> big</p>');
    }
    // A later declaration wins either way, and a size inside the reset applies again.
    expect(normalizePasteHTML('<p style="font-size: 20pt"><span style="font-size: medium; font-size: 12pt">A</span></p>').html).toContain('font-size:12pt">A');
    expect(normalizePasteHTML('<p style="font-size: 20pt"><span style="font-size: 12pt; font-size: medium">A</span></p>').html).toBe('<p><span>A</span></p>');
    expect(normalizePasteHTML('<p style="font-size: 20pt"><span style="font-size: medium"><span style="font-size: 9pt">A</span></span></p>').html).toContain('font-size:9pt">A');
    // The keyword at the top, as Safari writes it on every element it copies, has nothing to reset.
    expect(normalizePasteHTML('<p style="font-size: medium">A</p>').html).toBe('<p>A</p>');
  });

  it('drops the automatic color a table passes to its cells and keeps a cell run color Word wrote', () => {
    const result = normalizePasteHTML(TABLE);
    expect(warnings(result.diagnostics)).toEqual([]);
    expect(result.html).not.toContain('255, 255, 255');
    expect(result.html).toContain('<span style="font-family:Aptos, sans-serif;font-size:12pt;color:black">T05 Gray cell</span>');
  });

  it('reads a Word cell shading shorthand as the cell background and a highlight shorthand as a highlight', () => {
    const table = normalizePasteHTML(TABLE);
    expect(table.html).toContain('<td data-background="rgb(217, 217, 217)" style="width:150.4pt;background-color:rgb(217, 217, 217)">');
    const preserve = normalizePasteHTML(INLINE);
    expect(warnings(preserve.diagnostics)).toEqual([]);
    expect(preserve.html).toContain('<span style="font-family:Aptos, sans-serif;background-color:yellow">highlighted</span>');
    const adapt = normalizePasteHTML(INLINE, { formatting: 'adapt' });
    expect(warnings(adapt.diagnostics)).toEqual([]);
    expect(adapt.html).toContain('<span>highlighted</span>');
    expect(adapt.diagnostics.some(entry => entry.code === 'formatting-adapted' && entry.offset === INLINE.indexOf('<span style="background'))).toBe(true);
  });

  it.each([
    ['an image', 'background: url(x) yellow'],
    ['two colors', 'background: yellow red'],
    ['a keyword only', 'background: inherit'],
  ])('keeps warning about a background shorthand with %s', (_name, style) => {
    const result = normalizePasteHTML(`<p><span style="${style}">Text</span></p>`);
    expect(warnings(result.diagnostics)).toEqual(['unsupported-formatting']);
    expect(result.html).toBe('<p><span>Text</span></p>');
  });

  it('lets a later declaration win between a background color and a background shorthand', () => {
    expect(normalizePasteHTML('<p><span style="background-color: red; background: yellow">A</span></p>').html).toContain('background-color:yellow');
    expect(normalizePasteHTML('<p><span style="background: yellow; background-color: red">A</span></p>').html).toContain('background-color:red');
  });

  it('pastes the spaces WebKit converted as spaces in every engine, and leaves other spans and no-break spaces', () => {
    const result = normalizePasteHTML(INLINE, { formatting: 'adapt' });
    expect(result.html).toBe('<p>B07 <span><strong>bold</strong></span> <span><em>italic</em></span> H<span><sub>2</sub></span>O x<span><sup>2</sup></span> '
      + '<span>Georgia</span> <span>red</span> <span>highlighted</span></p>');
    expect(normalizePasteHTML(ROUTINE).html).toContain('10\u00a0kg.');
    for (const kept of ['<span class="Apple-converted-space">\u00a0\u00a0</span>', '<b class="Apple-converted-space">\u00a0</b>']) {
      expect(normalizePasteHTML(`<p>A${kept}B</p>`).html).toContain('\u00a0');
    }
    // Another class is removed, and the bare span left pastes as a space, as Chromium's paste turns it.
    expect(normalizePasteHTML('<p>A<span class="Other">\u00a0</span>B</p>').html).toBe('<p>A B</p>');
  });

  it.each(policies)('reads Word\'s Title style as a level 1 heading in %s', formatting => {
    const result = normalizePasteHTML(ROUTINE, { formatting });
    expect(result.html.startsWith(formatting === 'preserve'
      ? '<h1><span style="font-family:&#x22;Aptos Display&#x22;, sans-serif;font-size:28pt">B01' : '<h1>B01')).toBe(true);
    // Only a Word source names the Title style; an ordinary class of that name stays a paragraph.
    expect(normalizePasteHTML('<p class="MsoTitle">Heading</p>').html).toBe('<p>Heading</p>');
  });

  it.each(policies)('reads a Title of several paragraphs, written with Word\'s contextual spacing classes, as level 1 headings in %s', formatting => {
    const title = (variant: string, text: string): string => TITLE.replace('class="MsoTitle"', `class="${variant}"`).replace('B01 Paste test document', text);
    const source = `${WORD}${title('MsoTitleCxSpFirst', 'First line')}${title('MsoTitleCxSpMiddle', 'Middle line')}${title('MsoTitleCxSpLast', 'Last line')}`
      + `<p class="MsoSubtitle">Subtitle</p><p class="MsoSubtitleCxSpFirst">Subtitle two</p>${normal('Text')}</html>`;
    const result = normalizePasteHTML(source, { formatting });
    expect(warnings(result.diagnostics)).toEqual([]);
    const blocks = [...result.html.matchAll(/<(h1|p)\b[^>]*>(?:<span[^>]*>)?([^<]*)/gu)].map(match => `${match[1] ?? ''} ${match[2] ?? ''}`);
    // Each Title paragraph is its own level 1 heading, as Pro's DOCX import maps every Title paragraph; a subtitle stays a paragraph.
    expect(blocks).toEqual(['h1 First line', 'h1 Middle line', 'h1 Last line', 'p Subtitle', 'p Subtitle two', 'p Text']);
    // A name that only starts like the Title classes is not one of them.
    expect(normalizePasteHTML(`${WORD}<p class="MsoTitleCxSpOther">Other</p></html>`).html).toBe('<p>Other</p>');
    expect(normalizePasteHTML('<p class="MsoTitleCxSpFirst">Heading</p>').html).toBe('<p>Heading</p>');
  });

  it('reads a computed line height as a ratio of its block font size and Word\'s default 1.15 as no spacing of its own', () => {
    const spacing = `${WORD}${heading('h3', '14pt', '21.466665px', 'B08 Alignment and spacing')}`
      + normal('B09 Centered paragraph.', 'margin: 0cm 0cm 8pt', ' text-align: center;')
      + `<p class="MsoNormal" style="margin: 0cm 0cm 8pt; line-height: 24px; font-size: medium; font-family: Aptos, sans-serif; ${WHITE} ${INTERCHANGE}">B12 Paragraph with 1.5 line spacing.<o:p></o:p></p></html>`;
    const result = normalizePasteHTML(spacing);
    expect(warnings(result.diagnostics)).toEqual([]);
    expect(result.html).toBe('<h3><span style="font-family:&#x22;Aptos Display&#x22;, sans-serif;font-size:14pt;color:rgb(15, 71, 97)">B08 Alignment and spacing</span></h3>'
      + '<p style="text-align:center"><span style="font-family:Aptos, sans-serif">B09 Centered paragraph.</span></p>'
      + '<p style="line-height:1.5"><span style="font-family:Aptos, sans-serif">B12 Paragraph with 1.5 line spacing.</span></p>');
    // Another source keeps its spacing, now as the ratio a LineHeight destination renders.
    expect(normalizePasteHTML('<p style="font-size: 16px; line-height: 18.4px">Text</p>').html).toBe('<p style="line-height:1.15"><span style="font-size:16px">Text</span></p>');
    // Without a font size of its own the length is read as before.
    expect(normalizePasteHTML('<p style="line-height: 24px">Text</p>').html).toBe('<p style="line-height:24px">Text</p>');
    // A percentage is a ratio of the font size whatever the size, so it becomes the ratio LineHeight renders.
    expect(normalizePasteHTML('<p style="line-height: 150%">Text</p>').html).toBe('<p style="line-height:1.5">Text</p>');
  });

  it('drops Word\'s default line height that Safari writes on a sized run, without a warning', () => {
    const result = normalizePasteHTML(INLINE);
    expect(result.html).toContain('<span style="font-family:Georgia, serif;font-size:14pt">Georgia</span>');
    expect(warnings(result.diagnostics)).toEqual([]);
  });

  it('keeps reporting the indentation losses that Safari writes among its computed declarations', () => {
    const html = `${WORD}${normal('B13 Paragraph with a 1.27 cm left indent.', 'margin: 0cm 0cm 8pt 36pt')}`
      + `<p class="MsoNormal" style="margin: 0cm 0cm 8pt; line-height: 18.4px; font-size: medium; font-family: Aptos, sans-serif; ${WHITE} `
      + `${INTERCHANGE.replace('text-indent: 0px; ', '')} text-indent: 36pt;">B14 Paragraph with a first-line indent.<o:p></o:p></p></html>`;
    for (const formatting of policies) {
      const result = normalizePasteHTML(html, { formatting });
      expect(result.diagnostics.filter(entry => entry.severity !== 'info').map(entry => [entry.code, entry.offset]))
        .toEqual([['unsupported-formatting', html.indexOf('<p class="MsoNormal"')], ['unsupported-formatting', html.lastIndexOf('<p class="MsoNormal"')]]);
    }
  });

  it('does not report the empty span WebKit ends a partial copy with, and still reports a run that holds text', () => {
    const tail = `<span style="${WHITE} font-family: -webkit-standard; font-size: medium; font-style: normal; font-variant-caps: normal; font-weight: 400; `
      + 'letter-spacing: normal; orphans: 2; text-align: start; text-indent: 0px; text-transform: none; white-space: normal; widows: 2; word-spacing: 0px; '
      + '-webkit-text-stroke-width: 0px; text-decoration: none; display: inline !important; float: none;"></span>';
    const partial = normalizePasteHTML(`${WORD}<span style="${WHITE} font-size: 12pt; line-height: 18.4px; font-family: Aptos, sans-serif;">L11 Letter</span>${tail}</html>`);
    expect(warnings(partial.diagnostics)).toEqual([]);
    expect(partial.html).toBe('<span><span style="font-family:Aptos, sans-serif;font-size:12pt">L11 Letter</span></span><span></span>');
    expect(warnings(normalizePasteHTML('<p><span style="display: inline !important">Text</span></p>').diagnostics)).toEqual(['unsupported-formatting']);
    expect(warnings(normalizePasteHTML('<p><span style="display: none"><img src="https://example.test/a.png" alt="A"></span></p>').diagnostics))
      .toContain('unsupported-formatting');
  });

  it('treats tracking within half a point, as the Title style condenses, as typesetting', () => {
    for (const value of ['-0.5pt', '0.5pt', '-0.6px', '.25pt']) {
      expect(warnings(normalizePasteHTML(`<p><span style="letter-spacing:${value}">Text</span></p>`).diagnostics)).toEqual([]);
    }
    for (const value of ['-0.6pt', '1pt', '0.7px', '0.1em']) {
      expect(warnings(normalizePasteHTML(`<p><span style="letter-spacing:${value}">Text</span></p>`).diagnostics)).toEqual(['unsupported-formatting']);
    }
  });
});

describe('Safari copies of Word: what the native fixture review found', () => {
  const EMPTY = `<p class="MsoNormal" style="margin: 0cm 0cm 8pt; line-height: 18.4px; font-size: medium; font-family: Aptos, sans-serif; ${WHITE} ${INTERCHANGE}"><o:p>\u00a0</o:p></p>`;

  it.each(policies)('pastes Word\'s empty paragraph, a paragraph mark holding one no-break space, as an empty paragraph in %s', formatting => {
    const html = `${WORD}${normal('B15 Visible part end.')}${EMPTY}${EMPTY}${normal('B16 After two empty paragraphs.')}</html>`;
    const result = normalizePasteHTML(html, { formatting });
    expect(result.html).toContain('</p><p></p><p></p><p>');
    expect(result.html).not.toContain('\u00a0');
    expect(warnings(result.diagnostics)).toEqual([]);
    // The mark inside a run, as Word on Windows writes it, and in a table cell.
    const run = normalizePasteHTML(`${WORD}<p class=MsoNormal><span lang=EN-US style='font-size:11.0pt'><o:p>&nbsp;</o:p></span></p></html>`, { formatting });
    expect(run.html).not.toContain('\u00a0');
    const cell = normalizePasteHTML(`${WORD}<table><tr><td><p class=MsoNormal><o:p>&nbsp;</o:p></p></td></tr></table></html>`, { formatting });
    expect(cell.html).toContain('<td><p></p></td>');
  });

  it('keeps a no-break space Word wrote as text: outside the paragraph mark, beside other text or beside a line break', () => {
    for (const paragraph of ['<p class=MsoNormal>&nbsp;<o:p></o:p></p>', '<p class=MsoNormal>A<o:p>&nbsp;</o:p></p>',
      '<p class=MsoNormal><br><o:p>&nbsp;</o:p></p>', '<p class=MsoNormal><o:p>&nbsp;&nbsp;</o:p></p>']) {
      expect(normalizePasteHTML(`${WORD}${paragraph}</html>`).html).toContain('\u00a0');
    }
  });

  it.each([
    ['a paragraph', '<p class=MsoNormal style=\'background:#D9D9D9\'>Shaded</p>'],
    ['a Safari heading', '<h1 style="background: rgb(240, 240, 240)">Shaded</h1>'],
    ['a division', '<div style="background:#eeeeee">Shaded</div>'],
    ['a list item', '<ul><li style="background:#eee">Shaded</li></ul>'],
  ])('reports the shading of %s, which no block keeps, in preserve and adapts it quietly', (_name, block) => {
    const preserve = normalizePasteHTML(block);
    expect(warnings(preserve.diagnostics)).toEqual(['unsupported-formatting']);
    expect(preserve.html).not.toContain('background');
    const adapt = normalizePasteHTML(block, { formatting: 'adapt' });
    expect(warnings(adapt.diagnostics)).toEqual([]);
    expect(adapt.html).not.toContain('background');
    expect(adapt.diagnostics.some(entry => entry.code === 'formatting-adapted')).toBe(true);
  });

  it('reads a background that paints nothing as no background, also when it resets an earlier one', () => {
    for (const style of ['background: transparent none repeat scroll 0% 0%', 'background-color: yellow; background: none',
      'background-color: yellow; background: transparent', 'background: yellow; background: transparent none repeat scroll 0% 0%']) {
      const result = normalizePasteHTML(`<p><span style="${style}">A</span></p>`);
      expect(warnings(result.diagnostics)).toEqual([]);
      expect(result.html).toBe('<p><span>A</span></p>');
    }
    const aligned = normalizePasteHTML('<p style="text-align: right; text-align: start">B</p>');
    expect(aligned.html).toBe('<p>B</p>');
  });

  it('reads the line spacing of Word\'s Normal style as the source\'s own: 115 % and, before Word 2023, 107 %', () => {
    const paragraph = (lineHeight: string, size: string, text: string): string => `<p class="MsoNormal" style="margin: 0cm 0cm 8pt; line-height: ${lineHeight}; `
      + `font-size: ${size}; font-family: Calibri, sans-serif; ${WHITE} ${INTERCHANGE}">${text}<o:p></o:p></p>`;
    const older = normalizePasteHTML(`${WORD}${paragraph('15.693333px', '11pt', 'Calibri 11')}${paragraph('18.4px', 'medium', 'Aptos 12')}</html>`);
    expect(older.html).not.toContain('line-height');
    expect(warnings(older.diagnostics)).toEqual([]);
    // A copy that carries Word's stylesheet names its Normal spacing: only that one is the source's own.
    const sheet = (value: string): string => `<style class="WebKit-mso-list-quirks-style"><!-- p.MsoNormal, li.MsoNormal, div.MsoNormal {margin-top:0cm; line-height:${value}; font-size:12.0pt;} --></style>`;
    const named = normalizePasteHTML(`${WORD}${sheet('115%')}${paragraph('15.693333px', '11pt', 'Explicit 1.07')}${paragraph('18.4px', 'medium', 'Normal')}</html>`);
    expect(named.html).toBe('<p style="line-height:1.07"><span style="font-family:Calibri, sans-serif;font-size:11pt">Explicit 1.07</span></p>'
      + '<p><span style="font-family:Calibri, sans-serif">Normal</span></p>');
    const custom = normalizePasteHTML(`${WORD}${sheet('107%')}${paragraph('15.693333px', '11pt', 'Normal')}${paragraph('18.4px', 'medium', 'Explicit 1.15')}</html>`);
    expect(custom.html).toBe('<p><span style="font-family:Calibri, sans-serif;font-size:11pt">Normal</span></p>'
      + '<p style="line-height:1.15"><span style="font-family:Calibri, sans-serif">Explicit 1.15</span></p>');
  });

  it('adapts typography quietly in adapt, as the policy discards it anyway, and keeps reporting it in preserve', () => {
    for (const run of ['<span style="letter-spacing:2.0pt">Spaced</span>', '<span style="font-family:\'\'">Family</span>',
      '<span style="word-spacing:3pt">Words</span>', '<span style="text-transform:uppercase">Caps</span>', '<span style="font-variant:small-caps">Small</span>']) {
      const html = `${WORD}<p class="MsoNormal">${run}</p></html>`;
      const adapt = normalizePasteHTML(html, { formatting: 'adapt' });
      expect(warnings(adapt.diagnostics), run).toEqual([]);
      expect(adapt.diagnostics.some(entry => entry.code === 'formatting-adapted'), run).toBe(true);
      expect(warnings(normalizePasteHTML(html).diagnostics), run).toEqual(['unsupported-formatting']);
    }
    // Layout that adapt does not own stays a loss in both policies.
    const indented = `${WORD}<p class="MsoNormal" style="margin-left:36pt">Indented</p></html>`;
    expect(warnings(normalizePasteHTML(indented, { formatting: 'adapt' }).diagnostics)).toEqual(['unsupported-formatting']);
  });
});
