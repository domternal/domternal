import { Bold, Editor, Extension, SelectionDecoration } from '@domternal/core';
import { Plugin, PluginKey, TextSelection } from '@domternal/pm/state';
import { undoDepth } from '@domternal/pm/history';
import { CellSelection } from '@domternal/pm/tables';
import { BlockHandle, BlockContextMenu } from '@domternal/extension-block-controls';
import { Table, TableRow, TableCell, TableHeader } from '@domternal/extension-table';
import './style.css';

const params = new URLSearchParams(location.search);
const framework = params.get('framework') ?? 'react';
const mode = params.get('mode') ?? 'compound';
const immediate = params.get('immediate') === 'true';
const delayed = mode === 'compound' || mode === 'standalone';
const content = '<p>Alpha beta gamma.</p><p>Second paragraph.</p>'
  + '<table><tbody><tr><td><p>A1</p></td><td><p>A2</p></td></tr>'
  + '<tr><td><p>B1</p></td><td><p>B2</p></td></tr></tbody></table><p>After table.</p>';
const counts = { created: 0, views: 0, destroyedViews: 0, adopts: 0, submits: 0, renders: 0 };
const sentinelKey = new PluginKey('tutorialLifecycleSentinel');
const sentinel = Extension.create({
  name: 'tutorialLifecycleSentinel',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: sentinelKey,
      state: { init: () => ({}), apply: (_transaction, value) => value },
      view() {
        counts.views++;
        return { destroy() { counts.destroyedViews++; } };
      },
    })];
  },
});
const extensions = [Bold, SelectionDecoration, BlockHandle, BlockContextMenu,
  Table.configure({ resizable: false }), TableRow, TableCell, TableHeader, sentinel];
const editors = [];
const transactions = [];
let editor;
let original;

function capture(instance) {
  if (!(instance instanceof Editor) || typeof instance.adoptDom !== 'function') {
    throw new Error('The fixture must consume the same local Free Editor as its wrapper.');
  }
  editor = instance;
  editors.push(instance);
  counts.created++;
  instance.on('adopt', () => { counts.adopts++; });
  instance.on('transaction', ({ transaction }) => {
    transactions.push({ docChanged: transaction.docChanged, selectionSet: transaction.selectionSet,
      steps: transaction.steps.length });
  });
  probe.ready = true;
}

const probe = window.__tutorialLifecycle = {
  ready: false,
  prepare() {
    const transaction = editor.state.tr.insertText('Before adoption. ', 1);
    transaction.setSelection(TextSelection.create(transaction.doc, 3, 9));
    editor.view.dispatch(transaction);
    const historyPlugin = editor.state.plugins.find(plugin => plugin.key.startsWith('history$'));
    if (!historyPlugin) throw new Error('The fixture must have a history plugin.');
    original = { editor, view: editor.view, doc: editor.state.doc,
      sentinel: sentinelKey.getState(editor.state), historyPlugin,
      historyState: historyPlugin.getState(editor.state), selection: editor.state.selection.toJSON(),
      transactionIndex: transactions.length, created: counts.created, views: counts.views,
      destroyedViews: counts.destroyedViews };
    return probe.snapshot();
  },
  snapshot() {
    return {
      connected: editor.view.dom.isConnected,
      sameEditor: !original || editor === original.editor,
      sameView: !original || editor.view === original.view,
      sameDoc: !original || editor.state.doc === original.doc,
      sameSentinel: !original || sentinelKey.getState(editor.state) === original.sentinel,
      sameHistoryState: !original || original.historyPlugin.getState(editor.state) === original.historyState,
      history: undoDepth(editor.state),
      selection: editor.state.selection.toJSON(),
      transactions: original ? transactions.slice(original.transactionIndex) : [],
      ...counts,
      activeEditors: editors.filter(instance => !instance.isDestroyed).length,
    };
  },
  selectText(from = 1, to = 6) {
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)));
    editor.view.focus();
  },
  selectCells() {
    const positions = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'tableCell') positions.push(pos);
    });
    editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, positions[0], positions[1])));
    editor.view.focus();
  },
  selection() {
    return { cell: editor.state.selection instanceof CellSelection,
      from: editor.state.selection.from, to: editor.state.selection.to,
      canMerge: editor.can().mergeCells(), focused: editor.view.hasFocus() };
  },
  html: () => editor.getHTML(),
  undo: () => editor.commands.undo(),
  setEditable: value => editor.setEditable(value),
  stats: () => ({ ...counts, activeEditors: editors.filter(instance => !instance.isDestroyed).length }),
};

function command(name) {
  if (editor && !editor.isDestroyed && editor.isEditable) editor.chain().focus()[name]().run();
}

if (framework === 'react') {
  const { createElement: h, StrictMode, useState } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { Domternal, DomternalEditor, EditorContent, useCurrentEditor, useEditor, useEditorState } = await import('@domternal/react');

  function Controls({ instance }) {
    const selected = useEditorState(instance, ed => ({
      range: [ed.state.selection.from, ed.state.selection.to],
      nested: { bold: ed.isActive('bold'), editable: ed.isEditable },
      can: { merge: ed.can().mergeCells(), bold: ed.can().toggleBold() },
      json: ed.getJSON(),
    }));
    counts.renders++;
    return h('form', { onSubmit: event => { event.preventDefault(); counts.submits++; } },
      h('div', { className: 'custom-toolbar', 'data-dm-editor-ui': '' },
        h('button', { type: 'button', 'data-testid': 'toolbar-start' }, 'Toolbar start'),
        h('button', { type: 'button', 'data-testid': 'bold', disabled: !selected?.nested.editable,
          onMouseDown: event => event.preventDefault(), onClick: () => command('toggleBold') }, 'Bold'),
        h('button', { type: 'button', 'data-testid': 'merge', disabled: !selected?.can.merge || !selected?.nested.editable,
          onMouseDown: event => event.preventDefault(), onClick: () => command('mergeCells') }, 'Merge cells'),
        h('input', { 'aria-label': 'Toolbar note' }),
        h('select', { 'aria-label': 'Toolbar option', defaultValue: 'one' },
          h('option', { value: 'one' }, 'One'), h('option', { value: 'two' }, 'Two'))),
      h('output', { 'data-testid': 'selector' }, JSON.stringify(selected)));
  }

  function ContextControls() {
    return h(Controls, { instance: useCurrentEditor().editor });
  }

  function Children({ label }) {
    const [clicks, setClicks] = useState(0);
    const { editor: current } = useCurrentEditor();
    return h('section', { className: 'child-header', 'data-testid': 'children' },
      h('button', { type: 'button', onClick: () => setClicks(value => value + 1) }, `Child count ${clicks}`),
      h('span', { 'data-testid': 'child-label' }, `${label}: ${current ? 'provided' : 'loading'}`));
  }

  function Compound() {
    const [visible, setVisible] = useState(!delayed);
    const [generation, setGeneration] = useState(0);
    probe.show = () => setVisible(true);
    probe.hide = () => setVisible(false);
    probe.remount = () => setGeneration(value => value + 1);
    return h(Domternal, { extensions, content, immediatelyRender: immediate, onCreate: capture },
      visible ? h(Domternal.Content, { key: generation }) : null,
      h(ContextControls));
  }

  function Hook() {
    const [visible, setVisible] = useState(!delayed);
    const [generation, setGeneration] = useState(0);
    const { editor: current, editorRef } = useEditor({ extensions, content, immediatelyRender: immediate, onCreate: capture });
    probe.show = () => setVisible(true);
    probe.hide = () => setVisible(false);
    probe.remount = () => setGeneration(value => value + 1);
    return h('div', null,
      h('div', { className: 'dm-editor' }, mode === 'standalone'
        ? (visible ? h(EditorContent, { editor: current, key: generation }) : null)
        : h('div', { ref: editorRef })),
      h(Controls, { instance: current }));
  }

  function AllInOne() {
    const [label, setLabel] = useState('Initial');
    const [showToolbar, setShowToolbar] = useState(true);
    probe.rerenderChildren = () => { setLabel('Updated'); setShowToolbar(false); };
    return h(DomternalEditor, { extensions, content, onCreate: capture },
      h(Children, { label }), showToolbar ? h(Domternal.Toolbar) : null,
      h('footer', { className: 'child-footer', 'data-testid': 'footer' }, 'Application footer'));
  }

  const root = createRoot(document.querySelector('#app'));
  probe.destroy = () => root.unmount();
  const Component = mode === 'children' ? AllInOne : ['direct', 'standalone'].includes(mode) ? Hook : Compound;
  root.render(h(StrictMode, null, h(Component)));
} else {
  const { createApp, defineComponent, h, ref } = await import('vue');
  const { Domternal, EditorContent, useCurrentEditor, useEditor, useEditorState } = await import('@domternal/vue');
  const Controls = defineComponent({
    props: ['instance'],
    setup(props) {
      const current = props.instance ?? useCurrentEditor().editor;
      const selected = useEditorState(current, ed => ({
        range: [ed.state.selection.from, ed.state.selection.to],
        nested: { bold: ed.isActive('bold'), editable: ed.isEditable },
        can: { merge: ed.can().mergeCells(), bold: ed.can().toggleBold() },
        json: ed.getJSON(),
      }));
      return () => {
        counts.renders++;
        return h('form', { onSubmit: event => { event.preventDefault(); counts.submits++; } }, [
          h('div', { class: 'custom-toolbar', 'data-dm-editor-ui': '' }, [
            h('button', { type: 'button', 'data-testid': 'toolbar-start' }, 'Toolbar start'),
            h('button', { type: 'button', 'data-testid': 'bold', disabled: !selected.value?.nested.editable,
              onMousedown: event => event.preventDefault(), onClick: () => command('toggleBold') }, 'Bold'),
            h('button', { type: 'button', 'data-testid': 'merge', disabled: !selected.value?.can.merge || !selected.value?.nested.editable,
              onMousedown: event => event.preventDefault(), onClick: () => command('mergeCells') }, 'Merge cells'),
            h('input', { 'aria-label': 'Toolbar note' }),
            h('select', { 'aria-label': 'Toolbar option' }, [h('option', { value: 'one' }, 'One'), h('option', { value: 'two' }, 'Two')]),
          ]),
          h('output', { 'data-testid': 'selector' }, JSON.stringify(selected.value)),
        ]);
      };
    },
  });
  const App = defineComponent({
    setup() {
      const visible = ref(!delayed);
      const generation = ref(0);
      probe.show = () => { visible.value = true; };
      probe.hide = () => { visible.value = false; };
      probe.remount = () => { generation.value++; };
      if (mode === 'direct' || mode === 'standalone') {
        const { editor: current, editorRef } = useEditor({ extensions, content, immediatelyRender: immediate, onCreate: capture });
        return () => h('div', [
          h('div', { class: 'dm-editor' }, mode === 'standalone'
            ? (visible.value ? h(EditorContent, { editor: current.value, key: generation.value }) : null)
            : h('div', { ref: editorRef })),
          h(Controls, { instance: current }),
        ]);
      }
      return () => h(Domternal, { extensions, content, immediatelyRender: immediate, onCreate: capture }, {
        default: () => [visible.value ? h(Domternal.Content, { key: generation.value }) : null, h(Controls)],
      });
    },
  });
  const app = createApp(App);
  probe.destroy = () => app.unmount();
  app.mount('#app');
}
