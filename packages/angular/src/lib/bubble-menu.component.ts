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
  createBubbleMenuPlugin,
  defaultIcons,
} from '@domternal/core';
import type { BubbleMenuOptions, ToolbarButton } from '@domternal/core';

/** Minimal ProseMirror Selection shape for duck-typing (avoids instanceof issues across bundles) */
interface SelectionShape {
  empty: boolean;
  $from: { parent: { type: { name: string; spec: { marks?: string } } } };
  node?: { type: { name: string } };
}

@Component({
  selector: 'domternal-bubble-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div #menuEl class="dm-bubble-menu">
      @if (items() || contexts()) {
        @for (item of resolvedItems(); track item.name) {
          <button type="button" class="dm-toolbar-button"
            [class.dm-toolbar-button--active]="isItemActive(item)"
            [disabled]="isItemDisabled(item)"
            [title]="item.label"
            [innerHTML]="getCachedIcon(item.icon)"
            (mousedown)="$event.preventDefault()"
            (click)="executeCommand(item)"></button>
        }
      } @else {
        <ng-content />
      }
    </div>
  `,
  styles: [`:host { display: contents; }`],
})
export class DomternalBubbleMenuComponent implements OnDestroy {
  readonly editor = input.required<Editor>();
  readonly shouldShow = input<BubbleMenuOptions['shouldShow']>();
  readonly placement = input<'top' | 'bottom'>('top');
  readonly offset = input<[number, number]>([0, 8]);
  readonly updateDelay = input(0);

  /** Pass item names to render buttons internally (e.g. ['bold', 'italic', 'code']) */
  readonly items = input<string[]>();

  /** Context-aware items: map context names to item arrays (e.g. { text: ['bold'], codeBlock: ['copyCode'] }) */
  readonly contexts = input<Record<string, string[]>>();

  /** Currently visible buttons */
  readonly resolvedItems = signal<ToolbarButton[]>([]);

  private menuEl = viewChild.required<ElementRef<HTMLElement>>('menuEl');
  private pluginKey: PluginKey;

  private sanitizer = inject(DomSanitizer);
  private ngZone = inject(NgZone);

  /** Bumped on every transaction to trigger isItemActive/isItemDisabled re-eval */
  private activeVersion = signal(0);

  /** Name → ToolbarButton map (built from editor.toolbarItems, includes dropdown sub-items) */
  private itemMap = new Map<string, ToolbarButton>();

  /** Active/disabled state maps */
  private activeMap = new Map<string, boolean>();
  private disabledMap = new Map<string, boolean>();

  /** SafeHtml icon cache */
  private htmlCache = new Map<string, SafeHtml>();

  /** Transaction listener ref for cleanup */
  private transactionHandler: (() => void) | null = null;

  constructor() {
    this.pluginKey = new PluginKey(
      'angularBubbleMenu-' + Math.random().toString(36).slice(2, 8),
    );

    afterNextRender(() => {
      const editor = this.editor();

      const ctxs = this.contexts();
      let shouldShowFn = this.shouldShow();

      if (ctxs && !shouldShowFn) {
        shouldShowFn = ({ state }: { state: { selection: SelectionShape } }) => {
          const context = this.detectContext(state.selection, ctxs);
          return context != null && ctxs[context].length > 0;
        };
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

      if (this.items() || this.contexts()) {
        this.setupItemTracking(editor);
      }
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
    this.activeVersion(); // subscribe to signal changes
    return this.activeMap.get(item.name) ?? false;
  }

  isItemDisabled(item: ToolbarButton): boolean {
    this.activeVersion(); // subscribe to signal changes
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
    const cmd = (this.editor().commands as Record<string, (...args: unknown[]) => boolean>)[item.command];
    if (cmd) item.commandArgs?.length ? cmd(...item.commandArgs) : cmd();
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

  private resolveNames(names: string[]): ToolbarButton[] {
    return names
      .map(name => this.itemMap.get(name))
      .filter((item): item is ToolbarButton => item != null);
  }

  private detectContext(selection: SelectionShape, ctxs: Record<string, string[]>): string | null {
    if (selection.node) return selection.node.type.name;
    if (selection.empty) return null;
    const parentName = selection.$from.parent.type.name;
    if (parentName in ctxs) return parentName;
    // 'text' fallback only for nodes that allow marks (marks='' means no marks, e.g. codeBlock)
    if ('text' in ctxs && selection.$from.parent.type.spec.marks !== '') return 'text';
    return null;
  }

  private setupItemTracking(editor: Editor): void {
    this.buildItemMap(editor);

    if (this.contexts()) {
      this.updateContextItems(editor);
    } else if (this.items()) {
      this.resolvedItems.set(this.resolveNames(this.items()!));
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
    this.resolvedItems.set(this.resolveNames(ctx ? ctxs[ctx] ?? [] : []));
  }

  private updateStates(editor: Editor): void {
    let canProxy: Record<string, (...args: unknown[]) => boolean> | null = null;
    try { canProxy = editor.can() as unknown as Record<string, (...args: unknown[]) => boolean>; } catch {}

    for (const item of this.resolvedItems()) {
      this.activeMap.set(item.name, this.checkActive(editor, item));
      try {
        const canCmd = canProxy?.[item.command];
        this.disabledMap.set(item.name, canCmd
          ? !(item.commandArgs?.length ? canCmd(...item.commandArgs) : canCmd())
          : false);
      } catch { this.disabledMap.set(item.name, false); }
    }
  }

  private checkActive(editor: Editor, item: ToolbarButton): boolean {
    if (item.isActiveFn) return item.isActiveFn(editor);
    if (!item.isActive) return false;
    if (typeof item.isActive === 'string') return editor.isActive(item.isActive);
    if (Array.isArray(item.isActive)) {
      return item.isActive.some(c =>
        typeof c === 'string' ? editor.isActive(c) : editor.isActive(c.name, c.attributes));
    }
    return editor.isActive(item.isActive.name, item.isActive.attributes);
  }
}
