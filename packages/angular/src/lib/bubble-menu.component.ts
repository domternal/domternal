import {
  Component,
  ChangeDetectionStrategy,
  ViewEncapsulation,
  OnDestroy,
  input,
  signal,
  inject,
  NgZone,
  viewChild,
  ElementRef,
  afterNextRender,
} from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';

import {
  Editor,
  PluginKey,
  ToolbarController,
  createBubbleMenuPlugin,
  defaultIcons,
} from '@domternal/core';
import type { BubbleMenuOptions, ToolbarButton } from '@domternal/core';

interface BubbleMenuSeparator { type: 'separator'; name: string }
type BubbleMenuItem = ToolbarButton | BubbleMenuSeparator;

/** Minimal ProseMirror Selection shape for duck-typing (avoids instanceof issues across bundles) */
interface ResolvedPosShape {
  parent: { type: { name: string; spec: { marks?: string } } };
  depth: number;
  node: (depth: number) => { type: { name: string } };
}

interface SelectionShape {
  empty: boolean;
  $from: ResolvedPosShape;
  $to: ResolvedPosShape;
  node?: { type: { name: string } };
}

/** Check if a resolved position is inside a table cell or header. */
function isInsideTableCell($pos: ResolvedPosShape): boolean {
  for (let d = $pos.depth; d > 0; d--) {
    const name = $pos.node(d).type.name;
    if (name === 'tableCell' || name === 'tableHeader') return true;
  }
  return false;
}

/** ProseMirror schema shape for mark filtering */
interface SchemaShape {
  nodes: Record<string, { allowsMarkType: (mt: unknown) => boolean }>;
  marks: Record<string, unknown>;
}

@Component({
  selector: 'domternal-bubble-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div #menuEl class="dm-bubble-menu">
      @for (item of resolvedItems(); track item.name) {
        @if (item.type === 'separator') {
          <span class="dm-toolbar-separator"></span>
        } @else {
          <button type="button" class="dm-toolbar-button"
            [class.dm-toolbar-button--active]="isItemActive(item)"
            [disabled]="isItemDisabled(item)"
            [title]="item.label"
            [innerHTML]="getCachedIcon(item.icon)"
            (mousedown)="$event.preventDefault()"
            (click)="executeCommand(item)"></button>
        }
      }
      <ng-content />
    </div>
  `,
  styles: [`:host { display: contents; }`],
})
export class DomternalBubbleMenuComponent implements OnDestroy {
  readonly editor = input.required<Editor>();
  readonly shouldShow = input<BubbleMenuOptions['shouldShow']>();
  readonly placement = input<'top' | 'bottom'>('top');
  readonly offset = input<number>(8);
  readonly updateDelay = input(0);

  /** Fixed item names (e.g. ['bold', 'italic', 'code']). Omit for auto mode (all format items). */
  readonly items = input<string[]>();

  /** Context-aware: map context names to item arrays, `true` for all valid items, or `null` to disable */
  readonly contexts = input<Record<string, string[] | true | null>>();

  /** Internal — updated on transactions. Not meant to be set from outside. */
  readonly resolvedItems = signal<BubbleMenuItem[]>([]);

  private menuEl = viewChild.required<ElementRef<HTMLElement>>('menuEl');
  private pluginKey: PluginKey;

  private sanitizer = inject(DomSanitizer);
  private ngZone = inject(NgZone);

  private activeVersion = signal(0);
  private itemMap = new Map<string, ToolbarButton>();
  private activeMap = new Map<string, boolean>();
  private disabledMap = new Map<string, boolean>();
  private htmlCache = new Map<string, SafeHtml>();
  private bubbleDefaults = new Map<string, BubbleMenuItem[]>();
  private transactionHandler: (() => void) | null = null;

  constructor() {
    this.pluginKey = new PluginKey(
      'angularBubbleMenu-' + Math.random().toString(36).slice(2, 8),
    );

    afterNextRender(() => {
      const editor = this.editor();
      const ctxs = this.contexts();
      let shouldShowFn = this.shouldShow();

      if (!shouldShowFn) {
        if (ctxs) {
          shouldShowFn = ({ state }: { state: { selection: SelectionShape } }) => {
            const context = this.detectContext(state.selection, ctxs);
            if (!context) return false;
            if (context in ctxs) {
              const val = ctxs[context];
              if (val === null) return false;
              return val === true || (Array.isArray(val) && val.length > 0);
            }
            return this.bubbleDefaults.has(context);
          };
        } else {
          // Auto/items mode: show when any endpoint's parent allows marks
          shouldShowFn = ({ state }: { state: { selection: SelectionShape } }) => {
            if (state.selection.empty || state.selection.node) return false;
            if (isInsideTableCell(state.selection.$from)) return false;
            return state.selection.$from.parent.type.spec.marks !== ''
                || state.selection.$to.parent.type.spec.marks !== '';
          };
        }
      }

      const plugin = createBubbleMenuPlugin({
        pluginKey: this.pluginKey,
        editor,
        element: this.menuEl().nativeElement,
        shouldShow: shouldShowFn,
        placement: this.placement(),
        offset: this.offset(),
        updateDelay: this.updateDelay(),
      });
      editor.registerPlugin(plugin);
      this.setupItemTracking(editor);
    });
  }

  ngOnDestroy(): void {
    const editor = this.editor();
    if (this.transactionHandler) {
      editor.off('transaction', this.transactionHandler);
    }
    if (!editor.isDestroyed) {
      editor.unregisterPlugin(this.pluginKey);
    }
  }

  // === Template helpers ===

  isItemActive(item: ToolbarButton): boolean {
    this.activeVersion();
    return this.activeMap.get(item.name) ?? false;
  }

  isItemDisabled(item: ToolbarButton): boolean {
    this.activeVersion();
    return this.disabledMap.get(item.name) ?? false;
  }

  getCachedIcon(name: string): SafeHtml {
    let cached = this.htmlCache.get(name);
    if (!cached) {
      cached = this.sanitizer.bypassSecurityTrustHtml(defaultIcons[name] ?? '');
      this.htmlCache.set(name, cached);
    }
    return cached;
  }

  executeCommand(item: ToolbarButton): void {
    if (item.emitEvent) {
      // emitEvent is a dynamic string; cast needed to bypass strict EventEmitter<EditorEvents> typing
      (this.editor().emit as (e: string, d: unknown) => void)(item.emitEvent, {});
      return;
    }
    ToolbarController.executeItem(this.editor(), item);
  }

  // === Internal ===

  private buildItemMap(editor: Editor): void {
    this.itemMap.clear();
    for (const item of editor.toolbarItems) {
      if (item.type === 'button') {
        this.itemMap.set(item.name, item);
      } else if (item.type === 'dropdown') {
        for (const sub of item.items) {
          this.itemMap.set(sub.name, sub);
        }
      }
    }
  }

  private resolveNames(names: string[]): BubbleMenuItem[] {
    const result: BubbleMenuItem[] = [];
    let sepIdx = 0;
    for (const name of names) {
      if (name === '|') {
        result.push({ type: 'separator', name: `sep-${sepIdx++}` });
      } else {
        const item = this.itemMap.get(name);
        if (item) result.push(item);
      }
    }
    return result;
  }

  private getFormatItems(): ToolbarButton[] {
    return Array.from(this.itemMap.values())
      .filter(item => item.group === 'format')
      .sort((a, b) => (b.priority ?? 100) - (a.priority ?? 100));
  }

  private detectContext(selection: SelectionShape, ctxs: Record<string, string[] | true | null>): string | null {
    // CellSelection (duck-type: has $anchorCell) — never show bubble menu
    if ('$anchorCell' in selection) return null;
    if (selection.node) return selection.node.type.name;
    if (selection.empty) return null;

    // TextSelection inside a table cell → 'table' context.
    // Cross-cell TextSelection (drag across cells) → hide bubble menu.
    const fromCell = this.findCellNode(selection.$from);
    if (fromCell) {
      const toCell = this.findCellNode(selection.$to);
      if (toCell && fromCell !== toCell) return null;
      return 'table';
    }

    const fromName = selection.$from.parent.type.name;
    if (fromName in ctxs) return fromName;
    if ('text' in ctxs && selection.$from.parent.type.spec.marks !== '') return 'text';
    // Cross-block: also check $to so bold/italic is offered when any endpoint allows marks
    const toName = selection.$to.parent.type.name;
    if (toName in ctxs) return toName;
    if ('text' in ctxs && selection.$to.parent.type.spec.marks !== '') return 'text';
    return null;
  }

  private findCellNode(pos: ResolvedPosShape): { type: { name: string } } | null {
    for (let d = pos.depth; d > 0; d--) {
      const node = pos.node(d);
      if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
        return node;
      }
    }
    return null;
  }

  /** Filters out mark items that the context node type doesn't allow (e.g. bold on codeBlock) */
  private filterBySchema(editor: Editor, contextName: string, items: ToolbarButton[]): ToolbarButton[] {
    if (contextName === 'text' || contextName === 'table') return items;
    const schema = (editor.state as unknown as { schema?: SchemaShape }).schema;
    if (!schema) return items;
    const nodeType = schema.nodes[contextName];
    if (!nodeType) return items;
    return items.filter(item => {
      const markName = typeof item.isActive === 'string' ? item.isActive : null;
      if (!markName) return true;
      const markType = schema.marks?.[markName];
      if (!markType) return true;
      return nodeType.allowsMarkType(markType);
    });
  }

  private buildBubbleDefaults(editor: Editor): void {
    this.bubbleDefaults.clear();
    const byCtx = new Map<string, ToolbarButton[]>();
    const addItem = (btn: ToolbarButton): void => {
      const ctx = (btn as unknown as Record<string, unknown>)['bubbleMenu'] as string | undefined;
      if (!ctx) return;
      let arr = byCtx.get(ctx);
      if (!arr) { arr = []; byCtx.set(ctx, arr); }
      arr.push(btn);
    };
    for (const item of editor.toolbarItems) {
      if (item.type === 'button') addItem(item);
      else if (item.type === 'dropdown') {
        for (const sub of item.items) addItem(sub);
      }
    }
    for (const [ctx, items] of byCtx) {
      items.sort((a, b) => (b.priority ?? 100) - (a.priority ?? 100));
      const result: BubbleMenuItem[] = [];
      let lastGroup: string | undefined;
      let sepIdx = 0;
      for (const item of items) {
        if (lastGroup !== undefined && item.group !== lastGroup) {
          result.push({ type: 'separator', name: `bsep-${sepIdx++}` });
        }
        result.push(item);
        lastGroup = item.group;
      }
      this.bubbleDefaults.set(ctx, result);
    }
  }

  private setupItemTracking(editor: Editor): void {
    this.buildItemMap(editor);
    this.buildBubbleDefaults(editor);

    if (this.contexts()) {
      this.updateContextItems(editor);
    } else if (this.items()) {
      this.resolvedItems.set(this.resolveNames(this.items()!));
    } else {
      this.resolvedItems.set(this.resolveNames(['bold', 'italic', 'underline']));
    }

    this.transactionHandler = () => {
      this.ngZone.run(() => {
        if (this.contexts()) {
          this.updateContextItems(editor);
        }
        this.updateStates(editor);
        this.activeVersion.update(v => v + 1);
      });
    };
    editor.on('transaction', this.transactionHandler);
    this.updateStates(editor);
  }

  private updateContextItems(editor: Editor): void {
    const ctxs = this.contexts()!;
    const ctx = this.detectContext(editor.state.selection as unknown as SelectionShape, ctxs);
    if (!ctx) {
      this.resolvedItems.set([]);
      return;
    }
    if (ctx in ctxs) {
      const val = ctxs[ctx];
      if (val === null || (Array.isArray(val) && val.length === 0)) {
        this.resolvedItems.set([]);
        return;
      }
      if (val === true) {
        this.resolvedItems.set(this.filterBySchema(editor, ctx, this.getFormatItems()));
      } else {
        const resolved = this.resolveNames(val);
        const buttons = resolved.filter((i): i is ToolbarButton => i.type !== 'separator');
        const filtered = new Set(this.filterBySchema(editor, ctx, buttons).map(b => b.name));
        this.resolvedItems.set(resolved.filter(i => i.type === 'separator' || filtered.has(i.name)));
      }
    } else {
      this.resolvedItems.set(this.bubbleDefaults.get(ctx) ?? []);
    }
  }

  private updateStates(editor: Editor): void {
    let canProxy: Record<string, (...args: unknown[]) => boolean> | null = null;
    try { canProxy = editor.can() as unknown as Record<string, (...args: unknown[]) => boolean>; } catch {}

    for (const item of this.resolvedItems()) {
      if (item.type === 'separator') continue;
      this.activeMap.set(item.name, ToolbarController.resolveActive(editor, item));
      try {
        const canCmd = canProxy?.[item.command];
        this.disabledMap.set(item.name, canCmd
          ? !(item.commandArgs?.length ? canCmd(...item.commandArgs) : canCmd())
          : false);
      } catch { this.disabledMap.set(item.name, false); }
    }
  }

}
