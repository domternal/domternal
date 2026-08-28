import {
  Bold, Italic, Underline, Strike, Link, TextStyle, TextColor, Highlight,
  FontFamily, FontSize, TextAlign, Heading, BulletList, OrderedList, ListItem,
  Blockquote, CodeBlock, HardBreak, UniqueID, Extension,
} from '@domternal/core';
import { Plugin, TextSelection } from '@domternal/pm/state';
import { undoDepth, redoDepth } from '@domternal/pm/history';
import { Image } from '@domternal/extension-image';
import { Table, TableRow, TableCell, TableHeader } from '@domternal/extension-table';
import { Markdown } from '@domternal/extension-markdown';
import { SmartPaste } from '@domternal/extension-block-controls';
import { PasteCleanup, getPasteAffectedReferences } from '@domternal/extension-paste-cleanup';
import { normalizePasteHTML } from '@domternal/extension-paste-cleanup/html';

const query = new URLSearchParams(location.search);
const framework = query.get('framework') ?? 'vanilla';
const formatting = query.get('formatting') === 'adapt' ? 'adapt' : 'preserve';
const lifecycle = query.get('lifecycle');
const feedback = query.get('feedback') === 'application' ? 'application' : 'default';
const lists = query.get('schema') !== 'no-lists';
const limits = query.get('limits') === 'small'
  ? { maxInputLength: 1024, maxNodes: 80, maxDepth: 8, maxTableCells: 16 }
  : undefined;
const results = [];
const transactions = [];
const operations = [];
const operationSnapshots = [];
const callbackOrder = [];
const destroyedSnapshots = [];
let hostUpdates = 0;
let lifecycleReady = false;
let nestedStarted = false;
let nestedEvent;
let editor;
let wrapper;

const PasteVeto = Extension.create({
  name: 'pasteFixtureVeto',
  priority: 1400,
  addProseMirrorPlugins: () => [new Plugin({
    filterTransaction: transaction => transaction.getMeta('paste') !== true && transaction.getMeta('uiEvent') !== 'paste',
  })],
});

const DestroyBeforeReceiptObserver = Extension.create({
  name: 'pasteFixtureDestroyBeforeObserver',
  priority: 1300,
  addProseMirrorPlugins: () => [new Plugin({ view: () => ({
    update(view, previous) {
      if (!lifecycleReady || view.state.doc.eq(previous.doc)) return;
      lifecycleReady = false;
      destroyedSnapshots.push({ doc: view.state.doc.toJSON(), selection: view.state.selection.toJSON() });
      editor.destroy();
    },
  }) })],
});

const ConsumeNestedPaste = Extension.create({
  name: 'pasteFixtureConsumeNested',
  priority: 1300,
  addProseMirrorPlugins: () => [new Plugin({ props: {
    handlePaste(view, event) {
      if (event !== nestedEvent) return false;
      view.dispatch(view.state.tr.insertText('Nested handled').setMeta('paste', true).setMeta('uiEvent', 'paste'));
      return true;
    },
  } })],
});

const ConsumeOuterAndNest = Extension.create({
  name: 'pasteFixtureConsumeOuterAndNest',
  priority: 1100,
  addProseMirrorPlugins: () => [new Plugin({ props: {
    handlePaste() {
      if (!lifecycleReady || nestedStarted) return false;
      nestedStarted = true;
      nestedEvent = new ClipboardEvent('paste', { cancelable: true });
      editor.view.pasteHTML(lifecycle === 'nested-empty-interception' ? '' : '<p>Nested source</p>', nestedEvent);
      return true;
    },
  } })],
});

// Each wrapper supplies Document, Paragraph, Text, BaseKeymap and History.
// The optional extension list is identical across all four integrations.
const extensions = [
  Bold, Italic, Underline, Strike, Link, TextStyle, TextColor, Highlight,
  FontFamily, FontSize, TextAlign, Heading,
  ...(lists ? [BulletList, OrderedList, ListItem] : []),
  Blockquote, CodeBlock, HardBreak, UniqueID,
  Image.configure({ allowBase64: true }), Table, TableRow, TableCell, TableHeader,
  Markdown, SmartPaste,
  ...(lifecycle === 'veto' ? [PasteVeto] : []),
  ...(lifecycle === 'destroy-before-observe' ? [DestroyBeforeReceiptObserver] : []),
  ...(['nested-interception', 'nested-empty-interception'].includes(lifecycle) ? [ConsumeNestedPaste, ConsumeOuterAndNest] : []),
  PasteCleanup.configure({
    formatting,
    feedback,
    ...(limits === undefined ? {} : { limits }),
    onResult: result => {
      results.push(structuredClone(result));
      callbackOrder.push({ phase: 'normalize', operationId: result.operationId });
    },
    onPasteResult: result => {
      operations.push(structuredClone(result));
      callbackOrder.push({ phase: 'operation', operationId: result.operationId });
      operationSnapshots.push({
        doc: editor.getJSON(),
        selection: editor.state.selection.toJSON(),
        focused: editor.view.hasFocus(),
      });
    },
  }),
];

function capture(instance) {
  editor = instance;
  editor.on('transaction', ({ transaction }) => {
    if (transaction.docChanged) transactions.push({
      paste: transaction.getMeta('paste') === true,
      uiEvent: transaction.getMeta('uiEvent') ?? null,
    });
    if (transaction.getMeta('paste') === true || transaction.getMeta('uiEvent') === 'paste') {
      callbackOrder.push({ phase: 'transaction' });
    }
  });
  editor.on('update', ({ transaction }) => {
    hostUpdates++;
    if (lifecycle === 'throw-update' && transaction.getMeta('paste') === true) {
      throw new Error('Fixture observer failed after commit');
    }
  });
}

window.__pasteCleanup = {
  get ready() { return Boolean(editor && !editor.isDestroyed); },
  get editor() { return editor; },
  get wrapper() { return wrapper; },
  get framework() { return framework; },
  get results() { return results; },
  get transactions() { return transactions; },
  get operations() { return operations; },
  get operationSnapshots() { return operationSnapshots; },
  get destroyedSnapshots() { return destroyedSnapshots; },
  get callbackOrder() { return callbackOrder; },
  get hostUpdates() { return hostUpdates; },
  normalize: (html, options) => normalizePasteHTML(html, options),
  references: id => getPasteAffectedReferences(editor.view, id),
  history: () => ({ undo: undoDepth(editor.state), redo: redoDepth(editor.state) }),
  select(from, to = from) { editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to))); },
  async useGerman() {
    const { deMessages, deSearchAliases } = await import('@domternal/extension-paste-cleanup/locales/de');
    editor.i18n.set({ locale: 'de', messages: deMessages, searchAliases: deSearchAliases });
  },
  pasteProgrammatically(html) {
    try {
      return { handled: editor.view.pasteHTML(html, new ClipboardEvent('paste', { cancelable: true })), error: null };
    } catch (error) {
      return { handled: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
  clearObservations() {
    results.length = 0;
    transactions.length = 0;
    operations.length = 0;
    operationSnapshots.length = 0;
    callbackOrder.length = 0;
    destroyedSnapshots.length = 0;
    hostUpdates = 0;
    lifecycleReady = true;
  },
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
