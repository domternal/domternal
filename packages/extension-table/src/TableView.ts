/**
 * TableView - Custom NodeView for table rendering
 *
 * Creates: div.dm-table-container > [handles] + div.tableWrapper > table > colgroup + tbody
 * - Container enables row/column hover controls (handles with dropdown menus)
 * - Wrapper div enables horizontal scrolling for wide tables
 * - Colgroup reflects column widths from the columnResizing plugin
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

import {
  DOTS_H, DOTS_V, CHEVRON_DOWN,
  ICON_COLOR, ICON_ALIGNMENT, ICON_HEADER, ICON_MERGE, ICON_SPLIT,
  ICON_ALIGN_LEFT, ICON_ALIGN_CENTER, ICON_ALIGN_RIGHT,
  ICON_ALIGN_TOP, ICON_ALIGN_MIDDLE, ICON_ALIGN_BOTTOM,
  ICON_ROW_PLUS_TOP, ICON_ROW_PLUS_BOTTOM, ICON_DELETE_ROW,
  ICON_COL_PLUS_LEFT, ICON_COL_PLUS_RIGHT, ICON_DELETE_COL,
  CELL_ICON, CELL_COLORS,
} from './icons.js';

type PMCommand = (
  state: Parameters<typeof addRowBefore>[0],
  dispatch?: Parameters<typeof addRowBefore>[1],
) => boolean;

/** Type-safe lookup from container DOM element → TableView instance. */
export const tableViewMap = new WeakMap<HTMLElement, TableView>();

export class TableView implements NodeView {
  node: PMNode;
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
  private colorBtn: HTMLButtonElement | null = null;
  private alignBtn: HTMLButtonElement | null = null;
  private mergeBtn: HTMLButtonElement | null = null;
  private splitBtn: HTMLButtonElement | null = null;
  private headerBtn: HTMLButtonElement | null = null;
  private cellHandle: HTMLButtonElement;
  private cellHandleCell: HTMLTableCellElement | null = null;
  private dropdown: HTMLElement | null = null;
  /** When true, the plugin skips showing the cell toolbar (row/col dropdown is open). */
  suppressCellToolbar = false;
  /** When true, column resize drag is active — all handles/menus are hidden. */
  private _resizeDragging = false;

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

  constructor(node: PMNode, _cellMinWidth: number, view: EditorView, defaultCellMinWidth = 100) {
    this.node = node;
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
    tableViewMap.set(this.dom, this);

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

    // Create cell handle (small circle — appears when cursor is in a cell)
    this.cellHandle = document.createElement('button');
    this.cellHandle.type = 'button';
    this.cellHandle.className = 'dm-table-cell-handle';
    this.cellHandle.setAttribute('aria-label', 'Cell options');
    this.cellHandle.innerHTML = CELL_ICON;
    this.cellHandle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    this.cellHandle.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onCellHandleClick();
    });
    this.dom.appendChild(this.cellHandle);

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
    this.cellHandle.addEventListener('mouseenter', this.boundCancelHide);
  }

  // ─── NodeView interface ───────────────────────────────────────────────

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) {
      return false;
    }
    this.node = node;
    this.updateColumns(node);

    // Reset stale hover references (handles reposition on next mousemove)
    this.hoveredCell = null;
    this.hoveredRow = -1;
    this.hoveredCol = -1;

    if (this.cellHandleCell && !this.table.contains(this.cellHandleCell)) {
      this.hideCellHandle();
    }

    return true;
  }

  destroy(): void {
    this.dom.removeEventListener('mousemove', this.boundMouseMove);
    this.dom.removeEventListener('mouseleave', this.boundMouseLeave);
    this.colHandle.removeEventListener('mouseenter', this.boundCancelHide);
    this.rowHandle.removeEventListener('mouseenter', this.boundCancelHide);
    this.cellHandle.removeEventListener('mouseenter', this.boundCancelHide);
    this.closeDropdown();
    if (this.hideTimeout) clearTimeout(this.hideTimeout);
    tableViewMap.delete(this.dom);
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
    this.colorBtn = this.createToolbarButton(ICON_COLOR, 'Cell color', CHEVRON_DOWN);
    this.colorBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.showColorDropdown(this.colorBtn!);
    });
    toolbar.appendChild(this.colorBtn);

    // Alignment button (with dropdown)
    this.alignBtn = this.createToolbarButton(ICON_ALIGNMENT, 'Alignment', CHEVRON_DOWN);
    this.alignBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.showAlignmentDropdown(this.alignBtn!);
    });
    toolbar.appendChild(this.alignBtn);

    // Separator
    const sep1 = document.createElement('span');
    sep1.className = 'dm-table-cell-toolbar-sep';
    toolbar.appendChild(sep1);

    // Merge cells button
    this.mergeBtn = this.createToolbarButton(ICON_MERGE, 'Merge cells');
    this.mergeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      mergeCells(this.view.state, this.view.dispatch);
    });
    toolbar.appendChild(this.mergeBtn);

    // Split cell button
    this.splitBtn = this.createToolbarButton(ICON_SPLIT, 'Split cell');
    this.splitBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      splitCell(this.view.state, this.view.dispatch);
    });
    toolbar.appendChild(this.splitBtn);

    // Separator
    const sep2 = document.createElement('span');
    sep2.className = 'dm-table-cell-toolbar-sep';
    toolbar.appendChild(sep2);

    // Toggle header button (direct action, no dropdown)
    this.headerBtn = this.createToolbarButton(ICON_HEADER, 'Toggle header cell');
    this.headerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleHeaderCell(this.view.state, this.view.dispatch);
    });
    toolbar.appendChild(this.headerBtn);

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
    if (this._resizeDragging) return;

    const target = e.target;
    if (!(target instanceof HTMLElement)) return;

    const cell = target.closest<HTMLTableCellElement>('td, th');
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
    this.colHandle.style.left = String(cellRect.left - containerRect.left + cellRect.width / 2 - 12) + 'px';
    this.colHandle.style.top = String(tableRect.top - containerRect.top - 16) + 'px';

    // Row handle: left of the table, centered on the hovered row.
    // For merged cells (rowspan > 1), use the cell rect (spans all rows)
    // instead of the <tr> rect (only the first row of the span).
    this.rowHandle.style.left = String(tableRect.left - containerRect.left - 16) + 'px';
    if (cell.rowSpan > 1) {
      this.rowHandle.style.top = String(cellRect.top - containerRect.top + cellRect.height / 2 - 12) + 'px';
    } else {
      const tr = cell.closest('tr');
      if (tr) {
        const trRect = tr.getBoundingClientRect();
        this.rowHandle.style.top = String(trRect.top - containerRect.top + trRect.height / 2 - 12) + 'px';
      }
    }
  }

  private getCellIndices(cell: HTMLTableCellElement): { row: number; col: number } {
    const tr = cell.closest('tr');
    if (!tr) return { row: 0, col: 0 };

    const row = Array.from(this.contentDOM.querySelectorAll('tr')).indexOf(tr);

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
    if (!active || this._resizeDragging) {
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

    // Show toolbar first so offsetWidth is accurate (avoids jump on subsequent updates)
    this.cellToolbar.style.display = 'flex';
    const toolbarWidth = this.cellToolbar.offsetWidth;
    const selectionCenter = (left + right) / 2;
    let toolbarLeft = selectionCenter - containerRect.left - toolbarWidth / 2;

    // Clamp to container bounds
    toolbarLeft = Math.max(0, Math.min(toolbarLeft, containerRect.width - toolbarWidth));

    this.cellToolbar.style.left = String(toolbarLeft) + 'px';
    this.cellToolbar.style.top = String(top - containerRect.top - 36) + 'px';

    // Disable merge/split based on whether command can execute (dry-run without dispatch)
    const canMerge = mergeCells(this.view.state);
    const canSplit = splitCell(this.view.state);
    if (this.mergeBtn) this.mergeBtn.disabled = !canMerge;
    if (this.splitBtn) this.splitBtn.disabled = !canSplit;

    // Highlight trigger buttons based on selected cell attributes
    const sel = this.view.state.selection;
    if (sel instanceof CellSelection) {
      let hasCustomAlign = false;
      let hasCustomColor = false;
      let allHeaders = true;
      sel.forEachCell((node) => {
        if (node.attrs['textAlign'] || node.attrs['verticalAlign']) hasCustomAlign = true;
        if (node.attrs['background']) hasCustomColor = true;
        if (node.type.name !== 'tableHeader') allHeaders = false;
      });
      this.alignBtn?.classList.toggle('dm-table-cell-toolbar-btn--active', hasCustomAlign);
      this.colorBtn?.classList.toggle('dm-table-cell-toolbar-btn--active', hasCustomColor);
      this.headerBtn?.classList.toggle('dm-table-cell-toolbar-btn--active', allHeaders);
    }
  }

  // ─── Cell handle (small circle for single-cell operations) ──────────

  /** Hide all controls during column resize drag. Called by the plugin. */
  hideForResize(): void {
    this._resizeDragging = true;
    this.cellHandle.style.display = '';
    this.colHandle.style.display = '';
    this.rowHandle.style.display = '';
    this.cellToolbar.style.display = '';
    this.closeDropdown();
  }

  /** Re-enable controls after column resize drag ends. Called by the plugin. */
  showAfterResize(): void {
    this._resizeDragging = false;
  }

  /** Show cell handle at the top-center of the given cell. Always repositions (no early return). */
  showCellHandle(cell: HTMLTableCellElement): void {
    if (this._resizeDragging) return;
    this.cellHandleCell = cell;
    const containerRect = this.dom.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    this.cellHandle.style.left = String(cellRect.left - containerRect.left - 7) + 'px';
    this.cellHandle.style.top = String(cellRect.top - containerRect.top - 7) + 'px';
    this.cellHandle.style.display = 'flex';
  }

  /** Hide cell handle. */
  hideCellHandle(): void {
    this.cellHandle.style.display = '';
    this.cellHandleCell = null;
  }

  /** Click on cell handle → create CellSelection for that cell. */
  private onCellHandleClick(): void {
    if (!this.cellHandleCell) return;
    this.dismissOverlays();
    const pos = this.view.posAtDOM(this.cellHandleCell, 0);
    const $pos = this.view.state.doc.resolve(pos);
    for (let d = $pos.depth; d > 0; d--) {
      const node = $pos.node(d);
      if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
        const cellPos = $pos.before(d);
        const sel = CellSelection.create(this.view.state.doc, cellPos, cellPos);
        this.dispatchCellSelection(sel);
        break;
      }
    }
  }

  // ─── Handle clicks ───────────────────────────────────────────────────

  /** Dismiss other floating overlays (bubble menu, etc.) */
  private dismissOverlays(): void {
    this.dom.closest('.dm-editor')?.dispatchEvent(
      new Event('dm:dismiss-overlays', { bubbles: false }),
    );
  }

  private onColClick(): void {
    this.suppressCellToolbar = true;
    this.cellToolbar.style.display = '';
    this.dismissOverlays();
    this.selectColumn(this.hoveredCol);
    this.showDropdown('column');
  }

  private onRowClick(): void {
    this.suppressCellToolbar = true;
    this.cellToolbar.style.display = '';
    this.dismissOverlays();
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

  /** Dispatch a CellSelection and focus the editor. */
  private dispatchCellSelection(sel: CellSelection): void {
    this.view.dispatch(
      this.view.state.tr.setSelection(sel as unknown as ReturnType<typeof TextSelection.create>),
    );
    this.view.focus();
  }

  private selectRow(row: number): void {
    const tablePos = this.getTablePos();
    const tableStart = tablePos + 1;
    const map = TableMap.get(this.node);
    if (row < 0 || row >= map.height) return;

    const anchorOffset = map.map[row * map.width];
    const headOffset = map.map[row * map.width + map.width - 1];
    if (anchorOffset === undefined || headOffset === undefined) return;
    const sel = CellSelection.create(this.view.state.doc, tableStart + anchorOffset, tableStart + headOffset);
    this.dispatchCellSelection(sel);
  }

  private selectColumn(col: number): void {
    const tablePos = this.getTablePos();
    const tableStart = tablePos + 1;
    const map = TableMap.get(this.node);
    if (col < 0 || col >= map.width) return;

    const anchorOffset = map.map[col];
    const headOffset = map.map[(map.height - 1) * map.width + col];
    if (anchorOffset === undefined || headOffset === undefined) return;
    const sel = CellSelection.create(this.view.state.doc, tableStart + anchorOffset, tableStart + headOffset);
    this.dispatchCellSelection(sel);
  }

  private setCursorInCell(row: number, col: number): void {
    const tablePos = this.getTablePos();
    const tableStart = tablePos + 1;
    const map = TableMap.get(this.node);
    if (row < 0 || row >= map.height || col < 0 || col >= map.width) return;

    const cellOffset = map.map[row * map.width + col];
    if (cellOffset === undefined) return;
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
    dropdown.addEventListener('mousedown', (e) => { e.preventDefault(); });

    const items: { icon: string; label: string; action: () => void }[] =
      type === 'row'
        ? [
            { icon: ICON_ROW_PLUS_TOP, label: 'Insert Row Above', action: () => { this.execRowCmd(addRowBefore); } },
            { icon: ICON_ROW_PLUS_BOTTOM, label: 'Insert Row Below', action: () => { this.execRowCmd(addRowAfter); } },
            { icon: ICON_DELETE_ROW, label: 'Delete Row', action: () => { this.execRowCmd(deleteRow); } },
          ]
        : [
            { icon: ICON_COL_PLUS_LEFT, label: 'Insert Column Left', action: () => { this.execColCmd(addColumnBefore); } },
            { icon: ICON_COL_PLUS_RIGHT, label: 'Insert Column Right', action: () => { this.execColCmd(addColumnAfter); } },
            { icon: ICON_DELETE_COL, label: 'Delete Column', action: () => { this.execColCmd(deleteColumn); } },
          ];

    for (const item of items) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.innerHTML = `<span class="dm-table-controls-dropdown-icon">${item.icon}</span>${item.label}`;
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
    dropdown.style.left = String(handleRect.left - containerRect.left) + 'px';
    dropdown.style.top = String(handleRect.bottom - containerRect.top + 4) + 'px';

    this.dom.appendChild(dropdown);
    this.dropdown = dropdown;

    document.addEventListener('mousedown', this.boundDocMouseDown, true);
    document.addEventListener('keydown', this.boundDocKeyDown);
  }

  // ─── Cell toolbar dropdowns ──────────────────────────────────────────

  /** Shared open/toggle for toolbar dropdown buttons. */
  private openToolbarDropdown(triggerBtn: HTMLButtonElement, className: string, buildContent: (dropdown: HTMLElement) => void): void {
    if (this.dropdown && triggerBtn.classList.contains('dm-table-cell-toolbar-btn--open')) {
      this.closeDropdown();
      return;
    }
    this.closeDropdown();
    triggerBtn.classList.add('dm-table-cell-toolbar-btn--open');

    const dropdown = document.createElement('div');
    dropdown.className = className;
    dropdown.addEventListener('mousedown', (e) => { e.preventDefault(); });
    buildContent(dropdown);
    this.positionToolbarDropdown(dropdown, triggerBtn);
  }

  private showColorDropdown(triggerBtn: HTMLButtonElement): void {
    this.openToolbarDropdown(triggerBtn, 'dm-table-controls-dropdown dm-table-cell-dropdown', (dropdown) => {
      const palette = document.createElement('div');
      palette.className = 'dm-color-palette';
      palette.style.setProperty('--dm-palette-columns', '4');

      const resetBtn = document.createElement('button');
      resetBtn.type = 'button';
      resetBtn.className = 'dm-color-palette-reset';
      resetBtn.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="14" height="14"><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm88,104a87.56,87.56,0,0,1-20.41,56.28L71.72,60.41A88,88,0,0,1,216,128ZM40,128A87.56,87.56,0,0,1,60.41,71.72L184.28,195.59A88,88,0,0,1,40,128Z"/></svg>' +
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
    });
  }

  private showAlignmentDropdown(triggerBtn: HTMLButtonElement): void {
    this.openToolbarDropdown(triggerBtn, 'dm-table-controls-dropdown dm-table-cell-align-dropdown', (dropdown) => {
      // Read current alignment from the anchor cell in ProseMirror state
      // (the cell toolbar is only visible during CellSelection)
      const sel = this.view.state.selection as CellSelection;
      const cellNode = this.view.state.doc.nodeAt(sel.$anchorCell.pos);
      const curTextAlign = (cellNode?.attrs['textAlign'] as string) ?? null;
      const curVerticalAlign = (cellNode?.attrs['verticalAlign'] as string) ?? null;

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
    });
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
    dropdown.style.top = String(btnRect.bottom - containerRect.top + 4) + 'px';

    // Append first to measure
    this.dom.appendChild(dropdown);
    this.dropdown = dropdown;

    // Try left-aligned to button; if overflows, shift left
    const dropdownWidth = dropdown.offsetWidth;
    let leftPos = btnRect.left - containerRect.left;
    if (btnRect.left + dropdownWidth > editorRight) {
      leftPos = editorRight - containerRect.left - dropdownWidth - 4;
    }
    dropdown.style.left = String(Math.max(0, leftPos)) + 'px';

    document.addEventListener('mousedown', this.boundDocMouseDown, true);
    document.addEventListener('keydown', this.boundDocKeyDown);
  }

  private closeDropdown(): void {
    if (!this.dropdown) return;
    this.dropdown.remove();
    this.dropdown = null;
    this.suppressCellToolbar = false;
    // Clear open state from toolbar buttons
    this.cellToolbar.querySelectorAll('.dm-table-cell-toolbar-btn--open').forEach(
      (el) => { el.classList.remove('dm-table-cell-toolbar-btn--open'); },
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
        const hasWidth = colwidth?.[j];
        const cssWidth = hasWidth ? String(hasWidth) + 'px' : '';
        totalWidth += hasWidth ?? this.defaultCellMinWidth;
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
      this.table.style.width = String(totalWidth) + 'px';
      this.table.style.minWidth = '';
    } else {
      this.table.style.width = '';
      this.table.style.minWidth = String(totalWidth) + 'px';
    }
  }
}
