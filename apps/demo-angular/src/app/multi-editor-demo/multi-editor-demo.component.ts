import { Component, ChangeDetectionStrategy, OnDestroy, signal, effect } from '@angular/core';
import {
  DomternalEditorComponent,
  DomternalToolbarComponent,
  DomternalBubbleMenuComponent,
} from '@domternal/angular';
import {
  Bold, Italic, Underline, Strike, Code, Link,
  Heading, Blockquote, HardBreak, HorizontalRule,
  BulletList, OrderedList, TaskList, ListIndent,
  SelectionDecoration, ClearFormatting, Dropcursor,
  type AnyExtension, type Editor,
} from '@domternal/core';

interface PanelSpec { id: number; withToolbar: boolean }

/**
 * "Multiple editors" demo (Angular). Several independent editors, every one
 * built from the SAME shared `extensions` array (the page-builder pattern).
 * Regression surface for the shared-extension-instance bug: before the
 * per-editor clone fix, a later editor clobbered earlier ones so list Enter on
 * the earlier ones dropped an indented child paragraph instead of a new <li>.
 * Editor 0 gets a toolbar, the rest a bubble menu. Add / remove at runtime must
 * not break the others.
 *
 * E2E hooks: `window.__MULTI_EDITORS__` (core editors in panel order) and
 * `window.__DEMO_EDITOR__` (the first). Mirrors apps/demo-vanilla.
 */
@Component({
  selector: 'app-multi-editor-demo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DomternalEditorComponent, DomternalToolbarComponent, DomternalBubbleMenuComponent],
  templateUrl: './multi-editor-demo.component.html',
})
export class MultiEditorDemoComponent implements OnDestroy {
  /** ONE shared extensions array, intentionally reused for every editor. */
  readonly extensions: AnyExtension[] = [
    Bold, Italic, Underline, Strike, Code, Link,
    Heading, Blockquote, HardBreak, HorizontalRule,
    BulletList, OrderedList, TaskList, ListIndent,
    SelectionDecoration, ClearFormatting, Dropcursor,
  ];

  readonly bubbleContexts = { text: ['bold', 'italic', 'underline', 'strike', 'code'] };

  // Initial layout: one toolbar editor (the "Hero") plus two bubble-menu editors
  // (the "columns") - the exact shape that exposed the bug.
  readonly panels = signal<PanelSpec[]>([
    { id: 1, withToolbar: true },
    { id: 2, withToolbar: false },
    { id: 3, withToolbar: false },
  ]);
  // Signal so the template's toolbar/bubble `@if` re-evaluates when an editor
  // becomes available.
  readonly editors = signal<Map<number, Editor>>(new Map());

  private nextId = 4;
  private alive = true;

  constructor() {
    // Single owner of the window globals, driven by signals. Runs AFTER the
    // view updates, so the global stays in sync with the rendered panels (no
    // race where the global drops an editor before its panel leaves the DOM).
    effect(() => {
      if (!this.alive) return;
      const map = this.editors();
      const ordered = this.panels()
        .map((p) => map.get(p.id))
        .filter((e): e is Editor => Boolean(e));
      const w = window as unknown as Record<string, unknown>;
      w['__MULTI_EDITORS__'] = ordered;
      w['__DEMO_EDITOR__'] = ordered[0] ?? null;
    });
  }

  contentFor(n: number): string {
    return (
      `<h2>Editor ${String(n)}</h2>` +
      `<p>Independent editor built from the shared config. Put the caret at the end of a list item and press Enter.</p>` +
      `<ul><li><p>Bullet one</p></li><li><p>Bullet two</p></li></ul>` +
      `<ol><li><p>Ordered one</p></li></ol>` +
      `<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Task one</p></li></ul>`
    );
  }

  onEditorCreated(id: number, editor: Editor): void {
    this.editors.update((m) => { const n = new Map(m); n.set(id, editor); return n; });
  }

  onEditorDestroyed(id: number): void {
    this.editors.update((m) => { const n = new Map(m); n.delete(id); return n; });
  }

  addEditor(withToolbar: boolean): void {
    this.panels.update((p) => [...p, { id: this.nextId++, withToolbar }]);
  }

  removeEditor(id: number): void {
    this.panels.update((p) => p.filter((s) => s.id !== id));
  }

  ngOnDestroy(): void {
    this.alive = false;
    const w = window as unknown as Record<string, unknown>;
    delete w['__MULTI_EDITORS__'];
    delete w['__DEMO_EDITOR__'];
  }
}
