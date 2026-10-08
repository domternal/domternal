import { afterAll, describe, expect, it } from 'vitest';
import { Document, Editor, Paragraph, Text } from '@domternal/core';
import { Fragment, Slice } from '@domternal/pm/model';
import type { Node as PMNode } from '@domternal/pm/model';
import { Table, TableRow, TableCell, TableHeader } from '../index.js';
import { clipCells, pastedCells } from './pasteCells.js';
import type { PastedCells } from './pasteCells.js';

const editor = new Editor({ extensions: [Document, Paragraph, Text, Table, TableRow, TableCell, TableHeader] });
const { schema } = editor;
afterAll(() => { editor.destroy(); });

function cell(text: string, colspan = 1, rowspan = 1): PMNode {
  return schema.node('tableCell', { colspan, rowspan }, text === '' ? [schema.node('paragraph')] : [schema.node('paragraph', null, [schema.text(text)])]);
}

const spans = (area: PastedCells): string[][] =>
  area.rows.map(row => { const found: string[] = []; row.forEach(node => { found.push(`${node.textContent}${String(node.attrs['colspan'])}x${String(node.attrs['rowspan'])}`); }); return found; });

describe('pastedCells', () => {
  it('reads a cell spanning 2 rows and columns, and the empty row it covers, as a 2x2 area', () => {
    const x = cell('X', 2, 2);
    const table = schema.node('table', null, [schema.node('tableRow', null, [x]), schema.node('tableRow')]);
    const area = pastedCells(new Slice(Fragment.from(table), 0, 0));
    expect(area).toMatchObject({ width: 2, height: 2 });
    expect(area && spans(area)).toEqual([['X2x2'], []]);
  });

  it('clips a rowspan past the rows the slice holds to them, as a browser draws such a cell', () => {
    const table = schema.node('table', null, [schema.node('tableRow', null, [cell('X', 2, 2), cell('Y', 1, 1000)])]);
    const area = pastedCells(new Slice(Fragment.from(table), 0, 0));
    expect(area).toMatchObject({ width: 3, height: 1 });
    expect(area && spans(area)).toEqual([['X2x1', 'Y1x1']]);

    const two = schema.node('table', null, [schema.node('tableRow', null, [cell('X', 1, 5), cell('a')]), schema.node('tableRow', null, [cell('b')])]);
    const clipped = pastedCells(new Slice(Fragment.from(two), 0, 0));
    expect(clipped && spans(clipped)).toEqual([['X1x2', 'a1x1'], ['b1x1']]);
  });

  it('pads a shorter row with empty cells', () => {
    const rows = [schema.node('tableRow', null, [cell('a'), cell('b')]), schema.node('tableRow', null, [cell('c')])];
    const area = pastedCells(new Slice(Fragment.from(schema.node('table', null, rows)), 0, 0));
    expect(area && spans(area)).toEqual([['a1x1', 'b1x1'], ['c1x1', '1x1']]);
  });

  it('returns null for content that is not table cells or rows', () => {
    expect(pastedCells(new Slice(Fragment.from(schema.node('paragraph', null, [schema.text('p')])), 0, 0))).toBeNull();
    expect(pastedCells(Slice.empty)).toBeNull();
  });
});

describe('clipCells', () => {
  it('keeps the rows a cell still covers when a selection clips it at the bottom', () => {
    const area: PastedCells = { width: 1, height: 3, rows: [Fragment.from(cell('X', 1, 3)), Fragment.empty, Fragment.empty] };
    expect(spans(clipCells(area, 1, 2))).toEqual([['X1x2'], []]);
  });

  it('clips a cell that sticks out at the right edge', () => {
    const area: PastedCells = { width: 3, height: 1, rows: [Fragment.from(cell('X', 3, 1))] };
    expect(spans(clipCells(area, 2, 1))).toEqual([['X2x1']]);
  });

  it('repeats a smaller area to fill a larger selection', () => {
    const area: PastedCells = { width: 1, height: 1, rows: [Fragment.from(cell('X'))] };
    expect(spans(clipCells(area, 2, 2))).toEqual([['X1x1', 'X1x1'], ['X1x1', 'X1x1']]);
  });
});
