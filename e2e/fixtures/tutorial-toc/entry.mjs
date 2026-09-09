import { Editor, Document, Text, Paragraph, Heading, UniqueID, History } from '@domternal/core';
import { TableOfContents, TableOfContentsBlock } from '@domternal/extension-toc';
import { CodeBlockLowlight } from '@domternal/extension-code-block-lowlight';
import { createLowlight, common } from 'lowlight';

const params = new URLSearchParams(location.search);
const mode = params.get('mode') ?? 'observer';
document.body.dataset.mode = mode;
const scroller = document.querySelector('#scroller');
const host = document.querySelector('#editor');
const status = document.querySelector('#status');
const activeOffset = 18;
let updates = 0;
let incoherentUpdates = 0;
let transactions = 0;
let initialDoc;
let initialState;
let editor;

function report(storage) {
  updates += 1;
  const active = storage.content.filter((entry) => entry.isActive);
  if (active.length !== (storage.activeId === null ? 0 : 1)
    || active.some((entry) => entry.id !== storage.activeId)
    || storage.content.some((entry) => entry.domNode && !entry.domNode.isConnected)) {
    incoherentUpdates += 1;
  }
  status.textContent = `Active heading: ${storage.activeId ?? 'none'}`;
}

// This is the documented picker recipe. A supported alias need not appear
// in listLanguages(), and an unavailable saved value must remain selectable.
function getLanguageOptions(lowlight, currentLanguage) {
  const names = lowlight.listLanguages().sort();
  const options = [
    { value: '', label: 'No explicit language' },
    ...names.map((name) => ({ value: name, label: name })),
  ];
  if (currentLanguage && !names.includes(currentLanguage)) {
    const state = lowlight.registered(currentLanguage) ? 'alias' : 'unavailable';
    options.push({ value: currentLanguage, label: `${currentLanguage} (${state})` });
  }
  return options;
}

let lowlight;
if (mode === 'picker') {
  lowlight = createLowlight(common);
  lowlight.registerAlias({ typescript: ['project-ts'] });
  const language = params.get('language') ?? 'ts';
  editor = new Editor({
    element: host,
    extensions: [Document, Text, Paragraph, History, CodeBlockLowlight.configure({ lowlight, autoDetect: false })],
    content: {
      type: 'doc',
      content: [{ type: 'codeBlock', attrs: { language: language || null },
        content: [{ type: 'text', text: 'const count: number = 1;' }] }],
    },
  });
  const select = document.querySelector('#language');
  document.querySelector('#language-label').hidden = false;
  const renderPicker = () => {
    const current = editor.state.doc.firstChild.attrs.language;
    select.replaceChildren(...getLanguageOptions(lowlight, current).map(({ value, label }) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      return option;
    }));
    select.value = current ?? '';
    status.textContent = `Saved language: ${current ?? 'none'}`;
  };
  select.addEventListener('change', () => {
    editor.commands.updateAttributes('codeBlock', { language: select.value || null });
  });
  editor.on('update', renderPicker);
  renderPicker();
} else {
  editor = new Editor({
    element: host,
    extensions: [Document, Text, Paragraph, Heading, History,
      UniqueID.configure({ types: ['heading'] }),
      TableOfContents.configure({ activeScrollParent: scroller, activeOffset,
        activeRootMargin: '0px 0px -60% 0px', clickOverrideMs: 50, onUpdate: report }),
      ...(mode === 'blocks' ? [TableOfContentsBlock] : []),
    ],
    content: '<h2 id="first">First section</h2><p>First section body.</p>'
      + '<h2 id="second">Second section</h2><p>Second section body.</p>'
      + '<h2 id="third">Third section</h2><p>Trailing content permits scrolling to the final heading.</p>',
  });
}

function snapshot() {
  const storage = editor.storage.toc;
  return {
    sourceIdentity: editor.constructor === Editor,
    activeId: storage?.activeId ?? null,
    entries: storage?.content.map((entry) => ({
      id: entry.id, active: entry.isActive, passed: entry.isScrolledOver,
      connected: entry.domNode?.isConnected ?? false,
      owned: entry.domNode !== null && editor.view.dom.contains(entry.domNode),
    })) ?? [],
    subscribers: storage?.subscribers.size ?? 0,
    updates, incoherentUpdates, transactions,
    sameDoc: editor.state.doc === initialDoc,
    sameState: editor.state === initialState,
    scrollTop: scroller.scrollTop,
    rootTop: scroller.getBoundingClientRect().top,
    windowScroll: window.scrollY,
    html: editor.getHTML(),
    json: editor.getJSON(),
    language: mode === 'picker' ? editor.state.doc.firstChild.attrs.language : null,
    canonicalLanguages: mode === 'picker' ? editor.storage.codeBlock.listLanguages() : [],
    wrongStorageKeyPresent: Object.hasOwn(editor.storage, 'codeBlockLowlight'),
  };
}

window.__TUTORIAL_TOC__ = {
  ready: false,
  snapshot,
  scrollPast(id) {
    const entry = editor.storage.toc.content.find((candidate) => candidate.id === id);
    const top = entry.domNode.getBoundingClientRect().top;
    scroller.scrollTop += top - scroller.getBoundingClientRect().top - scroller.clientTop - activeOffset + 2;
  },
  insertBlock() {
    let position;
    editor.state.doc.descendants((node, pos) => {
      if (position === undefined && node.type.name === 'paragraph') position = pos + 1;
    });
    return editor.chain().focus(position).insertContent({ type: 'tableOfContents' }).run();
  },
  reloadJSON() {
    editor.setContent(editor.getJSON());
  },
  chooseSavedLanguage(language) {
    editor.commands.updateAttributes('codeBlock', { language });
  },
  navigate(id) { return editor.commands.scrollToHeading(id); },
  destroy() { editor.destroy(); },
  counts() { return { updates, incoherentUpdates, transactions }; },
};

// Record the baseline after the deferred UniqueID and TOC initialization.
await new Promise((resolve) => setTimeout(() => setTimeout(resolve, 0), 0));
initialDoc = editor.state.doc;
initialState = editor.state;
editor.on('transaction', () => { transactions += 1; });
window.__TUTORIAL_TOC__.ready = true;
