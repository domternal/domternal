/**
 * TableView - Custom NodeView for table rendering
 *
 * Creates: div.dm-table-container > [handles] + div.tableWrapper > table > colgroup + tbody
 * - Container enables row/column hover controls (handles with dropdown menus)
 * - Wrapper div enables horizontal scrolling for wide tables
 * - Colgroup reflects column widths from the columnResizing plugin
 * - ContentDOM = tbody (ProseMirror renders row content into tbody)
 */

import { DOMSerializer } from '@domternal/pm/model';
import type { DOMOutputSpec, Node as PMNode } from '@domternal/pm/model';
import type { EditorView, NodeView } from '@domternal/pm/view';
import {
  TableMap,
  CellSelection,
  addRowBefore,
  addRowAfter,
  deleteRow,
  addColumnBefore,
  addColumnAfter,
  deleteColumn,
  deleteTable,
  mergeCells,
  splitCell,
  setCellAttr,
  toggleHeaderCell,
  isInTable,
  selectedRect,
} from '@domternal/pm/tables';
import type { Rect } from '@domternal/pm/tables';
import { positionFloating, positionFloatingOnce, localizeMessage, observeI18nPresentation } from '@domternal/core';

import type { I18nService, ResolvedMessage } from '@domternal/core';
import { tableMessages } from './messages.js';

import { addColumnWithWidths } from './helpers/constrainedColumn.js';
import { resolveSpan } from './helpers/cellAttributes.js';
import { tableHoldsUnsupportedSpan } from './helpers/guardedTableEditing.js';
import { getNodeTableLayout } from './helpers/tableLayout.js';
import { resolveColumnWidths } from './helpers/columnWidths.js';

import {
  DOTS_H, DOTS_V, CHEVRON_DOWN,
  ICON_COLOR, ICON_ALIGNMENT, ICON_HEADER, ICON_MERGE, ICON_SPLIT,
  ICON_ALIGN_LEFT, ICON_ALIGN_CENTER, ICON_ALIGN_RIGHT,
  ICON_ALIGN_TOP, ICON_ALIGN_MIDDLE, ICON_ALIGN_BOTTOM,
  ICON_ROW_PLUS_TOP, ICON_ROW_PLUS_BOTTOM, ICON_DELETE_ROW,
  ICON_COL_PLUS_LEFT, ICON_COL_PLUS_RIGHT, ICON_DELETE_COL,
  CELL_ICON, CELL_COLORS, ICON_RESET,
} from './icons.js';

type PMCommand = (
  state: Parameters<typeof addRowBefore>[0],
  dispatch?: Parameters<typeof addRowBefore>[1],
) => boolean;

/** Type-safe lookup from container DOM element → TableView instance. */
export const tableViewMap = new WeakMap<HTMLElement, TableView>();

/**
 * Whether two versions of a table have as many rows and columns as each other. The later version
 * holds only supported spans; an earlier one that held other spans builds no table map and
 * counts as a different size.
 */
function sameGridSize(previous: PMNode, current: PMNode): boolean {
  if (tableHoldsUnsupportedSpan(previous)) return false;
  const before = TableMap.get(previous);
  const after = TableMap.get(current);
  return before.width === after.width && before.height === after.height;
}

export class TableView implements NodeView {
  node: PMNode;
  cellMinWidth: number;
  defaultCellMinWidth: number;
  view: EditorView;
  constrainToContainer: boolean;

  dom: HTMLElement;
  table: HTMLTableElement;
  colgroup: HTMLTableColElement;
  contentDOM: HTMLElement;

  private readonly localizedElements = new Map<HTMLElement, () => void>();
  private unsubscribeI18n: (() => void) | undefined;

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
  private dropdownCleanup: (() => void) | null = null;
  private cellToolbarCleanup: (() => void) | null = null;
  /** When true, the plugin skips showing the cell toolbar (row/col dropdown is open). */
  suppressCellToolbar = false;
  /** When true, column resize drag is active - all handles/menus are hidden. */
  private _resizeDragging = false;

  private hoveredCell: HTMLTableCellElement | null = null;
  /** The row and column the handles target, as indices into this table's map, or -1. */
  private hoveredRow = -1;
  private hoveredCol = -1;
  /** Which handle's menu is open. While it is, the handles stay on the row or column it acts on. */
  private lineMenu: 'row' | 'column' | null = null;
  /** True while a row or column menu item runs its command. */
  private lineActionRunning = false;
  private hideTimeout: ReturnType<typeof setTimeout> | null = null;

  // Bound handlers for cleanup
  private boundMouseMove: (e: MouseEvent) => void;
  private boundMouseLeave: () => void;
  private boundCancelHide: () => void;
  private boundDocMouseDown: (e: MouseEvent) => void;
  private boundDocKeyDown: (e: KeyboardEvent) => void;

  constructor(node: PMNode, cellMinWidth: number, view: EditorView, defaultCellMinWidth = 100, constrainToContainer = true, private readonly i18n?: I18nService) {
    this.node = node;
    this.cellMinWidth = cellMinWidth;
    this.defaultCellMinWidth = defaultCellMinWidth;
    this.view = view;
    this.constrainToContainer = constrainToContainer;

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
    this.colHandle = this.createHandle('dm-table-col-handle', () => localizeMessage(this.i18n, tableMessages.columnOptions), DOTS_H);
    this.colHandle.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onColClick();
    });
    this.dom.appendChild(this.colHandle);

    // Create row handle
    this.rowHandle = this.createHandle('dm-table-row-handle', () => localizeMessage(this.i18n, tableMessages.rowOptions), DOTS_V);
    this.rowHandle.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onRowClick();
    });
    this.dom.appendChild(this.rowHandle);

    // Create cell toolbar (floating strip, shown by plugin when CellSelection is active)
    this.cellToolbar = this.buildCellToolbar();
    this.dom.appendChild(this.cellToolbar);

    // Create cell handle (small circle - appears when cursor is in a cell)
    this.cellHandle = document.createElement('button');
    this.cellHandle.type = 'button';
    this.cellHandle.className = 'dm-table-cell-handle';
    this.bindLabel(this.cellHandle, () => localizeMessage(this.i18n, tableMessages.cellOptions));
    this.cellHandle.appendChild(DOMSerializer.renderSpec(this.cellHandle.ownerDocument, CELL_ICON).dom);
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
    this.updateLayout(node);

    // Create colgroup
    this.colgroup = document.createElement('colgroup');
    this.updateColumns(node);
    this.table.appendChild(this.colgroup);

    // Create tbody (contentDOM). A node view gets one contentDOM, so every row
    // renders into it and there is no `<thead>`: the print stylesheet
    // synthesises the header group from this shape instead.
    this.contentDOM = document.createElement('tbody');
    this.table.appendChild(this.contentDOM);

    // Hover tracking
    this.dom.addEventListener('mousemove', this.boundMouseMove);
    this.dom.addEventListener('mouseleave', this.boundMouseLeave);
    this.colHandle.addEventListener('mouseenter', this.boundCancelHide);
    this.rowHandle.addEventListener('mouseenter', this.boundCancelHide);
    this.cellHandle.addEventListener('mouseenter', this.boundCancelHide);
    this.unsubscribeI18n = i18n ? observeI18nPresentation(i18n, () => this.dropdown, () => {
      for (const update of this.localizedElements.values()) update();
    }) : undefined;
  }

  // ─── NodeView interface ───────────────────────────────────────────────

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) {
      return false;
    }
    const previous = this.node;
    this.node = node;
    this.updateColumns(node);
    this.updateLayout(node);

    // The next mousemove places the handles again from the cell under the pointer. The targeted
    // row and column stay: a selection redraw, a remote edit or a remote cursor in the table
    // must not leave a handle that opens nothing.
    this.hoveredCell = null;

    if (this.cellHandleCell && !this.table.contains(this.cellHandleCell)) {
      this.hideCellHandle();
    }
    // A table that comes to hold an unsupported span, such as from a collaborator, loses its handles.
    if (this.holdsUnsupportedSpan) {
      this.hoveredRow = -1;
      this.hoveredCol = -1;
      this.hideCellHandle();
      this.hideHandles();
    } else if (previous !== node && !sameGridSize(previous, node)) {
      // Rows or columns came or went, so the targeted indices may now name other lines.
      this.hoveredRow = -1;
      this.hoveredCol = -1;
      // An open row or column menu would act on whichever line took the place of its own. Its
      // own command is left to finish: closing here would let the cell toolbar in over the line.
      if (this.lineMenu && !this.lineActionRunning) this.closeDropdown();
      this.hideHandles();
    }

    return true;
  }

  private updateLayout(node: PMNode): void {
    const layout = getNodeTableLayout(node);
    // The outer node-view box is the browser's fragmentation boundary.
    this.dom.style.breakBefore = layout?.breakBefore ?? '';
    this.dom.style.setProperty('page-break-before', layout?.breakBefore === 'page' ? 'always' : layout?.breakBefore ?? '');
  }

  destroy(): void {
    this.unsubscribeI18n?.();
    this.localizedElements.clear();
    this.dom.removeEventListener('mousemove', this.boundMouseMove);
    this.dom.removeEventListener('mouseleave', this.boundMouseLeave);
    this.colHandle.removeEventListener('mouseenter', this.boundCancelHide);
    this.rowHandle.removeEventListener('mouseenter', this.boundCancelHide);
    this.cellHandle.removeEventListener('mouseenter', this.boundCancelHide);
    this.closeDropdown();
    this.cellToolbarCleanup?.();
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

  /** Patch presentation only, retaining the target element and its interaction state. */
  private bindLabel(element: HTMLElement, resolve: () => ResolvedMessage, textElement?: HTMLElement, aria = true): void {
    const text = textElement?.appendChild(textElement.ownerDocument.createTextNode(''));
    const update = (): void => {
      const revision = this.i18n?.getSnapshot().revision;
      const message = resolve();
      if (this.localizedElements.get(element) !== update) return;
      if (revision !== this.i18n?.getSnapshot().revision) { update(); return; }
      if (aria) element.setAttribute('aria-label', message.text);
      element.lang = message.language;
      if (text && text.data !== message.text) text.data = message.text;
    };
    this.localizedElements.set(element, update);
    update();
  }

  // ─── Handle creation ──────────────────────────────────────────────────

  private createHandle(className: string, label: () => ResolvedMessage, icon: DOMOutputSpec): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = className;
    btn.type = 'button';
    this.bindLabel(btn, label);
    btn.appendChild(DOMSerializer.renderSpec(btn.ownerDocument, icon).dom);
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
    toolbar.setAttribute('role', 'toolbar');
    this.bindLabel(toolbar, () => localizeMessage(this.i18n, tableMessages.cellFormatting));
    toolbar.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    // Read-only: swallow every toolbar action in one place (capture runs
    // before the buttons' own click handlers).
    toolbar.addEventListener(
      'click',
      (e) => {
        if (!this.view.editable) {
          e.preventDefault();
          e.stopPropagation();
        }
      },
      { capture: true }
    );

    // Color button (with dropdown)
    this.colorBtn = this.createToolbarButton(ICON_COLOR, () => localizeMessage(this.i18n, tableMessages.cellColor), CHEVRON_DOWN);
    this.colorBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.colorBtn) this.showColorDropdown(this.colorBtn);
    });
    toolbar.appendChild(this.colorBtn);

    // Alignment button (with dropdown)
    this.alignBtn = this.createToolbarButton(ICON_ALIGNMENT, () => localizeMessage(this.i18n, tableMessages.alignment), CHEVRON_DOWN);
    this.alignBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.alignBtn) this.showAlignmentDropdown(this.alignBtn);
    });
    toolbar.appendChild(this.alignBtn);

    // Separator
    const sep1 = document.createElement('span');
    sep1.className = 'dm-table-cell-toolbar-sep';
    toolbar.appendChild(sep1);

    // Merge cells button
    this.mergeBtn = this.createToolbarButton(ICON_MERGE, () => localizeMessage(this.i18n, tableMessages.mergeCells));
    this.mergeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      mergeCells(this.view.state, this.view.dispatch);
    });
    toolbar.appendChild(this.mergeBtn);

    // Split cell button
    this.splitBtn = this.createToolbarButton(ICON_SPLIT, () => localizeMessage(this.i18n, tableMessages.splitCell));
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
    this.headerBtn = this.createToolbarButton(ICON_HEADER, () => localizeMessage(this.i18n, tableMessages.toggleHeader));
    this.headerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleHeaderCell(this.view.state, this.view.dispatch);
    });
    toolbar.appendChild(this.headerBtn);

    return toolbar;
  }

  private createToolbarButton(icon: DOMOutputSpec, label: () => ResolvedMessage, chevron?: DOMOutputSpec): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dm-table-cell-toolbar-btn';
    this.bindLabel(btn, label);
    btn.appendChild(DOMSerializer.renderSpec(btn.ownerDocument, icon).dom);
    if (chevron) {
      const wrapper = btn.ownerDocument.createElement('span');
      wrapper.className = 'dm-table-cell-toolbar-chevron';
      wrapper.appendChild(DOMSerializer.renderSpec(btn.ownerDocument, chevron).dom);
      btn.appendChild(wrapper);
    }
    return btn;
  }

  // ─── Hover tracking ──────────────────────────────────────────────────

  private onMouseMove(e: MouseEvent): void {
    if (this._resizeDragging) return;
    // Read-only shows no table chrome: every handle action edits the table, and neither does a
    // table that holds an unsupported span.
    if (!this.view.editable || this.holdsUnsupportedSpan) {
      this.hideHandles();
      this.hoveredCell = null;
      return;
    }
    // An open row or column menu keeps its line, and the handles stay on it. A cell toolbar
    // dropdown keeps no line, so the pointer can still target one for a row or column handle.
    if (this.lineMenu) return;

    const target = e.target;
    if (!(target instanceof HTMLElement)) return;

    const cell = target.closest<HTMLTableCellElement>('td, th');
    if (!cell || cell === this.hoveredCell) return;
    // A cell of a nested table is left to that table's own view.
    const rect = this.cellRect(cell);
    if (!rect) return;

    this.hoveredCell = cell;
    // A merged cell keeps the row and column already targeted inside it, so crossing a title row
    // or a merged first column on the way to a handle leaves that handle on its line.
    if (this.hoveredRow < rect.top || this.hoveredRow >= rect.bottom) this.hoveredRow = rect.top;
    if (this.hoveredCol < rect.left || this.hoveredCol >= rect.right) this.hoveredCol = rect.left;
    this.positionHandles(cell);
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

  /** Show the column and row handles. A handle passed false is hidden instead. */
  private showHandles(column = true, row = true): void {
    this.colHandle.style.display = column ? 'flex' : '';
    this.rowHandle.style.display = row ? 'flex' : '';
  }

  private hideHandles(): void {
    if (this.dropdown) return; // keep visible while dropdown is open
    this.colHandle.style.display = '';
    this.rowHandle.style.display = '';
  }

  /**
   * Put the column handle above the targeted column and the row handle beside the targeted row,
   * each centred on that one line, also when the pointer is over a merged cell. A handle whose
   * line has no cell of its own to select stays hidden. The boxes measured are cells and rows,
   * never `<col>` elements, which WebKit gives empty boxes.
   */
  private positionHandles(cell: HTMLTableCellElement): void {
    const containerRect = this.dom.getBoundingClientRect();
    const tableRect = this.table.getBoundingClientRect();

    // Column handle: above the table, centred on a cell lying wholly in the targeted column.
    const columnCells = this.lineCells('column', this.hoveredCol);
    const columnCell = columnCells ? this.view.nodeDOM(this.getTablePos() + 1 + columnCells[0]) : null;
    const columnRect = (columnCell instanceof HTMLElement ? columnCell : cell).getBoundingClientRect();
    this.colHandle.style.left = String(columnRect.left - containerRect.left + columnRect.width / 2 - 12) + 'px';
    this.colHandle.style.top = String(tableRect.top - containerRect.top - 16) + 'px';

    // Row handle: left of the table, centred on the targeted row.
    const rowRect = (this.table.rows[this.hoveredRow] ?? cell).getBoundingClientRect();
    this.rowHandle.style.left = String(tableRect.left - containerRect.left - 16) + 'px';
    this.rowHandle.style.top = String(rowRect.top - containerRect.top + rowRect.height / 2 - 12) + 'px';

    this.showHandles(columnCells !== null, this.lineCells('row', this.hoveredRow) !== null);
  }

  /**
   * The cell's rectangle in this table's map, or null for a cell that is not one of this table's
   * own, such as a cell of a nested table.
   */
  private cellRect(cell: HTMLTableCellElement): Rect | null {
    if (cell.closest('table') !== this.table) return null;
    const tableStart = this.getTablePos() + 1;
    const $pos = this.view.state.doc.resolve(this.view.posAtDOM(cell, 0));
    for (let depth = $pos.depth; depth > 0; depth--) {
      if ($pos.start(depth) !== tableStart) continue;
      // A cell sits two levels below its table, inside a row.
      if ($pos.depth < depth + 2 || $pos.node(depth) !== this.node) return null;
      return TableMap.get(this.node).findCell($pos.before(depth + 2) - tableStart);
    }
    return null;
  }

  /**
   * The table offsets of the first and last cells lying wholly in one row or column, or null when
   * merged cells cover all of it. A cell reaching into the line before or after is left out, so a
   * selection between the two covers that one line, and a command run on it changes no other.
   */
  private lineCells(axis: 'row' | 'column', index: number): [number, number] | null {
    const map = TableMap.get(this.node);
    const { width } = map;
    const column = axis === 'column';
    if (index < 0 || index >= (column ? width : map.height)) return null;
    let first: number | undefined;
    let last: number | undefined;
    for (let i = 0, length = column ? map.height : width; i < length; i++) {
      const slot = column ? i * width + index : index * width + i;
      const offset = map.map[slot];
      if (offset === undefined || offset === last) continue;
      // A cell spans into a neighbouring line when the slot next to it across the line holds it
      // too: left or right for a column, above or below for a row. Past the first or last column
      // the map goes on in another row, so those slots are not compared.
      const spans = column
        ? (index > 0 && map.map[slot - 1] === offset) || (index < width - 1 && map.map[slot + 1] === offset)
        : map.map[slot - width] === offset || map.map[slot + width] === offset;
      if (spans) continue;
      first ??= offset;
      last = offset;
    }
    return first === undefined || last === undefined ? null : [first, last];
  }

  // ─── Cell toolbar positioning (driven by CellSelection plugin) ────────

  /** Called by the cellHandlePlugin when CellSelection changes. */
  updateCellHandle(active: boolean): void {
    if (!active || this._resizeDragging) {
      this.hideCellToolbar();
      this.closeDropdown();
      return;
    }

    const selectedCells = this.table.querySelectorAll('.selectedCell');
    if (selectedCells.length === 0) {
      this.hideCellToolbar();
      return;
    }

    // Position with floating-ui against a virtual reference spanning the
    // selected cells. `placement: 'top'` puts the toolbar above the selection
    // and flips it below when there isn't room above (e.g.
    const reference = {
      getBoundingClientRect: (): DOMRect => {
        let top = Infinity;
        let left = Infinity;
        let right = -Infinity;
        let bottom = -Infinity;
        this.table.querySelectorAll('.selectedCell').forEach((c) => {
          const r = c.getBoundingClientRect();
          if (r.top < top) top = r.top;
          if (r.left < left) left = r.left;
          if (r.right > right) right = r.right;
          if (r.bottom > bottom) bottom = r.bottom;
        });
        return new DOMRect(left, top, right - left, bottom - top);
      },
    };

    this.cellToolbarCleanup?.();
    this.cellToolbar.style.display = 'flex';
    // The editor wrapper is passed as the flip boundary so the toolbar flips
    // below the selection at the editor's top edge. The theme no longer clips
    // `.dm-editor`, so without it the toolbar would render above the editor
    // and cover app chrome (the main toolbar band).
    const editorEl = this.view.dom.closest('.dm-editor');
    this.cellToolbarCleanup = positionFloatingOnce(reference, this.cellToolbar, {
      placement: 'top',
      offsetValue: 6,
      ...(editorEl ? { boundary: editorEl } : {}),
    });

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

  /** Hide the cell toolbar and stop its floating-ui auto-update. */
  private hideCellToolbar(): void {
    this.cellToolbarCleanup?.();
    this.cellToolbarCleanup = null;
    this.cellToolbar.style.display = '';
  }

  // ─── Cell handle (small circle for single-cell operations) ──────────

  /** Hide all controls during column resize drag. Called by the plugin. */
  hideForResize(): void {
    this._resizeDragging = true;
    this.cellHandle.style.display = '';
    this.colHandle.style.display = '';
    this.rowHandle.style.display = '';
    this.hideCellToolbar();
    this.closeDropdown();
  }

  /** Re-enable controls after column resize drag ends. Called by the plugin. */
  showAfterResize(): void {
    this._resizeDragging = false;
  }

  /**
   * Whether this table holds a span loading would replace. Its row, column and cell handles, which
   * select cells and run table commands through its table map, stay hidden until
   * normalizeContentAttributes replaces the span.
   */
  private get holdsUnsupportedSpan(): boolean {
    return tableHoldsUnsupportedSpan(this.node);
  }

  /** Show cell handle at the top-center of the given cell. Always repositions (no early return). */
  showCellHandle(cell: HTMLTableCellElement): void {
    if (this._resizeDragging || this.holdsUnsupportedSpan) return;
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
    // Read-only: cell selection chrome only leads to editing actions.
    if (!this.view.editable || this.holdsUnsupportedSpan) return;
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
    this.openLineMenu('column');
  }

  private onRowClick(): void {
    this.openLineMenu('row');
  }

  /** Select the targeted row or column and open its menu, which keeps acting on that line. */
  private openLineMenu(type: 'row' | 'column'): void {
    if (!this.view.editable || this.holdsUnsupportedSpan) return;
    const index = type === 'row' ? this.hoveredRow : this.hoveredCol;
    // A menu still open is closed first, since closing one lets the cell toolbar back in. The
    // toolbar is then held back before the selection is dispatched, so it does not flash.
    this.closeDropdown();
    this.suppressCellToolbar = true;
    this.hideCellToolbar();
    this.dismissOverlays();
    if (!this.selectLine(type, index)) {
      this.suppressCellToolbar = false;
      return;
    }
    this.showDropdown(type, index);
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
      this.view.state.tr.setSelection(sel),
    );
    this.view.focus();
  }

  /**
   * Select the cells lying wholly in one row or column, so a merged cell that only crosses the
   * line is not selected and does not widen the selection. False when the line has none.
   */
  private selectLine(axis: 'row' | 'column', index: number): boolean {
    const cells = this.lineCells(axis, index);
    if (!cells) return false;
    const tableStart = this.getTablePos() + 1;
    this.dispatchCellSelection(CellSelection.create(this.view.state.doc, tableStart + cells[0], tableStart + cells[1]));
    return true;
  }

  private selectRow(row: number): boolean {
    return this.selectLine('row', row);
  }

  private selectColumn(col: number): boolean {
    return this.selectLine('column', col);
  }

  // ─── Dropdown ────────────────────────────────────────────────────────

  /** Open a row or column handle's menu. Its items act on the row or column `index`. */
  private showDropdown(type: 'row' | 'column', index = type === 'row' ? this.hoveredRow : this.hoveredCol): void {
    this.closeDropdown();

    const dropdown = document.createElement('div');
    dropdown.className = 'dm-table-controls-dropdown';
    dropdown.setAttribute('role', 'menu');
    this.bindLabel(dropdown, () => type === 'row'
      ? localizeMessage(this.i18n, tableMessages.rowOptions)
      : localizeMessage(this.i18n, tableMessages.columnOptions));
    dropdown.addEventListener('mouseenter', this.boundCancelHide);
    dropdown.addEventListener('mousedown', (e) => { e.preventDefault(); });

    const items: { icon: DOMOutputSpec; label: () => ResolvedMessage; action: () => void }[] =
      type === 'row'
        ? [
            { icon: ICON_ROW_PLUS_TOP, label: () => localizeMessage(this.i18n, tableMessages.insertRowAbove), action: () => { this.execRowCmd(addRowBefore, index); } },
            { icon: ICON_ROW_PLUS_BOTTOM, label: () => localizeMessage(this.i18n, tableMessages.insertRowBelow), action: () => { this.execRowCmd(addRowAfter, index); } },
            { icon: ICON_DELETE_ROW, label: () => localizeMessage(this.i18n, tableMessages.deleteRow), action: () => { this.execRowCmd(deleteRow, index); } },
          ]
        : [
            { icon: ICON_COL_PLUS_LEFT, label: () => localizeMessage(this.i18n, tableMessages.insertColumnLeft), action: () => { this.execColCmd(addColumnBefore, index); } },
            { icon: ICON_COL_PLUS_RIGHT, label: () => localizeMessage(this.i18n, tableMessages.insertColumnRight), action: () => { this.execColCmd(addColumnAfter, index); } },
            { icon: ICON_DELETE_COL, label: () => localizeMessage(this.i18n, tableMessages.deleteColumn), action: () => { this.execColCmd(deleteColumn, index); } },
          ];

    for (const item of items) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('role', 'menuitem');
      const icon = document.createElement('span');
      icon.className = 'dm-table-controls-dropdown-icon';
      icon.appendChild(DOMSerializer.renderSpec(icon.ownerDocument, item.icon).dom);
      icon.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span');
      btn.append(icon, label);
      this.bindLabel(btn, item.label, label);
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.lineActionRunning = true;
        try {
          item.action();
        } finally {
          this.lineActionRunning = false;
        }
        this.closeDropdown();
        this.hideHandles();
      });
      dropdown.appendChild(btn);
    }

    const handle = type === 'row' ? this.rowHandle : this.colHandle;
    this.mountDropdown(dropdown, handle, 'bottom-start');
    // The line stays selected while its menu is open: the cell toolbar stays off it, and the
    // handles stay on it.
    this.suppressCellToolbar = true;
    this.lineMenu = type;
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
    dropdown.setAttribute('role', 'menu');
    dropdown.addEventListener('mousedown', (e) => { e.preventDefault(); });
    buildContent(dropdown);
    this.positionToolbarDropdown(dropdown, triggerBtn);
  }

  private showColorDropdown(triggerBtn: HTMLButtonElement): void {
    this.openToolbarDropdown(triggerBtn, 'dm-table-controls-dropdown dm-table-cell-dropdown', (dropdown) => {
      this.bindLabel(dropdown, () => localizeMessage(this.i18n, tableMessages.backgroundColor));
      const palette = document.createElement('div');
      palette.className = 'dm-color-palette';
      palette.style.setProperty('--dm-palette-columns', '4');

      const resetBtn = document.createElement('button');
      resetBtn.type = 'button';
      resetBtn.className = 'dm-color-palette-reset';
      resetBtn.setAttribute('role', 'menuitem');
      this.bindLabel(resetBtn, () => localizeMessage(this.i18n, tableMessages.defaultColor));
      resetBtn.appendChild(DOMSerializer.renderSpec(resetBtn.ownerDocument, ICON_RESET).dom);
      const resetLabel = document.createElement('span');
      resetBtn.append(' ', resetLabel);
      this.bindLabel(resetLabel, () => localizeMessage(this.i18n, tableMessages.defaultColorText), resetLabel, false);
      resetBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        // Refuse the edit if the editor went read-only while this was open.
        if (this.view.editable) setCellAttr('background', null)(this.view.state, this.view.dispatch);
        this.closeDropdown();
      });
      palette.appendChild(resetBtn);

      for (const color of CELL_COLORS) {
        const swatch = document.createElement('button');
        swatch.type = 'button';
        swatch.className = 'dm-color-swatch';
        swatch.setAttribute('role', 'menuitem');
        swatch.style.backgroundColor = color;
        this.bindLabel(swatch, () => localizeMessage(this.i18n, tableMessages.colorSwatch, { color }));
        swatch.addEventListener('click', (e) => {
          e.stopPropagation();
          if (this.view.editable) setCellAttr('background', color)(this.view.state, this.view.dispatch);
          this.closeDropdown();
        });
        palette.appendChild(swatch);
      }
      dropdown.appendChild(palette);
    });
  }

  private showAlignmentDropdown(triggerBtn: HTMLButtonElement): void {
    this.openToolbarDropdown(triggerBtn, 'dm-table-controls-dropdown dm-table-cell-align-dropdown', (dropdown) => {
      this.bindLabel(dropdown, () => localizeMessage(this.i18n, tableMessages.cellAlignment));
      // Read current alignment from the anchor cell in ProseMirror state (the
      // cell toolbar is only visible during CellSelection).
      const sel = this.view.state.selection as CellSelection;
      const cellNode = this.view.state.doc.nodeAt(sel.$anchorCell.pos);
      const curTextAlign = (cellNode?.attrs['textAlign'] as string | undefined) ?? null;
      const curVerticalAlign = (cellNode?.attrs['verticalAlign'] as string | undefined) ?? null;

      const hAligns: { value: string; label: () => ResolvedMessage; icon: DOMOutputSpec }[] = [
        { value: 'left', label: () => localizeMessage(this.i18n, tableMessages.alignLeft), icon: ICON_ALIGN_LEFT },
        { value: 'center', label: () => localizeMessage(this.i18n, tableMessages.alignCenter), icon: ICON_ALIGN_CENTER },
        { value: 'right', label: () => localizeMessage(this.i18n, tableMessages.alignRight), icon: ICON_ALIGN_RIGHT },
      ];

      const vAligns: { value: string; label: () => ResolvedMessage; icon: DOMOutputSpec }[] = [
        { value: 'top', label: () => localizeMessage(this.i18n, tableMessages.alignTop), icon: ICON_ALIGN_TOP },
        { value: 'middle', label: () => localizeMessage(this.i18n, tableMessages.alignMiddle), icon: ICON_ALIGN_MIDDLE },
        { value: 'bottom', label: () => localizeMessage(this.i18n, tableMessages.alignBottom), icon: ICON_ALIGN_BOTTOM },
      ];

      for (const a of hAligns) {
        const isActive = curTextAlign === a.value || (!curTextAlign && a.value === 'left');
        dropdown.appendChild(this.createAlignItem(a.icon, a.label, isActive, () => {
          if (this.view.editable) setCellAttr('textAlign', a.value === 'left' ? null : a.value)(this.view.state, this.view.dispatch);
          this.closeDropdown();
        }));
      }

      const sep = document.createElement('div');
      sep.className = 'dm-table-cell-dropdown-separator';
      sep.setAttribute('role', 'separator');
      dropdown.appendChild(sep);

      for (const a of vAligns) {
        const isActive = curVerticalAlign === a.value || (!curVerticalAlign && a.value === 'top');
        dropdown.appendChild(this.createAlignItem(a.icon, a.label, isActive, () => {
          if (this.view.editable) setCellAttr('verticalAlign', a.value === 'top' ? null : a.value)(this.view.state, this.view.dispatch);
          this.closeDropdown();
        }));
      }
    });
  }

  private createAlignItem(icon: DOMOutputSpec, label: () => ResolvedMessage, active: boolean, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dm-table-align-item' + (active ? ' dm-table-align-item--active' : '');
    btn.setAttribute('role', 'menuitem');
    const iconElement = document.createElement('span');
    iconElement.className = 'dm-table-align-item-icon';
    iconElement.appendChild(DOMSerializer.renderSpec(iconElement.ownerDocument, icon).dom);
    iconElement.setAttribute('aria-hidden', 'true');
    const labelElement = document.createElement('span');
    btn.append(iconElement, labelElement);
    this.bindLabel(btn, label, labelElement);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
    return btn;
  }

  private positionToolbarDropdown(dropdown: HTMLElement, triggerBtn: HTMLButtonElement): void {
    this.mountDropdown(dropdown, triggerBtn, 'bottom-start');
  }

  /**
   * Mount the dropdown inside `.dm-editor` and position it with `fixed`.
   *
   * Two constraints have to hold at once:
   * - The dropdown must be a DOM descendant of the editor so that, when the
   *   editor is portaled into a modal `<dialog>` (top layer), the dropdown
   *   paints in the same top layer rather than beneath the dialog. Appending
   *   to document.body would hide it under the dialog.
   * - `.dm-editor` has `overflow: hidden`, which would clip an absolutely
   *   positioned child that extends past the editor box. `position: fixed`
   *   uses the viewport as its containing block, so it escapes that clip
   *   while still living inside the dialog subtree.
   */
  private mountDropdown(dropdown: HTMLElement, anchor: HTMLElement, placement: 'bottom-start' | 'bottom'): void {
    dropdown.style.position = 'fixed';
    dropdown.style.left = '0';
    dropdown.style.top = '0';

    const editorEl = this.view.dom.closest<HTMLElement>('.dm-editor');
    (editorEl ?? document.body).appendChild(dropdown);
    this.dropdown = dropdown;

    this.dropdownCleanup = positionFloating(anchor, dropdown, { placement, offsetValue: 4 });
    this.addDropdownListeners();
  }

  private addDropdownListeners(): void {
    document.addEventListener('mousedown', this.boundDocMouseDown, true);
    document.addEventListener('keydown', this.boundDocKeyDown);
  }

  private removeDropdownListeners(): void {
    document.removeEventListener('mousedown', this.boundDocMouseDown, true);
    document.removeEventListener('keydown', this.boundDocKeyDown);
  }

  private closeDropdown(): void {
    if (!this.dropdown) return;
    this.dropdownCleanup?.();
    this.dropdownCleanup = null;
    for (const element of this.localizedElements.keys()) {
      if (element === this.dropdown || this.dropdown.contains(element)) this.localizedElements.delete(element);
    }
    this.dropdown.remove();
    this.dropdown = null;
    this.lineMenu = null;
    this.suppressCellToolbar = false;
    this.cellToolbar.querySelectorAll('.dm-table-cell-toolbar-btn--open').forEach(
      (el) => { el.classList.remove('dm-table-cell-toolbar-btn--open'); },
    );
    this.removeDropdownListeners();
    // A change in table size while the dropdown was open cleared the targeted line, so the
    // handles it kept visible would open nothing until the pointer targets a line again.
    if (this.hoveredRow < 0 && this.hoveredCol < 0) this.hideHandles();
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

  /**
   * Run a row command on one row. The row is selected again from the current table first, so the
   * command changes exactly the cells the highlight shows, whatever the selection was meanwhile.
   */
  private execRowCmd(cmd: PMCommand, row = this.hoveredRow): void {
    // A dropdown left open across a switch to read-only must not still mutate
    // (onRowClick already blocks opening a fresh one).
    if (!this.view.editable || this.holdsUnsupportedSpan) return;
    if (!this.selectRow(row)) return;
    const state = this.view.state;
    // With one row selected, this holds only for a table of one row: deleting it deletes the table.
    if (cmd === deleteRow && isInTable(state)) {
      const rect = selectedRect(state);
      if (rect.top === 0 && rect.bottom === rect.map.height) {
        deleteTable(state, this.view.dispatch);
        return;
      }
    }
    cmd(state, this.view.dispatch);
  }

  /** Run a column command on one column, selected again from the current table like a row. */
  private execColCmd(cmd: PMCommand, col = this.hoveredCol): void {
    if (!this.view.editable || this.holdsUnsupportedSpan) return;
    if (!this.selectColumn(col)) return;
    if (cmd === addColumnBefore || cmd === addColumnAfter) {
      addColumnWithWidths(
        cmd === addColumnBefore ? 'before' : 'after',
        this.view.state,
        this.view.dispatch,
        this.view,
        {
          cellMinWidth: this.cellMinWidth,
          defaultCellMinWidth: this.defaultCellMinWidth,
          constrainToContainer: this.constrainToContainer,
        },
      );
      return;
    }
    const state = this.view.state;
    // With one column selected, this holds only for a table of one column.
    if (cmd === deleteColumn && isInTable(state)) {
      const rect = selectedRect(state);
      if (rect.left === 0 && rect.right === rect.map.width) {
        deleteTable(state, this.view.dispatch);
        return;
      }
    }
    cmd(state, this.view.dispatch);
  }

  // ─── Column management ───────────────────────────────────────────────

  /**
   * Update colgroup col elements based on cell widths.
   * Matches prosemirror-tables' updateColumnsOnResize behavior:
   * - Reuses existing col elements (avoids DOM churn during resize)
   * - Uses defaultCellMinWidth for totalWidth calc (matches columnResizing plugin)
   * - Columns without explicit widths get empty style.width (table-layout:
   *   fixed distributes), with the table floored at defaultCellMinWidth per
   *   column so a narrow container scrolls instead of crushing the cells
   */
  private updateColumns(node: PMNode): void {
    let totalWidth = 0;
    let fixedWidth = true;
    let nextDOM = this.colgroup.firstChild as HTMLElement | null;
    const firstRow = node.firstChild;
    if (!firstRow) return;

    for (let i = 0; i < firstRow.childCount; i++) {
      const cell = firstRow.child(i);
      // A stored span loading would replace draws as its replacement, at most 1,000 columns.
      const colspan = resolveSpan(cell.attrs['colspan']);
      const colwidth = resolveColumnWidths(cell.attrs['colwidth']);

      for (let j = 0; j < colspan; j++) {
        const hasWidth = colwidth?.[j];
        const cssWidth = hasWidth ? String(hasWidth) + 'px' : '';
        totalWidth += hasWidth === 0 || hasWidth === undefined ? this.defaultCellMinWidth : hasWidth;
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
      // Floor at defaultCellMinWidth per column even when constrained to the
      // container: without it a table in a narrow flex column compressed to
      // unreadable slivers, since `width: 100%` never exceeds the wrapper and
      // its `overflow-x: auto` had nothing to scroll.
      this.table.style.width = '';
      this.table.style.minWidth = String(totalWidth) + 'px';
    }
  }
}
