// Behavior probe shared by the ESM and CommonJS runs of tests/subpath-reexports.
// `load` is dynamic import in the ESM wrapper and require in the CommonJS one, so
// both resolve the package's real exports map from the temporary consumer.
'use strict';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'DocumentFragment', 'Text',
  'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'KeyboardEvent',
  'MouseEvent', 'DOMParser', 'getSelection', 'Range'];

/** Installs a jsdom window as globals before Core loads, the way a test runner would. */
function installDom() {
  const { JSDOM } = require('jsdom');
  const { window } = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
  for (const key of DOM_GLOBALS) {
    const value = key === 'window' ? window : window[key];
    // Lower case globals are window methods and need their receiver.
    const bound = typeof value === 'function' && !/^[A-Z]/.test(key) ? value.bind(window) : value;
    Object.defineProperty(globalThis, key, { value: bound, configurable: true, writable: true });
  }
  return window;
}

function pasteEvent(window, html) {
  const event = new window.Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { getData: (type) => (type === 'text/html' ? html : type === 'text/plain' ? 'Probe' : '') },
  });
  return event;
}

function runtimeKeys(namespace) {
  return Object.keys(namespace).filter((key) => key !== 'default' && key !== '__esModule').sort();
}

function attempt(run) {
  try { return { value: run() }; } catch (error) { return { error }; }
}

/** Runs every check and returns the result the gate reads. */
async function probe(kind, load, packageName, subpathSpecifier) {
  const checks = [];
  const check = (name, ok, detail = '') => checks.push({ name, ok: Boolean(ok), detail: String(detail) });
  const window = installDom();
  const core = await load(packageName);
  const subpath = await load(subpathSpecifier);
  const subpathKeys = runtimeKeys(subpath);

  const mismatched = subpathKeys.filter((name) => subpath[name] !== core[name]);
  check('every subpath binding is the main bundle binding', subpathKeys.length > 0 && mismatched.length === 0,
    mismatched.join(', ') || 'no bindings');

  const { Editor, Document, Paragraph, Text } = core;
  const editor = new Editor({
    element: document.body.appendChild(document.createElement('div')),
    content: '<p>Keep</p>',
    extensions: [Document, Paragraph, Text],
  });
  const view = editor.view;
  try {
    let gateCalls = 0;
    const first = attempt(() => subpath.registerClipboardHTMLPreparation(view, () => { gateCalls += 1; return undefined; }));
    view.pasteHTML('<p>Probe</p>', pasteEvent(window, '<p>Probe</p>'));
    check('Editor paste reaches a preparation registered through the subpath', gateCalls === 1, `gate calls ${String(gateCalls)}`);

    const second = attempt(() => subpath.registerClipboardHTMLPreparation(view, () => undefined));
    check('a second preparation on the view is refused', second.error instanceof Error,
      second.error instanceof Error ? second.error.message : 'the second registration was accepted');
    if (typeof second.value === 'function') second.value();
    if (typeof first.value === 'function') first.value();
    const again = attempt(() => subpath.registerClipboardHTMLPreparation(view, () => undefined));
    check('registration works again after disposal', typeof again.value === 'function', again.error?.message ?? 'no disposer');
    if (typeof again.value === 'function') again.value();

    const disposeCopy = subpath.registerClipboardCopyAnnotation(view, (fragment) => {
      fragment.firstElementChild?.setAttribute('data-subpath-probe', kind);
    });
    editor.commands.selectAll();
    const html = view.serializeForClipboard(editor.state.selection.content()).dom.innerHTML;
    check('Editor copy serialization runs an annotator registered through the subpath',
      html.includes(`data-subpath-probe="${kind}"`), html);
    disposeCopy();
  } finally {
    editor.destroy();
  }
  return { kind, mainKeys: runtimeKeys(core), subpathKeys, checks };
}

module.exports = { probe, installDom, pasteEvent, RESULT_PREFIX: 'SUBPATH_REEXPORT_RESULT ' };
