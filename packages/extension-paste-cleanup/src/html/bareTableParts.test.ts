/**
 * Table parts that start the pasted HTML: rows, cells, sections, a caption or columns without the
 * table around them. The HTML parser keeps them at the top of the fragment and the sanitizer keeps
 * a row, cell or section only in a table, so cleanup puts them in one, as a browser's parser and
 * ProseMirror's own clipboard parse do.
 */
import { describe, expect, it } from 'vitest';
import { normalizePasteHTML } from './index.js';

const rows = '<tr><td>ra</td><td>rb</td></tr><tr><td>rc</td><td>rd</td></tr>';
const body = '<tbody><tr><td>ra</td><td>rb</td></tr><tr><td>rc</td><td>rd</td></tr></tbody>';

describe('table parts that start the pasted HTML', () => {
  it('puts bare rows in a table body instead of running the cell texts together', () => {
    const result = normalizePasteHTML(rows);
    expect(result).toMatchObject({ status: 'cleaned', html: `<table>${body}</table>`, diagnostics: [] });
  });

  it('puts bare cells in a row of a table body', () => {
    expect(normalizePasteHTML('<td>ta</td><th>tb</th>').html).toBe('<table><tbody><tr><td>ta</td><th>tb</th></tr></tbody></table>');
  });

  it('starts a new row for cells after a row, as the HTML parser does', () => {
    expect(normalizePasteHTML('<tr><td>ra</td></tr><td>tb</td><td>tc</td>').html)
      .toBe('<table><tbody><tr><td>ra</td></tr><tr><td>tb</td><td>tc</td></tr></tbody></table>');
  });

  it('keeps sections, a caption and columns in the order the HTML wrote them', () => {
    expect(normalizePasteHTML('<thead><tr><th>h</th></tr></thead><tbody><tr><td>b</td></tr></tbody>').html)
      .toBe('<table><thead><tr><th>h</th></tr></thead><tbody><tr><td>b</td></tr></tbody></table>');
    expect(normalizePasteHTML(`<caption>Cap</caption>${rows}`).html).toBe(`<table><caption>Cap</caption>${body}</table>`);
    expect(normalizePasteHTML(`<colgroup><col></colgroup>${rows}`).html).toBe(`<table><colgroup><col></colgroup>${body}</table>`);
    expect(normalizePasteHTML(`<col><col>${rows}`).html).toBe(`<table><colgroup><col><col></colgroup>${body}</table>`);
    expect(normalizePasteHTML('<thead><tr><th>h</th></tr></thead><tr><td>b</td></tr>').html)
      .toBe('<table><thead><tr><th>h</th></tr></thead><tbody><tr><td>b</td></tr></tbody></table>');
  });

  it('looks past comments, white space and the envelope elements a browser writes first', () => {
    expect(normalizePasteHTML(`<meta charset="utf-8"><!--StartFragment-->${rows}<!--EndFragment-->`).html).toBe(`<table>${body}</table>`);
    expect(normalizePasteHTML(`\n<!-- copied -->\n${rows}`).html).toBe(`\n\n<table>${body}</table>`);
  });

  it('keeps the content after the parts, after the table', () => {
    expect(normalizePasteHTML(`${rows}<p>after</p>`).html).toBe(`<table>${body}</table><p>after</p>`);
  });

  it('leaves table parts after other content as the HTML parser reads them', () => {
    expect(normalizePasteHTML(`<p>before</p>${rows}`).html).toBe('<p>before</p>rarbrcrd');
    expect(normalizePasteHTML('<p>plain</p>').html).toBe('<p>plain</p>');
  });

  it('counts the cells it puts in a table against maxTableCells', () => {
    expect(normalizePasteHTML(rows, { limits: { maxTableCells: 4 } }).status).toBe('cleaned');
    const refused = normalizePasteHTML(rows, { limits: { maxTableCells: 3 } });
    expect(refused).toMatchObject({ status: 'rejected', html: '', diagnostics: [{ code: 'structure-limit', severity: 'error' }] });
  });

  it('keeps the table it adds within maxNodes and maxDepth', () => {
    // The output's size as the bounds count it: the fragment at depth 0 and every node below it.
    const size = (html: string): { maxDepth: number; maxNodes: number } => {
      const template = document.createElement('template');
      template.innerHTML = html;
      const measured = { maxDepth: 0, maxNodes: 0 };
      const visit = (node: Node, depth: number): void => {
        measured.maxNodes++;
        measured.maxDepth = Math.max(measured.maxDepth, depth);
        node.childNodes.forEach(child => { visit(child, depth + 1); });
      };
      visit(template.content, 0);
      return measured;
    };
    const cleaned = new Set<string>();
    for (let limit = 1; limit <= 12; limit++) {
      for (const key of ['maxDepth', 'maxNodes'] as const) {
        const result = normalizePasteHTML('<td>a</td>', { limits: { [key]: limit } });
        if (result.status !== 'cleaned') continue;
        cleaned.add(key);
        expect(result.html).toBe('<table><tbody><tr><td>a</td></tr></tbody></table>');
        expect(size(result.html)[key], `${key} ${String(limit)}`).toBeLessThanOrEqual(limit);
      }
    }
    expect([...cleaned].sort()).toEqual(['maxDepth', 'maxNodes']);
  });
});
