// One DOM for both client versions in this Node process: jsdom globals, as the editors expect them.
import { JSDOM } from 'jsdom';

// Two versions in one process are the point here, so the warnings about a second copy of Yjs,
// ProseMirror or the core are expected. Every other message still reaches the log.
const EXPECTED = ['Two different copies of ', 'Yjs was already imported'];
for (const method of ['warn', 'error']) {
  const original = console[method].bind(console);
  console[method] = (...args) => {
    if (typeof args[0] === 'string' && EXPECTED.some(start => args[0].startsWith(start))) return;
    original(...args);
  };
}

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
const { window } = dom;
for (const key of Object.getOwnPropertyNames(window)) {
  if (key in globalThis) continue;
  try { globalThis[key] = window[key]; } catch { /* a read-only global keeps Node's own */ }
}
globalThis.window = window;
globalThis.document = window.document;
try { globalThis.navigator = window.navigator; } catch {
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
}
globalThis.requestAnimationFrame ??= callback => setTimeout(() => { callback(Date.now()); }, 0);
globalThis.cancelAnimationFrame ??= id => { clearTimeout(id); };
window.document.getSelection ??= () => null;
