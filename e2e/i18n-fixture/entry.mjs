import { Bold, Italic, Placeholder, Extension } from '@domternal/core';
import { deMessages, deSearchAliases } from '@domternal/core/locales/de';
import { undoDepth, redoDepth } from '@domternal/pm/history';

const framework = new URLSearchParams(location.search).get('framework') ?? 'vanilla';
const imperative = new URLSearchParams(location.search).has('imperative');
const asyncScenario = new URLSearchParams(location.search).has('async');
const uploadedSource = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';
const asyncStatus = { mentionCalls: 0, uploadCalls: 0, file: null };
let pendingMention;
let pendingUpload;
const initial = {
  locale: 'fr',
  messages: {
    'core.editor.label': 'Éditeur initial',
    'core.toolbar.bold': 'Gras initial',
    'core.placeholder.default': 'Must not replace an explicitly configured default',
  },
};
const extensions = [Bold, Italic, Placeholder.configure({ placeholder: 'Write something …' }), Extension.create({
  name: 'applicationToolbarLabels',
  addToolbarItems() {
    return [
      { type: 'button', name: 'applicationBold', command: 'toggleBold', label: 'Bold', labelLanguage: 'en',
        icon: 'bold', group: 'application', groupLabel: 'Application tools', groupLabelLanguage: 'en' },
      { type: 'button', name: 'ungroupedCaller', command: 'toggleItalic', label: 'Ungrouped caller', icon: 'italic' },
      { type: 'button', name: 'unknownLanguage', command: 'toggleItalic', label: 'Caller action',
        icon: 'italic', group: 'application', groupLabel: 'Application tools', groupLabelLanguage: 'en' },
      { type: 'dropdown', name: 'dynamicCaller', label: 'Menu français', labelLanguage: 'fr', icon: 'bold', group: 'caller',
        dynamicLabel: true, dynamicLabelFallback: 'Choisir', items: [
          { type: 'button', name: 'dynamicItalic', label: 'Unknown italic', command: 'toggleItalic', isActive: 'italic', icon: 'italic' },
          { type: 'button', name: 'dynamicBold', label: 'Known bold', labelLanguage: 'en', command: 'toggleBold', isActive: 'bold', icon: 'bold' },
        ] },
      { type: 'dropdown', name: 'callerDropdown', label: 'Caller menu', icon: 'bold', group: 'caller', groupLabel: 'Caller tools',
        items: [{ type: 'button', name: 'callerItem', label: 'Caller item', icon: 'italic', command: 'toggleItalic' }] },
    ];
  },
})];
if (asyncScenario) {
  const { Mention, createMentionSuggestionRenderer } = await import('@domternal/extension-mention');
  const { Image } = await import('@domternal/extension-image');
  extensions.push(Mention.configure({ suggestion: {
    char: '@', name: 'person', debounce: 0,
    items: () => { asyncStatus.mentionCalls++; return new Promise(resolve => { pendingMention = resolve; }); },
    render: createMentionSuggestionRenderer(),
  } }), Image.configure({
    allowBase64: true,
    uploadHandler: file => {
      asyncStatus.uploadCalls++;
      asyncStatus.file = { name: file.name, size: file.size, type: file.type };
      return new Promise(resolve => { pendingUpload = resolve; });
    },
  }));
}

const counts = { created: 0, destroyed: 0, updates: 0, transactions: 0, parentRenders: 0 };
let editor;
let original;
let replace = () => { throw new Error('The wrapper has not mounted.'); };
let rerender = () => { throw new Error('The wrapper has not mounted.'); };
let unmount = () => { throw new Error('The wrapper has not mounted.'); };

function capture(instance) {
  editor = instance;
  counts.created++;
  editor.on('transaction', () => { counts.transactions++; });
  editor.on('update', () => { counts.updates++; });
}

const probe = window.__i18nOwnership = {
  get ready() { return Boolean(editor && !editor.isDestroyed); },
  get editor() { return editor; },
  asyncStatus: () => ({ ...asyncStatus }),
  finishMention: items => { if (!pendingMention) throw new Error('No mention request is pending.'); pendingMention(items); },
  finishUpload: () => { if (!pendingUpload) throw new Error('No upload is pending.'); pendingUpload(uploadedSource); },
  uploadedSource,
  replace: settings => replace(settings),
  replaceGerman: (overrides = {}) => replace({
    locale: 'de', messages: { ...deMessages, ...overrides }, searchAliases: deSearchAliases,
  }),
  rerender: () => rerender(),
  imperative: settings => editor.i18n.set(settings),
  unmount: () => unmount(),
  prepare() {
    original = { editor, view: editor.view, state: editor.state, html: editor.getHTML(), counts: { ...counts },
      undo: undoDepth(editor.state), redo: redoDepth(editor.state) };
  },
  snapshot() {
    return {
      ...counts,
      sameEditor: !original || editor === original.editor,
      sameView: !original || editor.view === original.view,
      sameState: !original || editor.state === original.state,
      sameHtml: !original || editor.getHTML() === original.html,
      transactionsSincePrepare: original ? counts.transactions - original.counts.transactions : 0,
      updatesSincePrepare: original ? counts.updates - original.counts.updates : 0,
      historyUnchanged: !original || (undoDepth(editor.state) === original.undo && redoDepth(editor.state) === original.redo),
      locale: editor.i18n.getSnapshot().locale,
      destroyedEditor: editor.isDestroyed,
      connected: editor.view.dom.isConnected,
    };
  },
};

if (framework === 'vanilla') {
  const { DomternalEditor, DomternalToolbar } = await import('@domternal/vanilla');
  const mount = document.querySelector('#fixture');
  mount.replaceChildren();
  const toolbarHost = document.createElement('div');
  const editorHost = document.createElement('div');
  mount.append(toolbarHost, editorHost);
  const wrapper = new DomternalEditor(editorHost, {
    extensions, content: '<p></p>', ...(imperative ? {} : { i18n: initial }), onCreate: capture,
    onDestroy: () => { counts.destroyed++; },
  });
  const toolbar = new DomternalToolbar(toolbarHost, { editor: wrapper.editor });
  replace = settings => wrapper.editor.i18n.set(settings ?? {});
  rerender = () => { counts.parentRenders++; mount.dataset.render = String(counts.parentRenders); };
  unmount = () => { toolbar.destroy(); wrapper.destroy(); mount.replaceChildren(); };
} else if (framework === 'react') {
  const { createElement: h, useState, useCallback } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { DomternalEditor, DomternalToolbar } = await import('@domternal/react');
  const root = createRoot(document.querySelector('#fixture'));
  function App() {
    const [settings, setSettings] = useState(imperative ? undefined : initial);
    const [revision, setRevision] = useState(0);
    const onCreate = useCallback(capture, []);
    replace = value => setSettings(value);
    rerender = () => setRevision(value => value + 1);
    counts.parentRenders++;
    return h('section', { 'data-parent-revision': revision },
      h(DomternalEditor, { extensions, content: '<p></p>', i18n: settings, onCreate,
        onDestroy: () => { counts.destroyed++; } }, h(DomternalToolbar)));
  }
  unmount = () => root.unmount();
  root.render(h(App));
} else if (framework === 'vue') {
  const { createApp, h, shallowRef } = await import('vue');
  const { DomternalEditor, DomternalToolbar } = await import('@domternal/vue');
  const app = createApp({
    setup() {
      const settings = shallowRef(imperative ? undefined : initial);
      const revision = shallowRef(0);
      replace = value => { settings.value = value; };
      rerender = () => { revision.value++; };
      return () => {
        counts.parentRenders++;
        return h('section', { 'data-parent-revision': revision.value }, [
          h(DomternalEditor, { extensions, content: '<p></p>', i18n: settings.value, onCreate: capture,
            onDestroy: () => { counts.destroyed++; } }, { default: () => h(DomternalToolbar) }),
        ]);
      };
    },
  });
  unmount = () => app.unmount();
  app.mount('#fixture');
} else if (framework === 'angular') {
  await import('@angular/compiler');
  const { Component, signal, provideZonelessChangeDetection } = await import('@angular/core');
  const { bootstrapApplication } = await import('@angular/platform-browser');
  const { DomternalEditorComponent, DomternalToolbarComponent } = await import('@domternal/angular');
  class App {
    extensions = extensions;
    settings = signal(imperative ? undefined : initial);
    current = signal(null);
    revision = signal(0);
    constructor() {
      replace = value => { this.settings.set(value); };
      rerender = () => { this.revision.update(value => value + 1); counts.parentRenders++; };
    }
    created(instance) { capture(instance); this.current.set(instance); }
    destroyed() { counts.destroyed++; }
  }
  Component({
    selector: 'i18n-test-app', standalone: true,
    imports: [DomternalEditorComponent, DomternalToolbarComponent],
    template: `<section [attr.data-parent-revision]="revision()">
      @if (current(); as editor) { <domternal-toolbar [editor]="editor" /> }
      <domternal-editor [extensions]="extensions" content="<p></p>" [i18n]="settings()"
        (editorCreated)="created($event)" (editorDestroyed)="destroyed()" />
    </section>`,
  })(App);
  const app = await bootstrapApplication(App, { providers: [provideZonelessChangeDetection()] });
  unmount = () => app.destroy();
} else {
  throw new Error(`Unknown framework: ${framework}`);
}

void probe;
