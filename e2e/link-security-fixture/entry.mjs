/**
 * The link security fixture: the public core build in a plain page, so a
 * browser suite can judge addresses with the URL policy, compare them with
 * what the browser itself reads, and click links the editor renders.
 */
import {
  Editor, Extension, StarterKit, checkUrl, isValidUrl, generateHTML, inlineStyles,
  TextStyle, TextColor, Highlight, FontFamily, FontSize, TextAlign, LineHeight,
} from '@domternal/core';
import { Image } from '@domternal/extension-image';
import { Table, TableRow, TableCell, TableHeader } from '@domternal/extension-table';
import { TextSelection } from '@domternal/pm/state';

/** What the browser reads from an href attribute: the resolved address and its scheme. */
function resolve(value) {
  const anchor = document.createElement('a');
  anchor.setAttribute('href', value);
  let parsed = null;
  try {
    parsed = new URL(value, document.baseURI);
  } catch { /* An address the parser rejects resolves to nothing. */ }
  return {
    href: anchor.href,
    protocol: anchor.protocol,
    origin: parsed?.origin ?? null,
    username: parsed?.username ?? '',
    password: parsed?.password ?? '',
    parsed: parsed?.href ?? null,
  };
}

// Every call the editor makes to window.open, before the browser acts on it.
const opens = [];
const nativeOpen = window.open.bind(window);
window.open = (...args) => {
  opens.push(args.map(String));
  return nativeOpen(...args);
};

let editor = null;

/** Heading ids, as a table of contents or UniqueID renders them, for fragment links to reach. */
const HeadingIds = Extension.create({
  name: 'headingIds',
  addGlobalAttributes: () => [{
    types: ['heading'],
    attributes: {
      id: { default: null, parseHTML: element => element.id || null, renderHTML: attributes => (attributes.id ? { id: attributes.id } : null) },
    },
  }],
});

function extensions({ link = {}, linkPopover = false, image = {} } = {}) {
  return [
    StarterKit.configure({ link, linkPopover }),
    HeadingIds,
    TextStyle, TextColor, Highlight, FontFamily, FontSize, TextAlign, LineHeight,
    Image.configure({ inline: true, ...image }),
    Table, TableRow, TableCell, TableHeader,
  ];
}

/**
 * Builds a node without validation or content normalization, as
 * y-prosemirror binds what a collaborator wrote, so a refused href reaches
 * the sinks. Loading the same JSON through the editor removes it.
 */
function uncheckedNode(schema, json) {
  const marks = (json.marks ?? []).map(mark => schema.marks[mark.type].create(mark.attrs));
  if (json.type === 'text') return schema.text(json.text ?? '', marks);
  return schema.nodes[json.type].create(json.attrs, (json.content ?? []).map(child => uncheckedNode(schema, child)), marks);
}

const diagnostics = [];

/**
 * Creates the editor under test, replacing the previous one. JSON content is
 * stored as given, unless `load` asks for the editor's own JSON loading.
 */
function create({ content, editable = true, link, linkPopover, image, load = false } = {}) {
  editor?.destroy();
  opens.length = 0;
  diagnostics.length = 0;
  const host = document.getElementById('fixture');
  host.replaceChildren();
  const element = document.createElement('div');
  host.appendChild(element);
  const stored = !load && content !== null && typeof content === 'object';
  editor = new Editor({
    element,
    extensions: extensions({ link, linkPopover, image }),
    content: stored ? null : content,
    editable,
    onContentDiagnostic: ({ diagnostics: reported }) => diagnostics.push(...reported),
  });
  if (stored) {
    const { tr } = editor.state;
    editor.view.dispatch(tr.replaceWith(0, tr.doc.content.size, uncheckedNode(editor.schema, content).content));
  }
  return editor.getHTML();
}

window.__linkSecurity = {
  ready: true,
  checkUrl,
  isValidUrl,
  resolve,
  create,
  opens: () => opens.map(call => [...call]),
  editor: () => editor,
  getHTML: () => editor?.getHTML() ?? '',
  getStyledHTML: () => editor?.getHTML({ styled: true }) ?? '',
  inlineStyles: (html) => inlineStyles(html),
  getJSON: () => editor?.getJSON() ?? null,
  diagnostics: () => diagnostics.map(diagnostic => ({ ...diagnostic })),
  /** Selects a range and focuses the editor, as a user selection would. */
  select: (from, to = from) => {
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)));
    editor.view.focus();
  },
  linkHrefs: () => {
    const found = [];
    editor?.state.doc.descendants(node => {
      for (const mark of node.marks) if (mark.type.name === 'link') found.push(mark.attrs.href);
    });
    return found;
  },
  generateHTML: (content, options) => generateHTML(content, extensions(options)),
  /** Inserts HTML into the page outside the editor, as an application shows exported content. */
  show: (html) => {
    const sink = document.getElementById('sink') ?? document.body.appendChild(Object.assign(document.createElement('div'), { id: 'sink' }));
    sink.innerHTML = html;
  },
  /** Elements of the page that cover it the way an injected overlay would. */
  fixedElements: () => Array.from(document.querySelectorAll('body *'))
    .filter(element => getComputedStyle(element).position === 'fixed')
    .map(element => element.tagName.toLowerCase()),
};
