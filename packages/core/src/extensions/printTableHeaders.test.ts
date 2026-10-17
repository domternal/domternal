import { afterEach, describe, expect, it } from 'vitest';
import { preparePrintTableHeaders } from './printTableHeaders.js';

function mount(rows: string, prefix = ''): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = `<div class="dm-table-container"><div class="tableWrapper"><table>${prefix}<tbody>${rows}</tbody></table></div></div>`;
  document.body.append(root);
  return root;
}
const row = '<tr><td><p>Body cell</p></td><td><p>Other cell</p></td></tr>';
afterEach(() => { document.body.replaceChildren(); });

describe('print table header preparation', () => {
  it('copies consecutive headers while retaining every original row and cell', () => {
    const root = mount('<tr><th><p>First header</p></th><th>Other header</th></tr><tr><th>Second header</th><th>Another header</th></tr>' + row);
    const before = root.innerHTML;
    const tbody = root.querySelector('tbody')!;
    const rows = Array.from(tbody.rows);
    const header = root.querySelector('tbody th')!;
    const restore = preparePrintTableHeaders(root);
    expect(root.querySelectorAll('thead tr')).toHaveLength(2);
    expect(root.querySelectorAll('thead [id]')).toHaveLength(0);
    expect(root.querySelector('thead')?.getAttribute('aria-hidden')).toBe('true');
    expect(root.querySelector('thead')?.style.display).toBe('none');
    expect(tbody.innerHTML).not.toContain('data-dm-print');
    expect(root.querySelector('tbody th')).toBe(header);
    expect(Array.from(tbody.rows)).toEqual(rows);
    restore(); restore();
    expect(root.innerHTML).toBe(before);
    expect(Array.from(tbody.rows)).toEqual(rows);
  });

  it('supports a rectangular header whose rowspans close inside the header group', () => {
    const root = mount('<tr><th rowspan="2">Joined rows</th><th colspan="2">Joined columns</th></tr><tr><th>Left</th><th>Right</th></tr>' + row);
    const restore = preparePrintTableHeaders(root);
    expect(root.querySelectorAll('thead tr')).toHaveLength(2);
    expect(root.querySelector('thead th')?.getAttribute('rowspan')).toBe('2');
    restore();
    expect(root.querySelector('thead')).toBeNull();
  });

  it.each([
    '<tr><th rowspan="3">Crosses into body</th><th>Heading</th></tr><tr><th>Second</th></tr>' + row,
    '<tr><th rowspan="0">Unbounded span</th><th>Heading</th></tr>' + row,
    '<tr><th>One column</th></tr><tr><th>Two</th><th>Columns</th></tr>' + row,
    '<tr><th>Header column</th><td>Ordinary cell</td></tr>' + row,
    '<tr><th>Headers without a body</th></tr>',
  ])('leaves unsupported header geometry unchanged: %s', rows => {
    const root = mount(rows); const before = root.innerHTML;
    const restore = preparePrintTableHeaders(root);
    expect(root.innerHTML).toBe(before);
    restore();
    expect(root.innerHTML).toBe(before);
  });

  it('leaves existing native groups and unfamiliar table views alone', () => {
    const root = mount('<tr><th>Body header</th><th>Second</th></tr>' + row, '<thead><tr><th>Native header</th></tr></thead>');
    const plain = document.createElement('table'); plain.innerHTML = '<tbody><tr><th>Plain header</th></tr><tr><td>Plain cell</td></tr></tbody>';
    root.append(plain);
    const before = root.innerHTML;
    preparePrintTableHeaders(root)();
    expect(root.innerHTML).toBe(before);
  });

  it('does not copy inline event handlers or editable attributes', () => {
    const root = mount('<tr><th onclick="void 0" contenteditable="true"><p>Label</p></th><th>Other</th></tr>' + row);
    const restore = preparePrintTableHeaders(root);
    expect(root.querySelector('thead')?.querySelector('[onclick], [contenteditable], [name], [autofocus], [id]')).toBeNull();
    expect(root.querySelector('tbody [onclick]')).not.toBeNull();
    restore();
  });

  it.each(['<p id="column">Column anchor</p>', '<input value="Live value">', '<canvas></canvas>'])('leaves anchored or stateful header content unchanged: %s', content => {
    const root = mount('<tr><th>' + content + '</th><th>Other</th></tr>' + row);
    const before = root.innerHTML;
    const restore = preparePrintTableHeaders(root);
    expect(root.querySelector('thead')).toBeNull();
    expect(root.innerHTML).toBe(before);
    restore(); expect(root.innerHTML).toBe(before);
  });

  it('does not duplicate a header during overlapping preparation', () => {
    const root = mount('<tr><th>One</th><th>Two</th></tr>' + row);
    const first = preparePrintTableHeaders(root);
    const second = preparePrintTableHeaders(root);
    expect(root.querySelectorAll('thead')).toHaveLength(1);
    second();
    expect(root.querySelectorAll('thead')).toHaveLength(1);
    first();
    expect(root.querySelectorAll('thead')).toHaveLength(0);
  });
});
