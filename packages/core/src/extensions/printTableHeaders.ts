interface HeaderCopy {
  table: HTMLTableElement;
  head: HTMLTableSectionElement;
}

/**
 * Repeat a real header group without moving ProseMirror's rows out of its contentDOM.
 * Only the standard table node view is changed: it owns the surrounding table and
 * ignores presentation mutations there, while its live tbody stays in place.
 */
export function preparePrintTableHeaders(root: HTMLElement): () => void {
  const copies: HeaderCopy[] = [];
  for (const table of Array.from(root.querySelectorAll<HTMLTableElement>('.dm-table-container > .tableWrapper > table'))) {
    if (table.hasAttribute('data-dm-print-headers') || table.tHead || table.tBodies.length !== 1) continue;
    const body = table.tBodies.item(0);
    if (!body) continue;
    const rows = Array.from(body.rows);
    const headers: HTMLTableRowElement[] = [];
    for (const row of rows) {
      if (!row.cells.length || Array.from(row.cells).some(cell => cell.tagName !== 'TH')) break;
      headers.push(row);
    }
    if (!headers.length || headers.length === rows.length || !closedHeaderGrid(headers)) continue;
    // Keep native anchor and form identities on the original header. Reusing an
    // ID would duplicate it, while moving it could change the live editor model.
    if (headers.some(row => row.id || row.querySelector('[id], input, select, textarea, button, canvas, video, audio, iframe, object, embed, script, style, link, base, meta'))) continue;
    const head = table.ownerDocument.createElement('thead');
    head.className = 'dm-print-table-head';
    head.setAttribute('aria-hidden', 'true');
    // Hidden on screen even without the theme. The print stylesheet overrides this.
    head.style.display = 'none';
    for (const row of headers) {
      const copy = row.cloneNode(true) as HTMLTableRowElement;
      for (const element of [copy, ...Array.from(copy.querySelectorAll('*'))]) {
        element.removeAttribute('id');
        element.removeAttribute('contenteditable');
        element.removeAttribute('autofocus');
        element.removeAttribute('name');
        // A print-only copy must not acquire an application's inline event handlers.
        for (const attribute of Array.from(element.attributes)) {
          if (attribute.name.toLowerCase().startsWith('on')) element.removeAttribute(attribute.name);
        }
      }
      head.append(copy);
    }
    table.insertBefore(head, body);
    table.setAttribute('data-dm-print-headers', '');
    copies.push({ table, head });
  }
  return () => {
    for (const { table, head } of copies) {
      head.remove();
      table.removeAttribute('data-dm-print-headers');
    }
  };
}

/** All merged cells must end inside a rectangular leading header group. */
function closedHeaderGrid(rows: HTMLTableRowElement[]): boolean {
  const occupied: number[] = [];
  let width = 0;
  for (const [index, row] of rows.entries()) {
    let column = 0;
    for (const cell of Array.from(row.cells)) {
      while ((occupied[column] ?? 0) > index) column++;
      const rowspan = cell.rowSpan; const colspan = cell.colSpan;
      if (rowspan < 1 || index + rowspan > rows.length || column + colspan > 1024) return false;
      for (let offset = 0; offset < colspan; offset++) {
        if ((occupied[column + offset] ?? 0) > index) return false;
        occupied[column + offset] = index + rowspan;
      }
      column += colspan;
    }
    if (index === 0) width = occupied.length;
    if (occupied.length !== width || occupied.some(until => until <= index)) return false;
  }
  return true;
}
