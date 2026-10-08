import {
  Bold, Italic, Underline, Strike, TextStyle, TextColor, Highlight, FontFamily,
  FontSize, TextAlign, LineHeight, Heading, BulletList, OrderedList, ListItem, Blockquote,
} from '@domternal/core';
import { DomternalEditor } from '@domternal/vanilla';
import { Table, TableRow, TableCell, TableHeader } from '@domternal/extension-table';
import { SmartPaste } from '@domternal/extension-block-controls';
import { Image } from '@domternal/extension-image';
import { PasteCleanup } from '@domternal/extension-paste-cleanup';
import { normalizePasteHTML } from '@domternal/extension-paste-cleanup/html';
import { undoDepth, redoDepth } from '@domternal/pm/history';
import { fixtureById, validateDocument } from './fixtures.mjs';
import { blockPlan } from './sampler.mjs';
import { generateLarge } from './large.mjs';

const extensions = [Bold, Italic, Underline, Strike, TextStyle, TextColor, Highlight,
  FontFamily, FontSize, TextAlign, LineHeight, Heading, BulletList, OrderedList, ListItem,
  Blockquote, Table, TableRow, TableCell, TableHeader, SmartPaste];
// The imageAssets variant adds the destination its embedded mode prepares local images for to
// both routes, so the paired difference stays the cost of Cleanup with its asset coordinator.
const imageExtensions = [...extensions, Image.configure({ allowBase64: true })];
const host = document.querySelector('#editor');
let configuration;
let large;
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

/**
 * The default notice contract: a rejection, any warning or error, or omitted findings when no
 * informational one was retained. Severity-ranked retention drops infos first, so a retained
 * info proves that only informational findings, which the notice never lists, were omitted.
 */
function noticeExpected(result) {
  const retainedInfo = result.diagnostics.some(entry => entry.severity === 'info');
  return result.status === 'rejected' || result.diagnostics.some(entry => entry.severity !== 'info')
    || (result.diagnosticsTruncated && !retainedInfo);
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
  const { fixture, formatting, normalizedHTML, imageAssets } = configuration;
  let normalizationCount = 0;
  let terminalCount = 0;
  let normalized;
  let terminal;
  let wrapper;
  try {
    wrapper = new DomternalEditor(host, {
      content: '<p></p>', extensions: [...(imageAssets ? imageExtensions : extensions), ...(route === 'on-raw' ? [PasteCleanup.configure({
        formatting, feedback: 'default', ...(imageAssets && { imageAssets: { mode: 'embedded' } }),
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
      const visible = noticeExpected(terminal);
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

const TOKEN = /Q[0-9]{6}x/g;

/** Every authored token once and in order, the authored counts, and a bounded document walk. */
function validateLarge(document, fixture) {
  const counts = {};
  const texts = [];
  const pending = [document];
  let nodes = 0;
  while (pending.length) {
    const node = pending.pop();
    if (!node || typeof node !== 'object' || ++nodes > 1_000_000) throw new Error('Invalid document envelope');
    counts[node.type] = (counts[node.type] ?? 0) + 1;
    if (node.type === 'text') texts.push(node.text);
    for (let index = (node.content?.length ?? 0) - 1; index >= 0; index--) pending.push(node.content[index]);
  }
  const found = texts.join('').match(TOKEN) ?? [];
  if (found.length !== fixture.tokens.length || found.some((value, index) => value !== fixture.tokens[index])) {
    throw new Error('Missing, duplicated or reordered authored text');
  }
  for (const [name, count] of Object.entries(fixture.counts)) if (counts[name] !== count) throw new Error(`Unexpected ${name} count`);
  return Object.freeze({ nodes, tokensVerified: found.length, counts: Object.freeze(counts) });
}

/** One synthetic paste of a large fixture through Cleanup, timed like the paired protocol's enabled route. */
async function largeOperation() {
  checkActive();
  await new Promise(resolve => requestAnimationFrame(resolve));
  checkActive();
  const { fixture, formatting, expected, rtfUnits } = large;
  let normalizationCount = 0;
  let terminalCount = 0;
  let normalized;
  let terminal;
  let wrapper;
  try {
    wrapper = new DomternalEditor(host, {
      content: '<p></p>', extensions: [...extensions, PasteCleanup.configure({
        formatting, feedback: 'default',
        onResult(result) { normalizationCount++; normalized = result; },
        onPasteResult(result) { terminalCount++; terminal = result; },
      })],
    });
    const editor = wrapper.editor;
    editor.view.focus();
    if (editor.state.doc.textContent !== '' || undoDepth(editor.state) !== 0) throw new Error('Initial editor state changed');
    const data = new DataTransfer();
    data.setData('text/html', fixture.html);
    data.setData('text/plain', fixture.plain);
    // A synthetic RTF flavor of a stated length demonstrates the flavor rule, never real RTF content.
    if (rtfUnits !== undefined) data.setData('text/rtf', `{\\rtf1 ${'x'.repeat(rtfUnits - 8)}}`);
    const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
    if (event.clipboardData !== data) Object.defineProperty(event, 'clipboardData', { value: data });
    if (event.isTrusted) throw new Error('This harness requires explicitly synthetic transport');

    const start = performance.now();
    editor.view.dom.dispatchEvent(event);
    const syncMs = performance.now() - start;
    await Promise.resolve();
    const settledMs = performance.now() - start;

    if (!event.defaultPrevented) throw new Error('Paste was not handled');
    if (normalizationCount !== 1 || terminalCount !== 1) throw new Error('Cleanup lifecycle changed');
    const notice = host.querySelector('.dm-paste-feedback');
    const visible = noticeExpected(terminal);
    if (!notice || notice.dataset.status !== terminal.status || notice.hidden === visible) throw new Error('Default feedback did not settle at the fixed continuation');
    let semantic;
    if (expected.status === 'cleaned') {
      if (normalized.status !== 'cleaned' || terminal.status !== 'applied') throw new Error('Large paste was not applied');
      if (undoDepth(editor.state) !== 1 || redoDepth(editor.state) !== 0) throw new Error('Paste history changed');
      semantic = validateLarge(editor.getJSON(), fixture);
    } else {
      const errors = normalized.diagnostics.filter(entry => entry.severity === 'error');
      if (normalized.status !== 'rejected' || terminal.status !== 'rejected' || errors.length !== 1 || errors[0].code !== expected.code) {
        throw new Error('Large paste was not rejected with the expected reason');
      }
      if (editor.state.doc.textContent !== '' || editor.state.doc.childCount !== 1 || undoDepth(editor.state) !== 0) throw new Error('A rejected paste changed the document');
      semantic = Object.freeze({ unchanged: true });
    }
    const severities = { info: 0, warning: 0, error: 0 };
    for (const entry of normalized.diagnostics) severities[entry.severity]++;
    return { syncMs, settledMs, status: terminal.status, noticeVisible: !notice.hidden, severities,
      diagnostics: diagnostics(normalized), semantic };
  } finally {
    wrapper?.destroy();
    host.replaceChildren();
  }
}

window.__pastePerformance = Object.freeze({
  ready: true,
  async prepare(id, formatting, imageAssets = false) {
    if (!['preserve', 'adapt'].includes(formatting)) throw new Error('Invalid formatting policy');
    if (typeof imageAssets !== 'boolean') throw new Error('Invalid imageAssets variant');
    if (!Array.from(document.styleSheets).some(sheet => sheet.href?.endsWith('/domternal-theme.css') && sheet.cssRules.length > 0)) throw new Error('Public theme stylesheet did not load');
    const fixture = fixtureById(id);
    cancelled = false;
    const start = performance.now();
    const normalized = normalizePasteHTML(fixture.html, { formatting });
    const preparationNormalizationMs = performance.now() - start;
    if (normalized.status !== 'cleaned') throw new Error('Fixture normalization was rejected');
    configuration = { fixture, formatting, normalizedHTML: normalized.html, imageAssets };
    return { fixture: id, formatting, imageAssets, normalizedSha256: await sha256(normalized.html),
      normalizedUtf8Bytes: new TextEncoder().encode(normalized.html).length,
      preparationNormalizationMs, diagnostics: diagnostics(normalized),
      extensionNames: (imageAssets ? imageExtensions : extensions).map(extension => extension.name),
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
  async prepareLarge(profile, size, formatting, expected, rtfUnits) {
    if (!['preserve', 'adapt'].includes(formatting)) throw new Error('Invalid formatting policy');
    if (!['cleaned', 'rejected'].includes(expected?.status)) throw new Error('Invalid expected outcome');
    if (rtfUnits !== undefined && (!Number.isSafeInteger(rtfUnits) || rtfUnits < 16 || rtfUnits > 4_000_000)) throw new Error('Invalid RTF flavor length');
    if (!Array.from(document.styleSheets).some(sheet => sheet.href?.endsWith('/domternal-theme.css') && sheet.cssRules.length > 0)) throw new Error('Public theme stylesheet did not load');
    const fixture = generateLarge(profile, size);
    cancelled = false;
    configuration = undefined;
    large = { fixture, formatting, expected, rtfUnits };
    return { profile, size, formatting, htmlSha256: await sha256(fixture.html), utf16Units: fixture.utf16Units,
      words: fixture.words, tokens: fixture.tokens.length,
      environment: { userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency,
        visibilityState: document.visibilityState, viewport: { width: innerWidth, height: innerHeight }, devicePixelRatio } };
  },
  async single(index) {
    checkActive();
    if (!large) throw new Error('The large measurement was not prepared');
    if (!Number.isSafeInteger(index) || index < 0 || index > 100) throw new Error('Invalid dispatch index');
    return { index, ...(await largeOperation()) };
  },
  cancel() { cancelled = true; },
});
