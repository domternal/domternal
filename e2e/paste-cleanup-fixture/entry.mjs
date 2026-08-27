import {
  Bold, Italic, Underline, Strike, Link, TextStyle, TextColor, Highlight,
  FontFamily, FontSize, TextAlign, Heading, BulletList, OrderedList, ListItem,
  Blockquote, CodeBlock, HardBreak, UniqueID,
} from '@domternal/core';
import { Image } from '@domternal/extension-image';
import { Table, TableRow, TableCell, TableHeader } from '@domternal/extension-table';
import { Markdown } from '@domternal/extension-markdown';
import { SmartPaste } from '@domternal/extension-block-controls';
import { PasteCleanup } from '@domternal/extension-paste-cleanup';
import { normalizePasteHTML } from '@domternal/extension-paste-cleanup/html';

const query = new URLSearchParams(location.search);
const framework = query.get('framework') ?? 'vanilla';
const formatting = query.get('formatting') === 'adapt' ? 'adapt' : 'preserve';
const limits = query.get('limits') === 'small'
  ? { maxInputLength: 1024, maxNodes: 80, maxDepth: 8, maxTableCells: 16 }
  : undefined;
const results = [];
const transactions = [];
let editor;
let wrapper;

// Each wrapper supplies Document, Paragraph, Text, BaseKeymap and History.
// The optional extension list is identical across all four integrations.
const extensions = [
  Bold, Italic, Underline, Strike, Link, TextStyle, TextColor, Highlight,
  FontFamily, FontSize, TextAlign, Heading, BulletList, OrderedList, ListItem,
  Blockquote, CodeBlock, HardBreak, UniqueID,
  Image.configure({ allowBase64: true }), Table, TableRow, TableCell, TableHeader,
  Markdown, SmartPaste,
  PasteCleanup.configure({
    formatting,
    ...(limits === undefined ? {} : { limits }),
    onResult: result => { results.push(structuredClone(result)); },
  }),
];

function capture(instance) {
  editor = instance;
  editor.on('transaction', ({ transaction }) => {
    if (transaction.docChanged) transactions.push({
      paste: transaction.getMeta('paste') === true,
      uiEvent: transaction.getMeta('uiEvent') ?? null,
    });
  });
}

window.__pasteCleanup = {
  get ready() { return Boolean(editor && !editor.isDestroyed); },
  get editor() { return editor; },
  get wrapper() { return wrapper; },
  get framework() { return framework; },
  get results() { return results; },
  get transactions() { return transactions; },
  normalize: (html, options) => normalizePasteHTML(html, options),
  clearObservations() { results.length = 0; transactions.length = 0; },
  snapshot() { return { doc: editor.getJSON(), selection: editor.state.selection.toJSON() }; },
  serializeSelection() {
    const { dom, text } = editor.view.serializeForClipboard(editor.state.selection.content());
    return { html: dom.innerHTML, text };
  },
};

if (framework === 'vanilla') {
  const { DomternalEditor } = await import('@domternal/vanilla');
  const mount = document.querySelector('#fixture');
  mount.replaceChildren();
  wrapper = new DomternalEditor(mount, { extensions, content: '<p></p>', onCreate: capture });
} else if (framework === 'react') {
  const { createElement: h } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { DomternalEditor } = await import('@domternal/react');
  wrapper = createRoot(document.querySelector('#fixture'));
  wrapper.render(h(DomternalEditor, { extensions, content: '<p></p>', onCreate: capture }));
} else if (framework === 'vue') {
  const { createApp, h } = await import('vue');
  const { DomternalEditor } = await import('@domternal/vue');
  wrapper = createApp({
    setup: () => () => h(DomternalEditor, { extensions, content: '<p></p>', onCreate: capture }),
  });
  wrapper.mount('#fixture');
} else if (framework === 'angular') {
  await import('@angular/compiler');
  const { Component, provideZonelessChangeDetection } = await import('@angular/core');
  const { bootstrapApplication } = await import('@angular/platform-browser');
  const { DomternalEditorComponent } = await import('@domternal/angular');
  class App {
    extensions = extensions;
    created(instance) { capture(instance); }
  }
  Component({
    selector: 'paste-cleanup-test-app', standalone: true,
    imports: [DomternalEditorComponent],
    template: '<domternal-editor [extensions]="extensions" content="<p></p>" (editorCreated)="created($event)" />',
  })(App);
  wrapper = await bootstrapApplication(App, { providers: [provideZonelessChangeDetection()] });
} else {
  throw new Error(`Unknown framework: ${framework}`);
}
