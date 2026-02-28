/**
 * TableView - Custom NodeView for table rendering
 *
 * Creates: div.dm-table-container > [handles] + div.tableWrapper > table > colgroup + tbody
 * - Container enables row/column hover controls (handles with dropdown menus)
 * - Wrapper div enables horizontal scrolling for wide tables
 * - Colgroup reflects column widths (foundation for PRO column resize)
 * - ContentDOM = tbody (ProseMirror renders row content into tbody)
 */

import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView, NodeView } from 'prosemirror-view';
import { TextSelection } from 'prosemirror-state';
import {
  TableMap,
  CellSelection,
  addRowBefore,
  addRowAfter,
  deleteRow,
  addColumnBefore,
  addColumnAfter,
  deleteColumn,
} from 'prosemirror-tables';

// Inline SVG icons for handle buttons (three dots)
const DOTS_H =
  '<svg width="10" height="4" viewBox="0 0 10 4"><circle cx="2" cy="2" r="1.2" fill="currentColor"/><circle cx="5" cy="2" r="1.2" fill="currentColor"/><circle cx="8" cy="2" r="1.2" fill="currentColor"/></svg>';
const DOTS_V =
  '<svg width="4" height="10" viewBox="0 0 4 10"><circle cx="2" cy="2" r="1.2" fill="currentColor"/><circle cx="2" cy="5" r="1.2" fill="currentColor"/><circle cx="2" cy="8" r="1.2" fill="currentColor"/></svg>';

type PMCommand = (
  state: Parameters<typeof addRowBefore>[0],
  dispatch?: Parameters<typeof addRowBefore>[1],
) => boolean;

export class TableView implements NodeView {
  node: PMNode;
  cellMinWidth: number;
  view: EditorView;

  dom: HTMLElement;
  table: HTMLTableElement;
  colgroup: HTMLTableColElement;
  contentDOM: HTMLElement;

  private wrapper: HTMLElement;
  private colHandle: HTMLButtonElement;
  private rowHandle: HTMLButtonElement;
  private dropdown: HTMLElement | null = null;

  private hoveredCell: HTMLTableCellElement | null = null;
  private hoveredRow = -1;
  private hoveredCol = -1;
  private hideTimeout: ReturnType<typeof setTimeout> | null = null;

  // Bound handlers for cleanup
  private boundMouseMove: (e: MouseEvent) => void;
  private boundMouseLeave: () => void;
  private boundCancelHide: () => void;
  private boundDocMouseDown: (e: MouseEvent) => void;
  private boundDocKeyDown: (e: KeyboardEvent) => void;

  constructor(node: PMNode, cellMinWidth: number, view: EditorView) {
    this.node = node;
    this.cellMinWidth = cellMinWidth;
    this.view = view;

    // Bind handlers
    this.boundMouseMove = this.onMouseMove.bind(this);
    this.boundMouseLeave = this.onMouseLeave.bind(this);
    this.boundCancelHide = this.cancelHide.bind(this);
    this.boundDocMouseDown = this.onDocMouseDown.bind(this);
    this.boundDocKeyDown = this.onDocKeyDown.bind(this);

    // Create outer container (position: relative, overflow: visible)
    this.dom = document.createElement('div');
    this.dom.className = 'dm-table-container';

    // Create column handle
    this.colHandle = this.createHandle('dm-table-col-handle', 'Column options', DOTS_H);
    this.colHandle.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onColClick();
    });
    this.dom.appendChild(this.colHandle);

    // Create row handle
    this.rowHandle = this.createHandle('dm-table-row-handle', 'Row options', DOTS_V);
    this.rowHandle.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onRowClick();
    });
    this.dom.appendChild(this.rowHandle);

    // Create wrapper div (overflow-x: auto for horizontal scrolling)
    this.wrapper = document.createElement('div');
    this.wrapper.className = 'tableWrapper';
    this.dom.appendChild(this.wrapper);

    // Create table
    this.table = document.createElement('table');
    this.wrapper.appendChild(this.table);

    // Create colgroup
    this.colgroup = document.createElement('colgroup');
    this.updateColumns(node);
    this.table.appendChild(this.colgroup);

    // Create tbody (contentDOM)
    this.contentDOM = document.createElement('tbody');
    this.table.appendChild(this.contentDOM);

    // Hover tracking
    this.dom.addEventListener('mousemove', this.boundMouseMove);
    this.dom.addEventListener('mouseleave', this.boundMouseLeave);
    this.colHandle.addEventListener('mouseenter', this.boundCancelHide);
    this.rowHandle.addEventListener('mouseenter', this.boundCancelHide);
  }

  // ─── NodeView interface ───────────────────────────────────────────────

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) {
      return false;
    }
    this.node = node;
    this.updateColumns(node);

    // Reset stale hover references
    this.hoveredCell = null;
    this.hoveredRow = -1;
    this.hoveredCol = -1;

    return true;
  }

  destroy(): void {
    this.dom.removeEventListener('mousemove', this.boundMouseMove);
    this.dom.removeEventListener('mouseleave', this.boundMouseLeave);
    this.colHandle.removeEventListener('mouseenter', this.boundCancelHide);
    this.rowHandle.removeEventListener('mouseenter', this.boundCancelHide);
    this.closeDropdown();
    if (this.hideTimeout) clearTimeout(this.hideTimeout);
  }

  ignoreMutation(mutation: MutationRecord | { type: 'selection' }): boolean {
    if (mutation.type === 'selection') {
      return false;
    }

    // Ignore attribute mutations (style changes from updateColumns, selectedCell, etc.)
    if (mutation.type === 'attributes') {
      return true;
    }

    // Ignore mutations outside contentDOM (handles, dropdown, colgroup, container itself)
    if (mutation instanceof MutationRecord && !this.contentDOM.contains(mutation.target)) {
      return true;
    }

    return false;
  }

  // ─── Handle creation ──────────────────────────────────────────────────

  private createHandle(className: string, label: string, icon: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = className;
    btn.type = 'button';
    btn.setAttribute('aria-label', label);
    btn.innerHTML = icon;
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault(); // prevent editor blur
      e.stopPropagation();
    });
    return btn;
  }

  // ─── Hover tracking ──────────────────────────────────────────────────

  private onMouseMove(e: MouseEvent): void {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;

    const cell = target.closest('td, th') as HTMLTableCellElement | null;
    if (!cell || !this.table.contains(cell)) return;
    if (cell === this.hoveredCell) return;

    this.hoveredCell = cell;
    const { row, col } = this.getCellIndices(cell);
    this.hoveredRow = row;
    this.hoveredCol = col;
    this.positionHandles(cell);
    this.showHandles();
    this.cancelHide();
  }

  private onMouseLeave(): void {
    if (this.hideTimeout) clearTimeout(this.hideTimeout);
    this.hideTimeout = setTimeout(() => {
      this.hideHandles();
      this.hoveredCell = null;
    }, 200);
  }

  private cancelHide(): void {
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }
  }

  private showHandles(): void {
    this.colHandle.style.display = 'flex';
    this.rowHandle.style.display = 'flex';
  }

  private hideHandles(): void {
    if (this.dropdown) return; // keep visible while dropdown is open
    this.colHandle.style.display = '';
    this.rowHandle.style.display = '';
  }

  private positionHandles(cell: HTMLTableCellElement): void {
    const containerRect = this.dom.getBoundingClientRect();
    const tableRect = this.table.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();

    // Column handle: above the table, centered on the hovered cell
    this.colHandle.style.left = `${cellRect.left - containerRect.left + cellRect.width / 2 - 12}px`;
    this.colHandle.style.top = `${tableRect.top - containerRect.top - 16}px`;

    // Row handle: left of the table, centered on the hovered row
    const tr = cell.closest('tr');
    if (tr) {
      const trRect = tr.getBoundingClientRect();
      this.rowHandle.style.left = `${tableRect.left - containerRect.left - 16}px`;
      this.rowHandle.style.top = `${trRect.top - containerRect.top + trRect.height / 2 - 12}px`;
    }
  }

  private getCellIndices(cell: HTMLTableCellElement): { row: number; col: number } {
    const tr = cell.closest('tr');
    if (!tr) return { row: 0, col: 0 };

    const rows = this.contentDOM.querySelectorAll('tr');
    let row = 0;
    rows.forEach((r, i) => {
      if (r === tr) row = i;
    });

    let col = 0;
    let sibling = cell.previousElementSibling;
    while (sibling) {
      col += (sibling as HTMLTableCellElement).colSpan || 1;
      sibling = sibling.previousElementSibling;
    }

    return { row, col };
  }

  // ─── Handle clicks ───────────────────────────────────────────────────

  private onColClick(): void {
    this.selectColumn(this.hoveredCol);
    this.showDropdown('column');
  }

  private onRowClick(): void {
    this.selectRow(this.hoveredRow);
    this.showDropdown('row');
  }

  private getTablePos(): number {
    const pos = this.view.posAtDOM(this.table, 0);
    const $pos = this.view.state.doc.resolve(pos);
    for (let d = $pos.depth; d > 0; d--) {
      if ($pos.node(d).type.name === 'table') {
        return $pos.before(d);
      }
    }
    return pos;
  }

  private selectRow(row: number): void {
    const tablePos = this.getTablePos();
    const tableStart = tablePos + 1;
    const map = TableMap.get(this.node);
    if (row < 0 || row >= map.height) return;

    const anchorOffset = map.map[row * map.width]!;
    const headOffset = map.map[row * map.width + map.width - 1]!;
    const sel = CellSelection.create(this.view.state.doc, tableStart + anchorOffset, tableStart + headOffset);
    this.view.dispatch(
      this.view.state.tr.setSelection(sel as unknown as ReturnType<typeof TextSelection.create>),
    );
    this.view.focus();
  }

  private selectColumn(col: number): void {
    const tablePos = this.getTablePos();
    const tableStart = tablePos + 1;
    const map = TableMap.get(this.node);
    if (col < 0 || col >= map.width) return;

    const anchorOffset = map.map[col]!;
    const headOffset = map.map[(map.height - 1) * map.width + col]!;
    const sel = CellSelection.create(this.view.state.doc, tableStart + anchorOffset, tableStart + headOffset);
    this.view.dispatch(
      this.view.state.tr.setSelection(sel as unknown as ReturnType<typeof TextSelection.create>),
    );
    this.view.focus();
  }

  private setCursorInCell(row: number, col: number): void {
    const tablePos = this.getTablePos();
    const tableStart = tablePos + 1;
    const map = TableMap.get(this.node);
    if (row < 0 || row >= map.height || col < 0 || col >= map.width) return;

    const cellOffset = map.map[row * map.width + col];
    if (cellOffset == null) return;
    const $pos = this.view.state.doc.resolve(tableStart + cellOffset + 1);
    const sel = TextSelection.near($pos);
    this.view.dispatch(this.view.state.tr.setSelection(sel));
  }

  // ─── Dropdown ────────────────────────────────────────────────────────

  private showDropdown(type: 'row' | 'column'): void {
    this.closeDropdown();

    const dropdown = document.createElement('div');
    dropdown.className = 'dm-table-controls-dropdown';
    dropdown.addEventListener('mouseenter', this.boundCancelHide);
    dropdown.addEventListener('mousedown', (e) => e.preventDefault());

    const items: { label: string; action: () => void }[] =
      type === 'row'
        ? [
            { label: 'Insert Row Above', action: () => this.execRowCmd(addRowBefore) },
            { label: 'Insert Row Below', action: () => this.execRowCmd(addRowAfter) },
            { label: 'Delete Row', action: () => this.execRowCmd(deleteRow) },
          ]
        : [
            { label: 'Insert Column Left', action: () => this.execColCmd(addColumnBefore) },
            { label: 'Insert Column Right', action: () => this.execColCmd(addColumnAfter) },
            { label: 'Delete Column', action: () => this.execColCmd(deleteColumn) },
          ];

    for (const item of items) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = item.label;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        item.action();
        this.closeDropdown();
        this.hideHandles();
      });
      dropdown.appendChild(btn);
    }

    // Position below the handle
    const handle = type === 'row' ? this.rowHandle : this.colHandle;
    const handleRect = handle.getBoundingClientRect();
    const containerRect = this.dom.getBoundingClientRect();
    dropdown.style.left = `${handleRect.left - containerRect.left}px`;
    dropdown.style.top = `${handleRect.bottom - containerRect.top + 4}px`;

    this.dom.appendChild(dropdown);
    this.dropdown = dropdown;

    document.addEventListener('mousedown', this.boundDocMouseDown, true);
    document.addEventListener('keydown', this.boundDocKeyDown);
  }

  private closeDropdown(): void {
    if (!this.dropdown) return;
    this.dropdown.remove();
    this.dropdown = null;
    document.removeEventListener('mousedown', this.boundDocMouseDown, true);
    document.removeEventListener('keydown', this.boundDocKeyDown);
  }

  private onDocMouseDown(e: MouseEvent): void {
    const target = e.target as Node;
    if (
      this.dropdown?.contains(target) ||
      this.colHandle.contains(target) ||
      this.rowHandle.contains(target)
    ) {
      return;
    }
    this.closeDropdown();
  }

  private onDocKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this.closeDropdown();
    }
  }

  private execRowCmd(cmd: PMCommand): void {
    this.setCursorInCell(this.hoveredRow, 0);
    cmd(this.view.state, this.view.dispatch);
  }

  private execColCmd(cmd: PMCommand): void {
    this.setCursorInCell(0, this.hoveredCol);
    cmd(this.view.state, this.view.dispatch);
  }

  // ─── Column management ───────────────────────────────────────────────

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
