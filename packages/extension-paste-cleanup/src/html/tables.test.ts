// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Element, ElementContent, Properties, Root } from 'hast';
import { parseBoundedHTML } from './parse.js';
import { assertTableBounds, TableLimitError } from './tables.js';

function parse(html: string): Root {
  return parseBoundedHTML(html, {
    maxInputLength: 2_000_000,
    maxNodes: 30_000,
    maxDepth: 128,
    maxDiagnostics: 100,
    maxTableCells: 20_000,
    maxImages: 200,
    maxImagePixels: 50_000_000,
  });
}

function element(tagName: string, children: ElementContent[] = [], properties: Properties = {}): Element {
  return { type: 'element', tagName, properties, children };
}

/** Permit malformed runtime property values to exercise the rejection boundary. */
function tableWithCell(properties: Record<string, unknown>): Root {
  return {
    type: 'root',
    children: [element('table', [element('tr', [element('td', [], properties as Properties)])])],
  };
}

describe('assertTableBounds', () => {
  it('accepts documents without tables and reserves one cell for an empty table', () => {
    expect(() => { assertTableBounds(parse('<p>Text</p>'), 1); }).not.toThrow();
    expect(() => { assertTableBounds(parse('<table></table>'), 1); }).not.toThrow();
    expect(() => { assertTableBounds(parse('<table></table><table></table>'), 1); }).toThrow(TableLimitError);
  });

  it('counts implicit table bodies, header cells and rowspans that expire', () => {
    const tree = parse('<table><tr><th rowspan="2" colspan="2">A</th><td>B</td></tr>'
      + '<tr><td>C</td></tr><tr><td colspan="3">D</td></tr></table>');
    expect(() => { assertTableBounds(tree, 9); }).not.toThrow();
    expect(() => { assertTableBounds(tree, 8); }).toThrow(TableLimitError);
  });

  it('includes still-active spans from preceding rows in the effective width', () => {
    const tree = parse('<table><tr><td rowspan="3">A</td><td rowspan="2">B</td></tr>'
      + '<tr><td>C</td></tr><tr><td colspan="2">D</td></tr></table>');
    expect(() => { assertTableBounds(tree, 9); }).not.toThrow();
    expect(() => { assertTableBounds(tree, 8); }).toThrow(TableLimitError);
  });

  it('counts rows in separate table sections together', () => {
    const tree = parse('<table><thead><tr><th>A</th><th>B</th></tr></thead>'
      + '<tbody><tr><td>C</td><td>D</td></tr></tbody>'
      + '<tfoot><tr><td colspan="2">E</td></tr></tfoot></table>');
    expect(() => { assertTableBounds(tree, 6); }).not.toThrow();
    expect(() => { assertTableBounds(tree, 5); }).toThrow(TableLimitError);
  });

  it('counts nested table geometry separately within one shared budget', () => {
    const nested = '<table><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></table>';
    const tree = parse(`<table><tr><td>${nested}</td></tr></table>`);
    expect(() => { assertTableBounds(tree, 5); }).not.toThrow();
    expect(() => { assertTableBounds(tree, 4); }).toThrow(TableLimitError);
  });

  it('sums the cost of separate tables instead of applying the budget to each', () => {
    const tree = parse('<table><tr><td colspan="4">A</td></tr></table>'.repeat(2));
    expect(() => { assertTableBounds(tree, 8); }).not.toThrow();
    expect(() => { assertTableBounds(tree, 7); }).toThrow(TableLimitError);
  });

  it('rejects a small source whose spans would allocate millions of table-map slots', () => {
    const tree = parse('<table>' + '<tr><td colspan="1000">A</td></tr>'.repeat(2_000) + '</table>');
    expect(() => { assertTableBounds(tree); }).toThrow(TableLimitError);
  });

  it('rejects an oversized width even when the table has only one row', () => {
    const tree = parse('<table><tr>' + '<td colspan="1000">A</td>'.repeat(21) + '</tr></table>');
    expect(() => { assertTableBounds(tree); }).toThrow(TableLimitError);
  });

  it('accepts the exact rectangular cell limit and rejects one extra row', () => {
    const row = '<tr><td colspan="1000">A</td></tr>';
    expect(() => { assertTableBounds(parse('<table>' + row.repeat(20) + '</table>')); }).not.toThrow();
    expect(() => { assertTableBounds(parse('<table>' + row.repeat(21) + '</table>')); }).toThrow(TableLimitError);
  });

  it('reserves cell budget for empty rows that schema repair can fill', () => {
    const tree = parse('<table><tr></tr><tr></tr></table>');
    expect(() => { assertTableBounds(tree, 2); }).not.toThrow();
    expect(() => { assertTableBounds(tree, 1); }).toThrow(TableLimitError);
  });

  it('caps row collection before allocating the rowspan bookkeeping array', () => {
    const tree: Root = {
      type: 'root',
      children: [element('table', Array.from({ length: 20_001 }, () => element('tr')))],
    };
    expect(() => { assertTableBounds(tree); }).toThrow(TableLimitError);
  });

  it('allows bounded spans and counts overlong rowspans only within existing rows', () => {
    expect(() => { assertTableBounds(tableWithCell({ colSpan: 1_000 }), 1_000); }).not.toThrow();
    expect(() => { assertTableBounds(tableWithCell({ rowSpan: 1_000 }), 1); }).not.toThrow();
    expect(() => { assertTableBounds(tableWithCell({ colSpan: '2', rowSpan: '1' }), 2); }).not.toThrow();
  });

  it.each([0, -1, 1.5, NaN, Infinity, 1_001, 10_000, 'invalid', '', '1e3', true])(
    'rejects invalid or oversized spans: %s',
    value => {
      expect(() => { assertTableBounds(tableWithCell({ colSpan: value })); }).toThrow(TableLimitError);
      expect(() => { assertTableBounds(tableWithCell({ rowSpan: value })); }).toThrow(TableLimitError);
    },
  );

  it('rejects malformed raw tree shapes that could hide uncounted cells', () => {
    const orphan: Root = { type: 'root', children: [element('table', [element('td')])] };
    const nestedRow: Root = {
      type: 'root', children: [element('table', [element('tr', [element('tr', [element('td')])])])],
    };
    expect(() => { assertTableBounds(orphan); }).toThrow(TableLimitError);
    expect(() => { assertTableBounds(nestedRow); }).toThrow(TableLimitError);
  });

  it.each([0, -1, 1.5, NaN, Infinity, 20_001])('refuses invalid or expanded cell budgets: %s', value => {
    expect(() => { assertTableBounds(parse('<p>Text</p>'), value); }).toThrow(RangeError);
  });
});
