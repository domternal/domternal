import {
  Bold, Italic, Underline, Strike, TextStyle, TextColor, Highlight, FontFamily,
  FontSize, TextAlign, LineHeight, Heading, BulletList, OrderedList, ListItem, Blockquote,
} from '@domternal/core';
import { DomternalEditor } from '@domternal/vanilla';
import { Table, TableRow, TableCell, TableHeader } from '@domternal/extension-table';
import { SmartPaste } from '@domternal/extension-block-controls';
import { PasteCleanup } from '@domternal/extension-paste-cleanup';
import { normalizePasteHTML } from '@domternal/extension-paste-cleanup/html';
import { undoDepth, redoDepth } from '@domternal/pm/history';
import { fixtureById, validateDocument } from './fixtures.mjs';
import { blockPlan } from './sampler.mjs';

const extensions = [Bold, Italic, Underline, Strike, TextStyle, TextColor, Highlight,
  FontFamily, FontSize, TextAlign, LineHeight, Heading, BulletList, OrderedList, ListItem,
  Blockquote, Table, TableRow, TableCell, TableHeader, SmartPaste];
const host = document.querySelector('#editor');
let configuration;
let cancelled = false;

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}

function diagnostics(result) {
  const counts = {};
  for (const entry of result?.diagnostics ?? []) counts[entry.code] = (counts[entry.code] ?? 0) + 1;
  return { codes: counts, truncated: result?.diagnosticsTruncated ?? false };
}

function checkActive() {
  if (cancelled) throw new Error('Measurement cancelled');
  if (document.visibilityState !== 'visible') throw new Error('Benchmark page is not visible');
}

async function operation(route) {
  checkActive();
  // Every operation gets a separate frame opportunity, outside both clocks.
  await new Promise(resolve => requestAnimationFrame(resolve));
  checkActive();
  const { fixture, formatting, normalizedHTML } = configuration;
  let normalizationCount = 0;
  let terminalCount = 0;
  let normalized;
  let terminal;
  let wrapper;
  try {
    wrapper = new DomternalEditor(host, {
      content: '<p></p>', extensions: [...extensions, ...(route === 'on-raw' ? [PasteCleanup.configure({
        formatting, feedback: 'default',
        onResult(result) { normalizationCount++; normalized = result; },
        onPasteResult(result) { terminalCount++; terminal = result; },
      })] : [])],
    });
    const editor = wrapper.editor;
    editor.view.focus();
    if (editor.state.doc.textContent !== '' || editor.state.selection.from !== 1 || editor.state.selection.to !== 1
      || undoDepth(editor.state) !== 0 || redoDepth(editor.state) !== 0) throw new Error('Initial editor state changed');
    const data = new DataTransfer();
    data.setData('text/html', route === 'off-normalized' ? normalizedHTML : fixture.html);
    data.setData('text/plain', fixture.tokens.join('\n'));
    const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
    if (event.clipboardData !== data) Object.defineProperty(event, 'clipboardData', { value: data });
    if (event.isTrusted) throw new Error('This harness requires explicitly synthetic transport');

    const start = performance.now();
    editor.view.dom.dispatchEvent(event);
    const syncMs = performance.now() - start;
    // This fixed continuation is validated below, never extended by polling.
    // The baseline uses the same continuation. Neither endpoint includes paint.
    await Promise.resolve();
    const settledMs = performance.now() - start;

    if (!event.defaultPrevented) throw new Error('Paste was not handled');
    if (route === 'on-raw') {
      if (normalizationCount !== 1 || terminalCount !== 1 || normalized?.status !== 'cleaned' || terminal?.status !== 'applied') throw new Error('Cleanup lifecycle changed');
      if (normalized.diagnostics.some(entry => entry.code.startsWith('destination-'))) throw new Error('The benchmark schema does not support its requested features');
      const notice = host.querySelector('.dm-paste-feedback');
      const visible = terminal.diagnosticsTruncated || terminal.diagnostics.some(entry => entry.severity !== 'info');
      if (!notice || notice.dataset.status !== 'applied' || notice.hidden === visible
        || (visible && (!notice.querySelector('[role="status"]')?.textContent || getComputedStyle(notice).display === 'none')))
        throw new Error('Default feedback did not settle at the fixed continuation');
    } else if (normalizationCount !== 0 || terminalCount !== 0) throw new Error('Cleanup ran in the disabled baseline');
    if (undoDepth(editor.state) !== 1 || redoDepth(editor.state) !== 0) throw new Error('Paste history changed');
    const json = editor.getJSON();
    const semantic = validateDocument(json, fixture, formatting, route);
    const documentSha256 = await sha256(JSON.stringify(json));
    return { route, syncMs, settledMs, normalizationCount, terminalCount, status: terminal?.status ?? 'baseline-applied',
      feedbackVisible: route === 'on-raw' && !host.querySelector('.dm-paste-feedback').hidden,
      documentSha256, semantic, diagnostics: diagnostics(normalized) };
  } finally {
    wrapper?.destroy();
    host.replaceChildren();
  }
}

window.__pastePerformance = Object.freeze({
  ready: true,
  async prepare(id, formatting) {
    if (!['preserve', 'adapt'].includes(formatting)) throw new Error('Invalid formatting policy');
    if (!Array.from(document.styleSheets).some(sheet => sheet.href?.endsWith('/domternal-theme.css') && sheet.cssRules.length > 0)) throw new Error('Public theme stylesheet did not load');
    const fixture = fixtureById(id);
    cancelled = false;
    const start = performance.now();
    const normalized = normalizePasteHTML(fixture.html, { formatting });
    const preparationNormalizationMs = performance.now() - start;
    if (normalized.status !== 'cleaned') throw new Error('Fixture normalization was rejected');
    configuration = { fixture, formatting, normalizedHTML: normalized.html };
    return { fixture: id, formatting, normalizedSha256: await sha256(normalized.html),
      normalizedUtf8Bytes: new TextEncoder().encode(normalized.html).length,
      preparationNormalizationMs, diagnostics: diagnostics(normalized),
      extensionNames: extensions.map(extension => extension.name),
      schemaDefaults: ['doc', 'paragraph', 'text', 'baseKeymap', 'history'],
      environment: { userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency,
        deviceMemory: navigator.deviceMemory ?? null, visibilityState: document.visibilityState,
        viewport: { width: innerWidth, height: innerHeight }, devicePixelRatio, timeOrigin: performance.timeOrigin } };
  },
  async block(index) {
    checkActive();
    if (!configuration) throw new Error('The benchmark was not prepared');
    const groups = [];
    for (const planned of blockPlan(index)) {
      const operations = [];
      for (const route of planned.routes) operations.push(await operation(route));
      if (planned.comparison === 'normalized' && operations.some(value => value.documentSha256 !== operations[0].documentSha256)) throw new Error('Normalized control does not represent the same document');
      groups.push({ comparison: planned.comparison, operations });
    }
    const start = performance.now();
    const normalized = normalizePasteHTML(configuration.fixture.html, { formatting: configuration.formatting });
    const ms = performance.now() - start;
    if (normalized.status !== 'cleaned' || normalized.html !== configuration.normalizedHTML) throw new Error('Standalone normalization changed');
    checkActive();
    return { index, groups, normalization: { ms, diagnostics: diagnostics(normalized) } };
  },
  cancel() { cancelled = true; },
});
