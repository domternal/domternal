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
  mergeCells,
  splitCell,
  setCellAttr,
  toggleHeaderCell,
} from 'prosemirror-tables';

// Inline SVG icons for handle buttons (three dots)
const DOTS_H =
  '<svg width="10" height="4" viewBox="0 0 10 4"><circle cx="2" cy="2" r="1.2" fill="currentColor"/><circle cx="5" cy="2" r="1.2" fill="currentColor"/><circle cx="8" cy="2" r="1.2" fill="currentColor"/></svg>';
const DOTS_V =
  '<svg width="4" height="10" viewBox="0 0 4 10"><circle cx="2" cy="2" r="1.2" fill="currentColor"/><circle cx="2" cy="5" r="1.2" fill="currentColor"/><circle cx="2" cy="8" r="1.2" fill="currentColor"/></svg>';

// Chevron-down for dropdown buttons
const CHEVRON_DOWN =
  '<svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 2.5l3 3 3-3"/></svg>';

// Cell toolbar icons (16×16 Phosphor-style)
const ICON_COLOR =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 256 256" fill="currentColor"><path d="M200,36H56A20,20,0,0,0,36,56V200a20,20,0,0,0,20,20H200a20,20,0,0,0,20-20V56A20,20,0,0,0,200,36Zm-4,160H60V60H196Z"/></svg>';
const ICON_ALIGNMENT =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 256 256" fill="currentColor"><path d="M32,64a8,8,0,0,1,8-8H216a8,8,0,0,1,0,16H40A8,8,0,0,1,32,64Zm8,48H168a8,8,0,0,0,0-16H40a8,8,0,0,0,0,16Zm176,24H40a8,8,0,0,0,0,16H216a8,8,0,0,0,0-16Zm-48,40H40a8,8,0,0,0,0,16H168a8,8,0,0,0,0-16Z"/></svg>';
const ICON_HEADER =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 256 256" fill="currentColor"><path d="M208,32H48A16,16,0,0,0,32,48V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V48A16,16,0,0,0,208,32Zm0,176H48V48H208V208ZM72,96V80a8,8,0,0,1,16,0V96a8,8,0,0,1-16,0Zm96,0V80a8,8,0,0,1,16,0V96a8,8,0,0,1-16,0Zm-48,0V80a8,8,0,0,1,16,0V96a8,8,0,0,1-16,0Z"/></svg>';
// Merge/split icons (16×16)
const ICON_MERGE =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 256 256" fill="currentColor"><path d="M200,40H56A16,16,0,0,0,40,56V200a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V56A16,16,0,0,0,200,40Zm0,16V96H136V56ZM56,56h64V96H56ZM56,200V112H200v88Z"/></svg>';
const ICON_SPLIT =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 256 256" fill="currentColor"><path d="M200,40H56A16,16,0,0,0,40,56V200a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V56A16,16,0,0,0,200,40Zm0,16V96H136V56ZM56,56h64V96H56ZM56,136V112h64v24Zm0,64V152h64v48Zm144,0H136V152h64Zm0-48H136V112h64Z"/></svg>';

// Horizontal alignment icons (Phosphor, 16×16)
const ICON_ALIGN_LEFT =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 256 256" fill="currentColor"><path d="M32,64a8,8,0,0,1,8-8H216a8,8,0,0,1,0,16H40A8,8,0,0,1,32,64Zm8,48H168a8,8,0,0,0,0-16H40a8,8,0,0,0,0,16Zm176,24H40a8,8,0,0,0,0,16H216a8,8,0,0,0,0-16Zm-48,40H40a8,8,0,0,0,0,16H168a8,8,0,0,0,0-16Z"/></svg>';
const ICON_ALIGN_CENTER =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 256 256" fill="currentColor"><path d="M32,64a8,8,0,0,1,8-8H216a8,8,0,0,1,0,16H40A8,8,0,0,1,32,64ZM64,96a8,8,0,0,0,0,16H192a8,8,0,0,0,0-16Zm152,40H40a8,8,0,0,0,0,16H216a8,8,0,0,0,0-16Zm-24,40H64a8,8,0,0,0,0,16H192a8,8,0,0,0,0-16Z"/></svg>';
const ICON_ALIGN_RIGHT =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 256 256" fill="currentColor"><path d="M32,64a8,8,0,0,1,8-8H216a8,8,0,0,1,0,16H40A8,8,0,0,1,32,64ZM216,96H88a8,8,0,0,0,0,16H216a8,8,0,0,0,0-16Zm0,40H40a8,8,0,0,0,0,16H216a8,8,0,0,0,0-16Zm0,40H88a8,8,0,0,0,0,16H216a8,8,0,0,0,0-16Z"/></svg>';

// Vertical alignment icons (16×16)
const ICON_ALIGN_TOP =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 256 256" fill="currentColor"><path d="M40,40H216a8,8,0,0,0,0-16H40a8,8,0,0,0,0,16Zm88,16a8,8,0,0,0-8,8v96a8,8,0,0,0,16,0V64A8,8,0,0,0,128,56Zm40,16a8,8,0,0,0-8,8v64a8,8,0,0,0,16,0V80A8,8,0,0,0,168,72ZM88,72a8,8,0,0,0-8,8v64a8,8,0,0,0,16,0V80A8,8,0,0,0,88,72Z"/></svg>';
const ICON_ALIGN_MIDDLE =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 256 256" fill="currentColor"><path d="M40,136H216a8,8,0,0,0,0-16H40a8,8,0,0,0,0,16Zm88-80a8,8,0,0,0-8,8v32a8,8,0,0,0,16,0V64A8,8,0,0,0,128,56Zm0,104a8,8,0,0,0-8,8v32a8,8,0,0,0,16,0V168A8,8,0,0,0,128,160Zm40-80a8,8,0,0,0-8,8v16a8,8,0,0,0,16,0V88A8,8,0,0,0,168,80Zm0,56a8,8,0,0,0-8,8v16a8,8,0,0,0,16,0V144A8,8,0,0,0,168,136ZM88,80a8,8,0,0,0-8,8v16a8,8,0,0,0,16,0V88A8,8,0,0,0,88,80Zm0,56a8,8,0,0,0-8,8v16a8,8,0,0,0,16,0V144A8,8,0,0,0,88,136Z"/></svg>';
const ICON_ALIGN_BOTTOM =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 256 256" fill="currentColor"><path d="M40,232H216a8,8,0,0,0,0-16H40a8,8,0,0,0,0,16Zm88-32a8,8,0,0,0,8-8V96a8,8,0,0,0-16,0v96A8,8,0,0,0,128,200Zm40-16a8,8,0,0,0,8-8V112a8,8,0,0,0-16,0v64A8,8,0,0,0,168,184ZM88,184a8,8,0,0,0,8-8V112a8,8,0,0,0-16,0v64A8,8,0,0,0,88,184Z"/></svg>';

// Default cell background colors (2 rows × 5 columns)
const CELL_COLORS = [
  '#fef08a', '#fed7aa', '#fecaca', '#fbcfe8', '#d0bfff',
  '#a7f3d0', '#a5f3fc', '#bfdbfe', '#e2e8f0', '#f5f5f5',
];

type PMCommand = (
  state: Parameters<typeof addRowBefore>[0],
  dispatch?: Parameters<typeof addRowBefore>[1],
) => boolean;

export class TableView implements NodeView {
  node: PMNode;
  cellMinWidth: number;
  defaultCellMinWidth: number;
  view: EditorView;

  dom: HTMLElement;
  table: HTMLTableElement;
  colgroup: HTMLTableColElement;
  contentDOM: HTMLElement;

  private wrapper: HTMLElement;
  private colHandle: HTMLButtonElement;
  private rowHandle: HTMLButtonElement;
  private cellToolbar: HTMLElement;
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

  constructor(node: PMNode, cellMinWidth: number, view: EditorView, defaultCellMinWidth = 100) {
    this.node = node;
    this.cellMinWidth = cellMinWidth;
    this.defaultCellMinWidth = defaultCellMinWidth;
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
    (this.dom as any).__tableView = this;

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

    // Create cell toolbar (floating strip, shown by plugin when CellSelection is active)
    this.cellToolbar = this.buildCellToolbar();
    this.dom.appendChild(this.cellToolbar);

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

  // ─── Cell toolbar (floating strip for CellSelection) ──────────────────

  private buildCellToolbar(): HTMLElement {
    const toolbar = document.createElement('div');
    toolbar.className = 'dm-table-cell-toolbar';
    toolbar.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    // Color button (with dropdown)
    const colorBtn = this.createToolbarButton(ICON_COLOR, 'Cell color', CHEVRON_DOWN);
    colorBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.showColorDropdown(colorBtn);
    });
    toolbar.appendChild(colorBtn);

    // Alignment button (with dropdown)
    const alignBtn = this.createToolbarButton(ICON_ALIGNMENT, 'Alignment', CHEVRON_DOWN);
    alignBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.showAlignmentDropdown(alignBtn);
    });
    toolbar.appendChild(alignBtn);

    // Separator
    const sep1 = document.createElement('span');
    sep1.className = 'dm-table-cell-toolbar-sep';
    toolbar.appendChild(sep1);

    // Merge cells button
    const mergeBtn = this.createToolbarButton(ICON_MERGE, 'Merge cells');
    mergeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      mergeCells(this.view.state, this.view.dispatch);
    });
    toolbar.appendChild(mergeBtn);

    // Split cell button
    const splitBtn = this.createToolbarButton(ICON_SPLIT, 'Split cell');
    splitBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      splitCell(this.view.state, this.view.dispatch);
    });
    toolbar.appendChild(splitBtn);

    // Separator
    const sep2 = document.createElement('span');
    sep2.className = 'dm-table-cell-toolbar-sep';
    toolbar.appendChild(sep2);

    // Toggle header button (direct action, no dropdown)
    const headerBtn = this.createToolbarButton(ICON_HEADER, 'Toggle header cell');
    headerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleHeaderCell(this.view.state, this.view.dispatch);
    });
    toolbar.appendChild(headerBtn);

    return toolbar;
  }

  private createToolbarButton(icon: string, label: string, chevron?: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dm-table-cell-toolbar-btn';
    btn.setAttribute('aria-label', label);
    btn.innerHTML = icon + (chevron ? `<span class="dm-table-cell-toolbar-chevron">${chevron}</span>` : '');
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

  // ─── Cell toolbar positioning (driven by CellSelection plugin) ────────

  /** Called by the cellHandlePlugin when CellSelection changes. */
  updateCellHandle(active: boolean): void {
    if (!active) {
      this.cellToolbar.style.display = '';
      this.closeDropdown();
      return;
    }

    // Compute bounding box of ALL selected cells → position toolbar centered above
    const selectedCells = this.table.querySelectorAll('.selectedCell');
    if (selectedCells.length === 0) {
      this.cellToolbar.style.display = '';
      return;
    }

    let top = Infinity;
    let left = Infinity;
    let right = -Infinity;
    selectedCells.forEach((c) => {
      const r = c.getBoundingClientRect();
      if (r.top < top) top = r.top;
      if (r.left < left) left = r.left;
      if (r.right > right) right = r.right;
    });

    const containerRect = this.dom.getBoundingClientRect();
    const toolbarWidth = this.cellToolbar.offsetWidth || 120;
    const selectionCenter = (left + right) / 2;
    let toolbarLeft = selectionCenter - containerRect.left - toolbarWidth / 2;

    // Clamp to container bounds
    toolbarLeft = Math.max(0, Math.min(toolbarLeft, containerRect.width - toolbarWidth));

    this.cellToolbar.style.left = `${toolbarLeft}px`;
    this.cellToolbar.style.top = `${top - containerRect.top - 36}px`;
    this.cellToolbar.style.display = 'flex';
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

  // ─── Cell toolbar dropdowns ──────────────────────────────────────────

  private showColorDropdown(triggerBtn: HTMLButtonElement): void {
    // Toggle — if clicking same button, close
    if (this.dropdown && triggerBtn.classList.contains('dm-table-cell-toolbar-btn--open')) {
      this.closeDropdown();
      return;
    }
    this.closeDropdown();
    triggerBtn.classList.add('dm-table-cell-toolbar-btn--open');

    const dropdown = document.createElement('div');
    dropdown.className = 'dm-table-controls-dropdown dm-table-cell-dropdown';
    dropdown.addEventListener('mousedown', (e) => e.preventDefault());

    // Color palette grid
    const palette = document.createElement('div');
    palette.className = 'dm-color-palette';
    palette.style.setProperty('--dm-palette-columns', '5');

    // Reset button
    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'dm-color-palette-reset';
    resetBtn.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="14" height="14"><path d="M165.66,101.66,139.31,128l26.35,26.34a8,8,0,0,1-11.32,11.32L128,139.31l-26.34,26.35a8,8,0,0,1-11.32-11.32L116.69,128,90.34,101.66a8,8,0,0,1,11.32-11.32L128,116.69l26.34-26.35a8,8,0,0,1,11.32,11.32ZM232,128A104,104,0,1,1,128,24,104.11,104.11,0,0,1,232,128Zm-16,0a88,88,0,1,0-88,88A88.1,88.1,0,0,0,216,128Z"/></svg>' +
      ' Default';
    resetBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      setCellAttr('background', null)(this.view.state, this.view.dispatch);
      this.closeDropdown();
    });
    palette.appendChild(resetBtn);

    for (const color of CELL_COLORS) {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'dm-color-swatch';
      swatch.style.backgroundColor = color;
      swatch.setAttribute('aria-label', color);
      swatch.addEventListener('click', (e) => {
        e.stopPropagation();
        setCellAttr('background', color)(this.view.state, this.view.dispatch);
        this.closeDropdown();
      });
      palette.appendChild(swatch);
    }
    dropdown.appendChild(palette);

    this.positionToolbarDropdown(dropdown, triggerBtn);
  }

  private showAlignmentDropdown(triggerBtn: HTMLButtonElement): void {
    if (this.dropdown && triggerBtn.classList.contains('dm-table-cell-toolbar-btn--open')) {
      this.closeDropdown();
      return;
    }
    this.closeDropdown();
    triggerBtn.classList.add('dm-table-cell-toolbar-btn--open');

    const dropdown = document.createElement('div');
    dropdown.className = 'dm-table-controls-dropdown dm-table-cell-align-dropdown';
    dropdown.addEventListener('mousedown', (e) => e.preventDefault());

    // Read current cell attrs from the first selected cell
    const firstSelected = this.table.querySelector('.selectedCell') as HTMLTableCellElement | null;
    const curTextAlign = firstSelected?.getAttribute('data-text-align') || null;
    const curVerticalAlign = firstSelected?.getAttribute('data-vertical-align') || null;

    const hAligns: { value: string; label: string; icon: string }[] = [
      { value: 'left', label: 'Align left', icon: ICON_ALIGN_LEFT },
      { value: 'center', label: 'Align center', icon: ICON_ALIGN_CENTER },
      { value: 'right', label: 'Align right', icon: ICON_ALIGN_RIGHT },
    ];

    const vAligns: { value: string; label: string; icon: string }[] = [
      { value: 'top', label: 'Align top', icon: ICON_ALIGN_TOP },
      { value: 'middle', label: 'Align middle', icon: ICON_ALIGN_MIDDLE },
      { value: 'bottom', label: 'Align bottom', icon: ICON_ALIGN_BOTTOM },
    ];

    for (const a of hAligns) {
      const isActive = curTextAlign === a.value || (!curTextAlign && a.value === 'left');
      dropdown.appendChild(this.createAlignItem(a.icon, a.label, isActive, () => {
        setCellAttr('textAlign', a.value === 'left' ? null : a.value)(this.view.state, this.view.dispatch);
        this.closeDropdown();
      }));
    }

    const sep = document.createElement('div');
    sep.className = 'dm-table-cell-dropdown-separator';
    dropdown.appendChild(sep);

    for (const a of vAligns) {
      const isActive = curVerticalAlign === a.value || (!curVerticalAlign && a.value === 'top');
      dropdown.appendChild(this.createAlignItem(a.icon, a.label, isActive, () => {
        setCellAttr('verticalAlign', a.value === 'top' ? null : a.value)(this.view.state, this.view.dispatch);
        this.closeDropdown();
      }));
    }

    this.positionToolbarDropdown(dropdown, triggerBtn);
  }

  private createAlignItem(icon: string, label: string, active: boolean, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dm-table-align-item' + (active ? ' dm-table-align-item--active' : '');
    btn.innerHTML = `<span class="dm-table-align-item-icon">${icon}</span><span>${label}</span>`;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
    return btn;
  }

  private positionToolbarDropdown(dropdown: HTMLElement, triggerBtn: HTMLButtonElement): void {
    const containerRect = this.dom.getBoundingClientRect();
    const btnRect = triggerBtn.getBoundingClientRect();
    const editorEl = this.dom.closest('.dm-editor');
    const editorRight = editorEl ? editorEl.getBoundingClientRect().right : window.innerWidth;

    // Position below the toolbar button
    dropdown.style.top = `${btnRect.bottom - containerRect.top + 4}px`;

    // Append first to measure
    this.dom.appendChild(dropdown);
    this.dropdown = dropdown;

    // Try left-aligned to button; if overflows, shift left
    const dropdownWidth = dropdown.offsetWidth;
    let leftPos = btnRect.left - containerRect.left;
    if (btnRect.left + dropdownWidth > editorRight) {
      leftPos = editorRight - containerRect.left - dropdownWidth - 4;
    }
    dropdown.style.left = `${Math.max(0, leftPos)}px`;

    document.addEventListener('mousedown', this.boundDocMouseDown, true);
    document.addEventListener('keydown', this.boundDocKeyDown);
  }

  private closeDropdown(): void {
    if (!this.dropdown) return;
    this.dropdown.remove();
    this.dropdown = null;
    // Clear open state from toolbar buttons
    this.cellToolbar.querySelectorAll('.dm-table-cell-toolbar-btn--open').forEach(
      (el) => el.classList.remove('dm-table-cell-toolbar-btn--open'),
    );
    document.removeEventListener('mousedown', this.boundDocMouseDown, true);
    document.removeEventListener('keydown', this.boundDocKeyDown);
  }

  private onDocMouseDown(e: MouseEvent): void {
    const target = e.target as Node;
    if (
      this.dropdown?.contains(target) ||
      this.cellToolbar.contains(target) ||
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
   * Update colgroup col elements based on cell widths.
   * Matches prosemirror-tables' updateColumnsOnResize behavior:
   * - Reuses existing col elements (avoids DOM churn during resize)
   * - Uses defaultCellMinWidth for totalWidth calc (matches columnResizing plugin)
   * - Columns without explicit widths get empty style.width (table-layout: fixed distributes)
   */
  private updateColumns(node: PMNode): void {
    let totalWidth = 0;
    let fixedWidth = true;
    let nextDOM = this.colgroup.firstChild as HTMLElement | null;
    const firstRow = node.firstChild;
    if (!firstRow) return;

    for (let i = 0; i < firstRow.childCount; i++) {
      const cell = firstRow.child(i);
      const colspan = (cell.attrs['colspan'] as number) || 1;
      const colwidth = cell.attrs['colwidth'] as number[] | null;

      for (let j = 0; j < colspan; j++) {
        const hasWidth = colwidth && colwidth[j];
        const cssWidth = hasWidth ? `${hasWidth}px` : '';
        totalWidth += hasWidth || this.defaultCellMinWidth;
        if (!hasWidth) fixedWidth = false;

        if (!nextDOM) {
          const colEl = document.createElement('col');
          colEl.style.width = cssWidth;
          this.colgroup.appendChild(colEl);
        } else {
          if (nextDOM.style.width !== cssWidth) {
            nextDOM.style.width = cssWidth;
          }
          nextDOM = nextDOM.nextElementSibling as HTMLElement | null;
        }
      }
    }

    // Remove excess col elements
    while (nextDOM) {
      const after = nextDOM.nextElementSibling as HTMLElement | null;
      nextDOM.remove();
      nextDOM = after;
    }

    if (fixedWidth && totalWidth > 0) {
      this.table.style.width = `${totalWidth}px`;
      this.table.style.minWidth = '';
    } else {
      this.table.style.width = '';
      this.table.style.minWidth = `${totalWidth}px`;
    }
  }
}
