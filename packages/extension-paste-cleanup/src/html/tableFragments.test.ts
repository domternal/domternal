import { describe, expect, it } from 'vitest';
import { DEFAULT_PASTE_HTML_LIMITS, normalizePasteHTML } from './index.js';
import { parseBoundedHTML } from './parse.js';
import { clipboardMarkup } from './markup.js';
import { recoverTableParts } from './bareTableParts.js';
import type { Nodes } from 'hast';

const row = (text: string): string => `<tr><td>${text}</td></tr>`;
const table = (text: string): string => `<table><tbody>${row(text)}</tbody></table>`;

describe('table fragments from clipboard envelopes and malformed selections', () => {
  it('keeps bare rows inside the Windows HTML clipboard envelope', () => {
    const source = `<html><body><!--StartFragment-->${row('kept')}<!--EndFragment--></body></html>`;
    expect(normalizePasteHTML(source)).toMatchObject({ status: 'cleaned', html: table('kept'), diagnostics: [] });
  });

  it('keeps only selected rows when the envelope holds unrelated visible content', () => {
    const source = `<html><body><p>not selected before</p><!--StartFragment--> 
<!--before row-->${row('kept')}
<!--after row--> <!--EndFragment--><p>not selected after</p></body></html>`;
    const result = normalizePasteHTML(source);
    const container = document.createElement('div');
    container.innerHTML = result.html;
    expect(container.querySelectorAll('table')).toHaveLength(1);
    expect(container.textContent.trim()).toBe('kept');
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    '<textarea><!--StartFragment--><tr><td>literal</td></tr><!--EndFragment--></textarea><p>after</p>',
    '<div title="<!--StartFragment--><tr><td>attribute</td></tr><!--EndFragment-->">visible</div><p>after</p>',
    '<script><!--StartFragment--><tr><td>script</td></tr><!--EndFragment--></script><p>after</p>',
  ])('does not take a fragment boundary from an attribute or raw text: %s', source => {
    const result = normalizePasteHTML(source);
    expect(result.html).not.toContain('<table');
    expect(result.html).toContain('after');
    const container = document.createElement('div');
    container.innerHTML = result.html;
    expect(container.textContent).not.toContain('attribute');
    expect(container.textContent).not.toContain('script');
  });

  it('does not choose one of several ambiguous clipboard marker pairs', () => {
    const source = '<p>before</p><!--StartFragment--><tr><td>one</td></tr><!--EndFragment--><p>middle</p><!--StartFragment--><tr><td>two</td></tr><!--EndFragment--><p>after</p>';
    const result = normalizePasteHTML(source);
    expect(result.html).toContain('before');
    expect(result.html).toContain('middle');
    expect(result.html).toContain('after');
    expect(result.html).toContain('one');
    expect(result.html).toContain('two');
  });

  it('keeps nested complete tables within a recovered cell', () => {
    const inner = table('inner');
    const source = `<html><body><!--StartFragment--><tr><td>outer${inner}after</td></tr><!--EndFragment--></body></html>`;
    expect(normalizePasteHTML(source).html).toBe(`<table><tbody><tr><td>outer${inner}after</td></tr></tbody></table>`);
  });

  it('keeps authored node positions in source order after removing columns and rebasing an envelope', () => {
    for (const source of [
      'lead\n<col>\n<col span="2">\n<img src="file:///lost.png" alt="lost">\n<p>after</p>',
      `<html>\n<body>\n<!--StartFragment-->\n${row('first')}\nbetween\n${row('last')}\n<!--EndFragment-->\n</body></html>`,
    ]) {
      const observer = clipboardMarkup().observer;
      const tree = recoverTableParts(source, parseBoundedHTML(source, DEFAULT_PASTE_HTML_LIMITS), DEFAULT_PASTE_HTML_LIMITS, observer, () => true);
      const pending: Nodes[] = [...tree.children].reverse();
      let previous = -1;
      while (pending.length > 0) {
        const node = pending.pop()!;
        if (node.type !== 'comment' && node.position !== undefined) {
          const { start, end } = node.position;
          expect(start.offset).toBeGreaterThanOrEqual(previous);
          expect(end.offset).toBeGreaterThanOrEqual(start.offset!);
          expect(end.offset).toBeLessThanOrEqual(source.length);
          const prefix = source.slice(0, start.offset);
          expect(start.line).toBe(prefix.split('\n').length);
          expect(start.column).toBe(prefix.length - prefix.lastIndexOf('\n'));
          if (node.type === 'element') expect(source.slice(start.offset, start.offset! + node.tagName.length + 1)).toBe(`<${node.tagName}`);
          if (node.type === 'text') expect(source.slice(start.offset, end.offset).replaceAll('<col>', '').replaceAll('<col span="2">', '')).toBe(node.value);
          previous = start.offset!;
        }
        if ('children' in node) pending.push(...[...node.children].reverse());
      }
      const result = normalizePasteHTML(source);
      if (source.includes('<img')) expect(result.diagnostics).toContainEqual({ code: 'image-removed', severity: 'warning', offset: source.indexOf('<img') });
    }
  });

  it('keeps bare cells inside the Windows HTML clipboard envelope', () => {
    expect(normalizePasteHTML('<html><body><!--StartFragment--><td>a</td><td>b</td><!--EndFragment--></body></html>').html)
      .toBe('<table><tbody><tr><td>a</td><td>b</td></tr></tbody></table>');
  });

  it.each([
    ['loose<colgroup><col></colgroup><p>pa</p>', 'loose<p>pa</p>'],
    ['text <col> more <p>para</p>', 'text  more <p>para</p>'],
  ])('keeps visible content around an orphan column: %s', (html, expected) => {
    expect(normalizePasteHTML(html)).toMatchObject({ status: 'cleaned', html: expected, diagnostics: [] });
  });

  it('keeps text between bare rows between separate tables instead of moving it after both rows', () => {
    expect(normalizePasteHTML(`${row('first')}between${row('last')}`).html).toBe(`${table('first')}between${table('last')}`);
  });

  it('does not treat a marker-like string in visible or raw text as a clipboard boundary', () => {
    for (const source of ['<p>&lt;!--StartFragment--&gt;kept&lt;!--EndFragment--&gt;</p>', '<pre>&lt;tr&gt;kept&lt;/tr&gt;</pre>']) {
      const before = document.createElement('template');
      before.innerHTML = source;
      const after = document.createElement('template');
      after.innerHTML = normalizePasteHTML(source).html;
      expect(after.content.textContent).toBe(before.content.textContent);
      expect(after.content.querySelector('table')).toBeNull();
    }
  });

  it('keeps diagnostic offsets relative to the original envelope after recovery', () => {
    const source = '<html><body><!--StartFragment--><tr><td><img src="file:///lost.png" alt="lost"></td></tr><!--EndFragment--></body></html>';
    const result = normalizePasteHTML(source);
    expect(result.html).toContain('lost');
    expect(result.diagnostics).toContainEqual({ code: 'image-removed', severity: 'warning', offset: source.indexOf('<img') });
  });

  it('keeps diagnostics and complete tables after orphan columns at their original source offsets', () => {
    const source = 'lead<col><col><img src="file:///lost.png" alt="lost"><table><tr><td style="background-color:red">cell</td></tr></table><p>after</p>';
    const result = normalizePasteHTML(source);
    expect(result.html).toContain('leadlost<table>');
    expect(result.html).toContain('background-color:red');
    expect(result.html).toContain('<p>after</p>');
    expect(result.diagnostics).toContainEqual({ code: 'image-removed', severity: 'warning', offset: source.indexOf('<img') });
  });

  it('retains the ordinary parser result for authored complete tables and non-table clipboard fragments', () => {
    for (const source of ['<p>before</p><table><tbody><tr><td>cell</td></tr></tbody></table><p>after</p>',
      '<html><body><!--StartFragment--><p>ordinary</p><!--EndFragment--></body></html>']) {
      expect(normalizePasteHTML(source).html).toBe(source.startsWith('<html>') ? '<p>ordinary</p>' : source);
    }
  });

  it('enforces cells, nodes and depth bounds after creating separate recovered tables', () => {
    const source = `<html><body><!--StartFragment-->${row('a')}between${row('b')}<!--EndFragment--></body></html>`;
    expect(normalizePasteHTML(source, { limits: { maxTableCells: 1 } }).status).toBe('rejected');
    expect(normalizePasteHTML(source, { limits: { maxNodes: 5 } }).status).toBe('rejected');
    expect(normalizePasteHTML(source, { limits: { maxDepth: 2 } }).status).toBe('rejected');
    expect(normalizePasteHTML(source).html).toBe(`${table('a')}between${table('b')}`);
  });
});
