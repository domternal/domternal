/**
 * The link security fixture: the public core build in a plain page, so a
 * browser suite can judge addresses with the URL policy, compare them with
 * what the browser itself reads, and click links the editor renders.
 */
import { Editor, StarterKit, checkUrl, isValidUrl, generateHTML } from '@domternal/core';
import { Image } from '@domternal/extension-image';
import { Table, TableRow, TableCell, TableHeader } from '@domternal/extension-table';

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

function extensions({ link = {}, linkPopover = false } = {}) {
  return [
    StarterKit.configure({ link, linkPopover }),
    Image.configure({ inline: true }),
    Table, TableRow, TableCell, TableHeader,
  ];
}

/** Creates the editor under test, replacing the previous one. */
function create({ content, editable = true, link, linkPopover } = {}) {
  editor?.destroy();
  opens.length = 0;
  const host = document.getElementById('fixture');
  host.replaceChildren();
  const element = document.createElement('div');
  host.appendChild(element);
  editor = new Editor({ element, extensions: extensions({ link, linkPopover }), content, editable });
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
  getJSON: () => editor?.getJSON() ?? null,
  generateHTML: (content, options) => generateHTML(content, extensions(options)),
};
