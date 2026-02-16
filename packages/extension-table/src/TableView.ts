/**
 * TableView - Custom NodeView for table rendering
 *
 * Creates: div.tableWrapper > table > colgroup + tbody
 * - Wrapper div enables horizontal scrolling for wide tables
 * - Colgroup reflects column widths (foundation for PRO column resize)
 * - ContentDOM = tbody (ProseMirror renders row content into tbody)
 */

import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView, NodeView } from 'prosemirror-view';

export class TableView implements NodeView {
  node: PMNode;
  cellMinWidth: number;

  dom: HTMLElement;
  table: HTMLTableElement;
  colgroup: HTMLTableColElement;
  contentDOM: HTMLElement;

  constructor(node: PMNode, cellMinWidth: number, _view: EditorView) {
    this.node = node;
    this.cellMinWidth = cellMinWidth;

    // Create wrapper div
    this.dom = document.createElement('div');
    this.dom.className = 'tableWrapper';

    // Create table
    this.table = document.createElement('table');
    this.dom.appendChild(this.table);

    // Create colgroup
    this.colgroup = document.createElement('colgroup');
    this.updateColumns(node);
    this.table.appendChild(this.colgroup);

    // Create tbody (contentDOM)
    this.contentDOM = document.createElement('tbody');
    this.table.appendChild(this.contentDOM);
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) {
      return false;
    }
    this.node = node;
    this.updateColumns(node);
    return true;
  }

  ignoreMutation(mutation: MutationRecord | { type: 'selection' }): boolean {
    // Allow selection mutations to propagate
    if (mutation.type === 'selection') {
      return false;
    }

    // Ignore attribute mutations (style changes from updateColumns)
    if (mutation.type === 'attributes') {
      return true;
    }

    // Ignore mutations in the colgroup (we manage it)
    if (
      mutation instanceof MutationRecord &&
      this.colgroup.contains(mutation.target)
    ) {
      return true;
    }

    return false;
  }

  /**
   * Rebuild colgroup col elements based on cell widths.
   * Scans first row to determine column count and widths.
   */
  private updateColumns(node: PMNode): void {
    const cols: { width?: number }[] = [];

    // Walk the first row to get column info
    const firstRow = node.firstChild;
    if (firstRow) {
      for (let i = 0; i < firstRow.childCount; i++) {
        const cell = firstRow.child(i);
        const colspan = (cell.attrs['colspan'] as number) || 1;
        const colwidth = cell.attrs['colwidth'] as number[] | null;

        for (let j = 0; j < colspan; j++) {
          const w = colwidth?.[j];
          if (w) {
            cols.push({ width: w });
          } else {
            cols.push({});
          }
        }
      }
    }

    // Clear existing cols
    while (this.colgroup.firstChild) {
      this.colgroup.removeChild(this.colgroup.firstChild);
    }

    // Calculate if we have all widths defined
    let totalWidth = 0;
    let allWidthsDefined = true;

    for (const col of cols) {
      const colEl = document.createElement('col');

      if (col.width) {
        colEl.style.width = `${String(col.width)}px`;
        totalWidth += col.width;
      } else {
        colEl.style.width = `${String(this.cellMinWidth)}px`;
        allWidthsDefined = false;
      }

      this.colgroup.appendChild(colEl);
    }

    // Set table width
    if (allWidthsDefined && totalWidth > 0) {
      this.table.style.width = `${String(totalWidth)}px`;
      this.table.style.minWidth = '';
    } else {
      this.table.style.width = '';
      this.table.style.minWidth = `${String(totalWidth || this.cellMinWidth * cols.length)}px`;
    }
  }
}
