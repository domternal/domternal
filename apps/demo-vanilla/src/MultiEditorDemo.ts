import { DomternalEditor, DomternalToolbar, DomternalBubbleMenu } from '@domternal/vanilla';
import {
  Bold, Italic, Underline, Strike, Code, Link,
  Heading, Blockquote, HardBreak, HorizontalRule,
  BulletList, OrderedList, TaskList, ListIndent,
  SelectionDecoration, ClearFormatting, Dropcursor,
  type AnyExtension,
} from '@domternal/core';

/**
 * "Multiple editors" demo. Mounts several independent editor instances on one
 * page, every one built from the SAME shared `extensions` array (the page
 * builder pattern: a Hero field plus column fields, each its own editor).
 *
 * This is the regression surface for the shared-extension-instance bug: before
 * the per-editor clone fix, creating a second editor from the same extension
 * objects clobbered the first, so list Enter on the earlier editors fell back
 * to a plain block split and dropped an indented child paragraph instead of a
 * new <li>. Here every editor must keep working: lists, undo, and typing stay
 * isolated, and adding / removing editors at runtime never breaks the others.
 *
 * E2E hooks: `window.__MULTI_EDITORS__` (array of core editors, in panel
 * order) and `window.__DEMO_EDITOR__` (the first one, for shared helpers).
 *
 * Mirrors apps/demo-{react,vue,angular} once approved.
 */

/** One realistic extension config, built ONCE and reused for every editor. */
function buildExtensions(): AnyExtension[] {
  return [
    Bold, Italic, Underline, Strike, Code, Link,
    Heading, Blockquote, HardBreak, HorizontalRule,
    BulletList, OrderedList, TaskList, ListIndent,
    SelectionDecoration, ClearFormatting, Dropcursor,
  ];
}

/** Sample content per editor: a heading, a paragraph, and all three list types
 *  so list Enter can be exercised in every editor. */
function sampleContent(n: number): string {
  return (
    `<h2>Editor ${String(n)}</h2>` +
    `<p>Independent editor built from the shared config. Put the caret at the end of a list item and press Enter.</p>` +
    `<ul><li><p>Bullet one</p></li><li><p>Bullet two</p></li></ul>` +
    `<ol><li><p>Ordered one</p></li></ol>` +
    `<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Task one</p></li></ul>`
  );
}

interface EditorEntry {
  wrapper: DomternalEditor;
  toolbar?: DomternalToolbar;
  bubble?: DomternalBubbleMenu;
  panel: HTMLElement;
}

export class MultiEditorDemo {
  #container: HTMLElement;
  #grid: HTMLElement;
  /** ONE shared extensions array, intentionally reused for every editor. */
  #sharedExtensions: AnyExtension[];
  #entries: EditorEntry[] = [];
  #counter = 0;
  #destroyed = false;

  constructor(container: HTMLElement) {
    this.#container = container;
    this.#sharedExtensions = buildExtensions();

    const root = document.createElement('div');
    root.className = 'app-multi-editor-demo';

    const desc = document.createElement('p');
    desc.className = 'multi-editor-desc';
    desc.style.cssText = 'color:var(--dm-text-muted,#9a9aa2);margin:0 0 12px;';
    desc.textContent =
      'Several independent editors, all built from one shared extension config. Lists keep working in every editor, including ones mounted before later editors. Add or remove editors at runtime to confirm nothing else breaks.';
    root.appendChild(desc);

    const controls = document.createElement('div');
    controls.style.cssText = 'display:flex;gap:8px;margin:0 0 16px;';
    const addBubble = document.createElement('button');
    addBubble.textContent = '+ Add editor (bubble menu)';
    addBubble.dataset.testid = 'multi-add-bubble';
    addBubble.addEventListener('click', () => { this.#addEditor({ withToolbar: false }); });
    const addToolbar = document.createElement('button');
    addToolbar.textContent = '+ Add editor (toolbar)';
    addToolbar.dataset.testid = 'multi-add-toolbar';
    addToolbar.addEventListener('click', () => { this.#addEditor({ withToolbar: true }); });
    controls.append(addBubble, addToolbar);
    root.appendChild(controls);

    const grid = document.createElement('div');
    grid.className = 'multi-editor-grid';
    grid.style.cssText =
      'display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px;align-items:start;';
    root.appendChild(grid);
    this.#grid = grid;

    container.appendChild(root);

    // Initial layout: one toolbar editor (the "Hero") plus two bubble-menu
    // editors (the "columns") - the exact shape that exposed the bug.
    this.#addEditor({ withToolbar: true });
    this.#addEditor({ withToolbar: false });
    this.#addEditor({ withToolbar: false });
  }

  #addEditor(opts: { withToolbar: boolean }): void {
    if (this.#destroyed) return;
    const n = ++this.#counter;

    const panel = document.createElement('div');
    panel.className = 'multi-editor-panel';
    // Theme-neutral: subtle border, inherit page background + text colour so it
    // reads correctly in both light and dark themes.
    panel.style.cssText =
      'border:1px solid rgba(128,128,128,0.3);border-radius:8px;padding:12px;';

    const head = document.createElement('div');
    head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin:0 0 8px;';
    const title = document.createElement('strong');
    title.textContent = `Editor ${String(n)} (${opts.withToolbar ? 'toolbar' : 'bubble menu'})`;
    const removeBtn = document.createElement('button');
    removeBtn.textContent = 'Remove';
    removeBtn.dataset.testid = 'multi-remove-editor';
    head.append(title, removeBtn);
    panel.appendChild(head);

    const toolbarHost = document.createElement('div');
    if (opts.withToolbar) panel.appendChild(toolbarHost);

    const shell = document.createElement('div');
    shell.className = 'dm-editor';
    const host = document.createElement('div');
    shell.appendChild(host);
    panel.appendChild(shell);

    const bubbleHost = document.createElement('div');
    panel.appendChild(bubbleHost);

    this.#grid.appendChild(panel);

    // SAME shared array passed to every editor - the manager clones it per editor.
    const wrapper = new DomternalEditor(host, {
      extensions: this.#sharedExtensions,
      content: sampleContent(n),
    });
    const editor = wrapper.editor;

    const entry: EditorEntry = { wrapper, panel };
    if (opts.withToolbar) {
      entry.toolbar = new DomternalToolbar(toolbarHost, { editor });
    } else {
      entry.bubble = new DomternalBubbleMenu(bubbleHost, { editor });
    }

    removeBtn.addEventListener('click', () => { this.#removeEditor(entry); });

    this.#entries.push(entry);
    this.#reindex();
    this.#exposeForE2E();
  }

  #removeEditor(entry: EditorEntry): void {
    const idx = this.#entries.indexOf(entry);
    if (idx === -1) return;
    entry.toolbar?.destroy();
    entry.bubble?.destroy();
    entry.wrapper.destroy();
    entry.panel.remove();
    this.#entries.splice(idx, 1);
    this.#reindex();
    this.#exposeForE2E();
  }

  #reindex(): void {
    this.#entries.forEach((e, i) => { e.panel.dataset.editorIndex = String(i); });
  }

  #exposeForE2E(): void {
    const w = window as unknown as Record<string, unknown>;
    const editors = this.#entries.map((e) => e.wrapper.editor);
    w.__MULTI_EDITORS__ = editors;
    w.__DEMO_EDITOR__ = editors[0] ?? null;
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    for (const e of this.#entries) {
      e.toolbar?.destroy();
      e.bubble?.destroy();
      e.wrapper.destroy();
    }
    this.#entries = [];
    const w = window as unknown as Record<string, unknown>;
    delete w.__MULTI_EDITORS__;
    delete w.__DEMO_EDITOR__;
    this.#container.replaceChildren();
  }
}
