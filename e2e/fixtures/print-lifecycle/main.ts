import { Editor, StarterKit, Print, ListLabels } from '@domternal/core';
import type { JSONContent, PrintOptions, PrintStorage } from '@domternal/core';
import { Table } from '@domternal/extension-table';
import '@domternal/theme/css';
import themeCSS from '../../../packages/theme/dist/domternal-theme.css?inline';

const editors = new Map<string, Editor>();
const roots = new Map<string, HTMLElement>();
const events: string[] = [];
const prints: { roots: string[]; images: boolean; headers: number }[] = [];
const host = document.getElementById('editors');
if (!host) throw new Error('Missing print fixture host');
function getEditor(id: string): Editor {
  const editor = editors.get(id);
  if (!editor) throw new Error(`Missing print fixture editor: ${id}`);
  return editor;
}
function getRoot(id: string): HTMLElement {
  const root = roots.get(id);
  if (!root) throw new Error(`Missing print fixture root: ${id}`);
  return root;
}
let throwPrint = false;
window.print = () => {
  window.dispatchEvent(new Event('beforeprint'));
  prints.push({ roots: Array.from(roots).filter(([, root]) => root.classList.contains('dm-print-root')).map(([id]) => id),
    images: Array.from(roots.values()).every(root => Array.from(root.querySelectorAll('img')).every(img => img.complete && img.naturalWidth > 0)),
    headers: Array.from(roots.values()).reduce((count, root) => count + root.querySelectorAll('.dm-print-table-head tr').length, 0) });
  if (throwPrint) throw new Error('Fixture blocked the print dialog');
  window.dispatchEvent(new Event('afterprint'));
};

const probe = {
  ready: true,
  mount(id: string, options: Partial<PrintOptions> = {}, shadow = false) {
    const wrapper = document.createElement('section'); wrapper.id = id; wrapper.className = 'dm-editor';
    if (shadow) {
      const shell = document.createElement('div'); shell.id = `${id}-host`; host.append(shell);
      const tree = shell.attachShadow({ mode: 'open' });
      const style = document.createElement('style'); style.textContent = themeCSS;
      const chrome = document.createElement('nav'); chrome.className = 'shadow-chrome'; chrome.textContent = 'Shadow application controls';
      const frame = document.createElement('div'); frame.className = 'shadow-shell'; frame.style.maxHeight = '180px'; frame.style.overflow = 'auto';
      frame.append(wrapper); tree.append(style, chrome, frame);
    } else host.append(wrapper);
    const editor = new Editor({ element: wrapper, extensions: [StarterKit, Table, ListLabels, Print.configure(options)], content: '<p>Print target</p>' });
    for (const event of ['beforePrint', 'afterPrint', 'printPreparationError'] as const) editor.on(event, () => { events.push(`${id}:${event}`); });
    editors.set(id, editor); roots.set(id, wrapper);
  },
  html(id: string, value: string) { getEditor(id).setContent(value); },
  json(id: string, value: string) { getEditor(id).setContent(JSON.parse(value) as JSONContent); },
  snapshot(id: string) {
    const editor = getEditor(id);
    return { json: JSON.stringify(editor.getJSON()), html: editor.getHTML(), selection: editor.state.selection.toJSON() as unknown };
  },
  editor(id: string) { return getEditor(id); },
  root(id: string) { return getRoot(id); },
  async print(id: string) {
    const editor = getEditor(id);
    const accepted = editor.commands.printDocument();
    const preparation = (editor.storage['print'] as PrintStorage).preparation;
    const result = preparation ? await preparation : undefined;
    return { accepted, status: result?.status ?? 'synchronous', error: result?.status === 'failed' ? result.error.message : undefined };
  },
  request(id: string) { return getEditor(id).commands.printDocument(); },
  cancel(id: string) { return getEditor(id).commands.cancelPrintPreparation(); },
  destroy(id: string) { getEditor(id).destroy(); },
  failPrint(value: boolean) { throwPrint = value; },
  state() { return { prints, events, markers: Array.from(roots.values()).reduce((count, root) => count + root.querySelectorAll('[data-dm-print-header-source], .dm-print-table-head').length, 0), printing: document.body.classList.contains('dm-printing') }; },
};
(window as unknown as { __print: typeof probe }).__print = probe;
