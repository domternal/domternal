import { Editor, Document, Paragraph, Text, OrderedList, BulletList, ListLabels, History, BaseKeymap, generateHTML, generateJSON, getListLabelStyleSheet } from '@domternal/core';
import type { AnyExtension, JSONContent } from '@domternal/core';
import { TextSelection } from '@domternal/pm/state';
import { splitListItem } from '@domternal/pm/schema-list';

const extensions = (labels = true, hosted = false): AnyExtension[] => [Document, Paragraph, Text, OrderedList, BulletList, History, BaseKeymap,
  ...(labels ? [ListLabels.configure({ injectCSS: !hosted, nonce: 'list-label-test' })] : [])];
const sample = document.querySelector<HTMLElement>('#sample');
if (!sample) throw new Error('Missing editor mount');
const editor = new Editor({ element: sample, extensions: extensions(), content: '<p>Ready</p>' });
let shadowEditor: Editor | undefined;
const probe = {
  editor,
  set(json: string) { editor.setContent(JSON.parse(json) as JSONContent, false); editor.view.dom.blur(); },
  snapshot() { return { json: JSON.stringify(editor.getJSON()), html: editor.getHTML(), text: editor.getText() }; },
  roundtrip() {
    const content = editor.getJSON(); const html = generateHTML(content, extensions());
    return { json: JSON.stringify(generateJSON(html, extensions())), html, css: getListLabelStyleSheet(content) };
  },
  pasteCopy() {
    editor.commands.selectAll(); const copied = editor.view.serializeForClipboard(editor.state.selection.content());
    editor.setContent('<p>Before</p>', false); editor.commands.selectAll();
    editor.view.pasteHTML(copied.dom.innerHTML, new ClipboardEvent('paste'));
    return { text: copied.text, html: copied.dom.innerHTML };
  },
  split() {
    let position = -1;
    editor.state.doc.descendants((node, pos) => { if (position === -1 && node.isTextblock) position = pos + 2; });
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, position)));
    const type = editor.schema.nodes['listItem']; if (!type) throw new Error('Missing list item');
    return splitListItem(type)(editor.state, editor.view.dispatch);
  },
  fallback(html: string) {
    const mount = document.createElement('div'); document.body.append(mount);
    const older = new Editor({ element: mount, extensions: extensions(false), content: html });
    const result = { text: older.getText(), html: older.getHTML(), json: older.getJSON() };
    older.destroy(); mount.remove(); return result;
  },
  shadow(json: string) {
    const host = document.createElement('div'); host.id = 'shadow'; host.style.width = '850px'; document.body.append(host);
    const root = host.attachShadow({ mode: 'open' });
    const base = document.createElement('style'); base.textContent = 'ol,ul{padding-left:320px;margin:0}p{margin:0}.ProseMirror{padding:16px 24px;outline:none}li::marker{font-variant-numeric:tabular-nums}'; root.append(base);
    const mount = document.createElement('div'); mount.id = 'shadow-sample'; root.append(mount);
    shadowEditor = new Editor({ element: mount, extensions: extensions(), content: JSON.parse(json) as JSONContent });
    return { json: JSON.stringify(shadowEditor.getJSON()), css: root.querySelector('style[data-domternal-list-labels]')?.textContent };
  },
  async adoptShadow() {
    const host = document.querySelector<HTMLElement>('#shadow'); const root = host?.shadowRoot;
    const mount = root?.querySelector<HTMLElement>('#shadow-sample');
    if (!host || !root || !mount || !shadowEditor) throw new Error('Missing shadow editor');
    const iframe = document.createElement('iframe'); iframe.id = 'adopted'; iframe.style.cssText = 'width:900px;height:250px;border:0';
    const loaded = new Promise<void>(resolve => { iframe.addEventListener('load', () => { resolve(); }, { once: true }); });
    document.body.append(iframe); await loaded;
    const target = iframe.contentDocument;
    if (!target) throw new Error('Missing frame document');
    const style = target.createElement('style'); style.textContent = 'body{margin:0;background:white;color:black;font:20px/36px Arial}'; target.head.append(style);
    target.body.append(target.adoptNode(host)); shadowEditor.adoptDom(mount);
    return { json: JSON.stringify(shadowEditor.getJSON()), oldCSS: document.querySelector('style[data-domternal-list-labels]')?.textContent,
      newCSS: target.querySelector('style[data-domternal-list-labels]')?.textContent,
      shadowCSS: root.querySelector('style[data-domternal-list-labels]')?.textContent };
  },
  destroyShadow() {
    shadowEditor?.destroy(); shadowEditor = undefined;
    const target = document.querySelector<HTMLIFrameElement>('#adopted')?.contentDocument;
    const shadow = target?.querySelector('#shadow')?.shadowRoot;
    return { documentStyles: target?.querySelectorAll('style[data-domternal-list-labels]').length,
      shadowStyles: shadow?.querySelectorAll('style[data-domternal-list-labels]').length };
  },

};
Object.assign(window, { __listLabels: probe });
export type ListLabelProbe = typeof probe;
