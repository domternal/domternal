import { DomternalEditor } from '@domternal/vanilla';
import { StarterKit, type AnyExtension } from '@domternal/core';

/**
 * "Tab + lists" demo. Two editors built from StarterKit, side by side, each
 * embedded between form fields (an input above and below) so Tab focus
 * traversal is observable - the page-builder / form scenario from issue #98.
 *
 *  - LEFT  (default StarterKit): `listIndent` is OFF. Tab on a paragraph that
 *    merely follows a list is NOT captured, so it moves focus to the next
 *    field. In-list Tab still sinks the item (ListKeymap stays on).
 *  - RIGHT (StarterKit.configure({ listIndent: true })): opt-in. Tab on the
 *    paragraph after the list pulls it INTO the list as a nested child and
 *    focus stays in the editor.
 *
 * E2E hooks: `window.__TAB_EDITORS__` = [defaultEditor, optInEditor] (core
 * editors). Next-field inputs carry data-testid `tab-next-0` / `tab-next-1`.
 */

const CONTENT =
  '<ul><li><p>Bullet one</p></li><li><p>Bullet two</p></li></ul>' +
  '<p>Para after list</p>' +
  '<p>Plain paragraph</p>';

interface Panel {
  wrapper: DomternalEditor;
}

export class TabIndentDemo {
  #container: HTMLElement;
  #panels: Panel[] = [];
  #destroyed = false;

  constructor(container: HTMLElement) {
    this.#container = container;

    const root = document.createElement('div');
    root.className = 'app-tab-indent-demo';

    const desc = document.createElement('p');
    desc.style.cssText = 'color:var(--dm-text-muted,#9a9aa2);margin:0 0 16px;';
    desc.textContent =
      'Two StarterKit editors embedded between form fields. Put the caret in "Para after list" and press Tab. Left (default): focus jumps to the next field. Right (listIndent: true): the paragraph is pulled into the list and focus stays.';
    root.appendChild(desc);

    const grid = document.createElement('div');
    grid.style.cssText =
      'display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px;align-items:start;';
    root.appendChild(grid);

    this.#panels.push(this.#buildPanel(grid, 0, 'StarterKit (default - listIndent OFF)', [StarterKit]));
    this.#panels.push(this.#buildPanel(grid, 1, 'StarterKit({ listIndent: true })', [StarterKit.configure({ listIndent: true }) as AnyExtension]));

    container.appendChild(root);
    this.#exposeForE2E();
  }

  #buildPanel(grid: HTMLElement, index: number, title: string, extensions: AnyExtension[]): Panel {
    const panel = document.createElement('div');
    panel.className = 'tab-indent-panel';
    panel.dataset.editorIndex = String(index);
    panel.style.cssText =
      'border:1px solid rgba(128,128,128,0.3);border-radius:8px;padding:12px;';

    const heading = document.createElement('strong');
    heading.textContent = title;
    heading.style.cssText = 'display:block;margin:0 0 8px;';
    panel.appendChild(heading);

    // Form field BEFORE the editor (so Shift-Tab out of the editor is also
    // observable, and the editor sits between two fields like in a form).
    const prevField = document.createElement('input');
    prevField.type = 'text';
    prevField.placeholder = `Field before editor ${String(index)}`;
    prevField.dataset.testid = `tab-prev-${String(index)}`;
    prevField.style.cssText = 'display:block;width:100%;margin:0 0 8px;box-sizing:border-box;';
    panel.appendChild(prevField);

    const shell = document.createElement('div');
    shell.className = 'dm-editor';
    const host = document.createElement('div');
    shell.appendChild(host);
    panel.appendChild(shell);

    // Form field AFTER the editor - the "next field" Tab should reach.
    const nextField = document.createElement('input');
    nextField.type = 'text';
    nextField.placeholder = `Field after editor ${String(index)}`;
    nextField.dataset.testid = `tab-next-${String(index)}`;
    nextField.style.cssText = 'display:block;width:100%;margin:8px 0 0;box-sizing:border-box;';
    panel.appendChild(nextField);

    grid.appendChild(panel);

    const wrapper = new DomternalEditor(host, {
      extensions,
      content: CONTENT,
    });

    return { wrapper };
  }

  #exposeForE2E(): void {
    const w = window as unknown as Record<string, unknown>;
    w.__TAB_EDITORS__ = this.#panels.map((p) => p.wrapper.editor);
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    for (const p of this.#panels) p.wrapper.destroy();
    this.#panels = [];
    const w = window as unknown as Record<string, unknown>;
    delete w.__TAB_EDITORS__;
    this.#container.replaceChildren();
  }
}
