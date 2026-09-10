import {
  Bold, Italic, Underline, Strike, Link, TextStyle, TextColor, Highlight,
  FontFamily, FontSize, TextAlign, Heading, BulletList, OrderedList, ListItem,
  Blockquote, CodeBlock, HardBreak, UniqueID, Extension, Subscript, Superscript, LineHeight, TaskList, TaskItem,
  CharacterCount,
} from '@domternal/core';
import { Plugin, TextSelection } from '@domternal/pm/state';
import { undoDepth, redoDepth, closeHistory } from '@domternal/pm/history';
import { Image } from '@domternal/extension-image';
import { Table, TableRow, TableCell, TableHeader } from '@domternal/extension-table';
import { Details, DetailsSummary, DetailsContent } from '@domternal/extension-details';
import { Markdown } from '@domternal/extension-markdown';
import { SmartPaste } from '@domternal/extension-block-controls';
import { PasteCleanup, getPasteAffectedReferences } from '@domternal/extension-paste-cleanup';
import { normalizePasteHTML } from '@domternal/extension-paste-cleanup/html';

const query = new URLSearchParams(location.search);
const framework = query.get('framework') ?? 'vanilla';
const formatting = query.get('formatting') === 'adapt' ? 'adapt' : 'preserve';
const lifecycle = query.get('lifecycle');
const feedback = query.get('feedback') === 'application' ? 'application' : 'default';
const embeddedAssets = query.get('assets') === 'embedded';
const resolverAssets = query.get('assets') === 'resolver';
const coordinatedAssets = embeddedAssets || resolverAssets;
const imagePolicy = query.get('image-policy');
const capabilityMinimal = query.get('schema') === 'capability-minimal';
const capabilityFull = query.get('schema') === 'capability-full';
// Levels two and three only, as an application that reserves h1 for its page title.
const headingLevels = query.get('schema') === 'heading-levels';
const lists = query.get('schema') !== 'no-lists';
// A Link that stores only https: addresses, for the destination link probe.
const httpsLinks = query.get('link-protocols') === 'https';
const listMarkers = query.get('list-markers') === '1';
// Core paste without PasteCleanup, for behavior applications see without the extension.
const withoutPasteCleanup = query.get('paste-cleanup') === 'off';
// ProseMirror's own paste placement, without SmartPaste's block routing.
const withoutSmartPaste = query.get('smart-paste') === 'off';
// Blocks without ids, so a pasted heading can share the markup of the heading it lands in.
const withoutUniqueID = query.get('unique-id') === 'off';
const details = query.get('details') === '1';
// A CharacterCount limit, whose filterTransaction vetoes keystrokes beyond it.
const characterLimit = query.has('limit') ? Number(query.get('limit')) : null;
// An Angular host bound to a reactive form, with the htmlContent signal rendered beside it.
const angularForm = query.get('angular-form') === '1';
if (listMarkers) await import('@domternal/theme/css');
// Test-only older/custom schema control: keep list structure but omit the marker attribute.
const withoutMarker = extension => extension.extend({ addAttributes() {
  const attrs = { ...this.parent?.() }; delete attrs.listStyleType; return attrs;
} });
const markerLists = query.get('list-marker-policy') === 'legacy'
  ? [withoutMarker(BulletList), withoutMarker(OrderedList)] : [BulletList, OrderedList];
// All wrappers add only Document, Paragraph, Text, BaseKeymap and History.
// This opt-in filter removes every optional formatting node and mark from the fixture.
const disabledExtensions = new Set([
  ...(capabilityMinimal ? [
    'bold', 'italic', 'underline', 'strike', 'link', 'textStyle', 'textColor', 'highlight',
    'fontFamily', 'fontSize', 'textAlign', 'heading', 'bulletList', 'orderedList', 'listItem',
    'blockquote', 'codeBlock', 'hardBreak', 'image', 'table', 'tableRow', 'tableCell', 'tableHeader',
  ] : withoutPasteCleanup ? ['pasteCleanup'] : []),
  ...(withoutSmartPaste ? ['smartPaste'] : []), ...(withoutUniqueID ? ['uniqueID'] : []),
]);
const limits = query.get('limits') === 'small'
  ? { maxInputLength: 1024, maxNodes: 80, maxDepth: 8, maxTableCells: 16 }
  : undefined;
const results = [];
const wrapperCalls = [];
const transactions = [];
const operations = [];
const operationSnapshots = [];
const callbackOrder = [];
const destroyedSnapshots = [];
const preparationProgress = [];
const assetMatchRequests = [];
const assetHookCalls = { html: 0, slice: 0, handle: 0 };
let assetBindings = [];
let assetReads = 0;
let assetUploads = 0;
let pauseAssetReads = false;
const releaseAssetReads = [];
const assetReadCompletions = new Set();
const resolverCalls = [];
const resolverBlobEvidence = [];
const resolverRegistrations = [];
const resolverReleases = [];
const recoveryReports = [];
const resolverObserverThrows = { update: 0, terminal: 0 };
const resolverHolds = new Set();
const resolverWaiters = new Map();
const resolverCompletions = new Set();
const cleanupCompletions = new Set();
let resolverSettlements = 0;
let cleanupSettlements = 0;
const resolvedOrigin = 'http://127.0.0.1:5895';
let cancelPreparation;
let hostUpdates = 0;
let lifecycleReady = false;
let nestedStarted = false;
let nestedEvent;
let editor;
let wrapper;

// Synthetic fixture control only. Native File bytes stay unchanged while reads can be held.
if (coordinatedAssets) {
  const nativeArrayBuffer = File.prototype.arrayBuffer;
  File.prototype.arrayBuffer = function () {
    assetReads++;
    const read = (async () => {
      if (pauseAssetReads) await new Promise(resolve => { releaseAssetReads.push(resolve); });
      return nativeArrayBuffer.call(this);
    })();
    assetReadCompletions.add(read);
    void read.then(() => assetReadCompletions.delete(read), () => assetReadCompletions.delete(read));
    return read;
  };
}

// This adapter never uploads. Browser tests fulfill its approved loopback image URL.
function waitForResolverStage(stage) {
  if (!resolverHolds.has(stage)) return Promise.resolve();
  return new Promise(resolve => {
    const waiters = resolverWaiters.get(stage) ?? [];
    waiters.push(resolve);
    resolverWaiters.set(stage, waiters);
  });
}

function releaseResolverStage(stage) {
  resolverHolds.delete(stage);
  for (const resolve of resolverWaiters.get(stage) ?? []) resolve();
  resolverWaiters.delete(stage);
}

function trackResolverWork(promise, completions) {
  completions.add(promise);
  void promise.then(() => completions.delete(promise), () => completions.delete(promise));
  return promise;
}

const fixtureResolver = {
  idempotency: 'operation-asset-key',
  resolve(request) {
    resolverCalls.push({ operationId: request.operationId, assetId: request.assetId,
      idempotencyKey: request.idempotencyKey, mimeType: request.mimeType, bytes: request.blob.size });
    const number = resolverCalls.length;
    const work = (async () => {
      if (query.get('resolver-inspect') === 'bytes') {
        const blobType = Object.getOwnPropertyDescriptor(Blob.prototype, 'type').get.call(request.blob);
        const size = Object.getOwnPropertyDescriptor(Blob.prototype, 'size').get.call(request.blob);
        if (size > 4096) throw new Error('Synthetic byte inspection is limited to small fixture images');
        const bytes = new Uint8Array(await Blob.prototype.arrayBuffer.call(request.blob));
        const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
        resolverBlobEvidence.push({ assetId: request.assetId, blobType, byteLength: bytes.length,
          base64: btoa(String.fromCharCode(...bytes)),
          sha256: Array.from(hash, value => value.toString(16).padStart(2, '0')).join('') });
      }
      await waitForResolverStage('before-creation');
      const outcome = query.get('resolver-outcome') ?? 'created';
      if (outcome === 'existing') {
        await waitForResolverStage('after-creation');
        return { status: 'resolved', ownership: 'existing', src: `${resolvedOrigin}/__resolver-images__/existing.png` };
      }
      const handle = `private-resolver-handle-${String(number)}`;
      const resource = request.registerCreated(handle);
      resolverRegistrations.push({ assetId: request.assetId, accepted: resource !== undefined });
      if (resource === undefined) throw new Error('Synthetic resolver registration refused');
      await waitForResolverStage('after-creation');
      if (outcome === 'partial-failure' && number === 2) return { status: 'failed', creation: 'registered' };
      const src = outcome === 'forbidden' ? 'https://paste-probe.invalid/forbidden.png'
        : `${resolvedOrigin}/__resolver-images__/${String(number)}.png`;
      return { status: 'resolved', ownership: 'created', src, resource };
    })().finally(() => { resolverSettlements++; });
    return trackResolverWork(work, resolverCompletions);
  },
  releaseUncommitted(request) {
    resolverReleases.push({ ...request });
    const work = (async () => {
      await waitForResolverStage('cleanup');
      return query.get('resolver-cleanup') === 'pending'
        ? { status: 'cleanup-pending', retryToken: 'private-resolver-retry-token' }
        : { status: 'released' };
    })().finally(() => { cleanupSettlements++; });
    return trackResolverWork(work, cleanupCompletions);
  },
};

const AssetHookObserver = Extension.create({
  name: 'pasteFixtureAssetHooks',
  priority: 1500,
  addProseMirrorPlugins: () => [new Plugin({ props: {
    transformPastedHTML(html) {
      assetHookCalls.html++;
      return query.get('asset-transform') === 'prefix' ? `<p>Host prefix</p>${html}` : html;
    },
    transformPasted(slice) { assetHookCalls.slice++; return slice; },
    handlePaste() { assetHookCalls.handle++; return false; },
  } })],
});

// A paste handler that fails, for the native paste claim. It runs before every other paste hook.
const pasteFailure = query.get('paste-failure');
const FailingPasteHook = Extension.create({
  name: 'pasteFixtureFailure',
  priority: 10000,
  addProseMirrorPlugins: () => {
    const fail = () => { throw new Error('Synthetic paste handler failure'); };
    return [new Plugin({ props: pasteFailure === 'html' ? { transformPastedHTML: fail }
      : pasteFailure === 'slice' ? { transformPasted: fail } : { handlePaste: fail } })];
  },
});

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

// Answers a transaction marked appendDoc with a document change, for the callback contract.
const AppendDocument = Extension.create({
  name: 'pasteFixtureAppendDocument',
  addProseMirrorPlugins: () => [new Plugin({
    appendTransaction(transactions, _previous, state) {
      if (!transactions.some(transaction => transaction.getMeta('appendDoc') === true)) return null;
      return state.tr.insertText('!', state.doc.content.size - 1);
    },
  })],
});

// Each wrapper supplies Document, Paragraph, Text, BaseKeymap and History.
// The optional extension list is identical across all four integrations.
const extensions = [
  Bold, Italic, Underline, Strike, httpsLinks ? Link.configure({ protocols: ['https:'] }) : Link, TextStyle, TextColor, Highlight,
  FontFamily, FontSize, TextAlign,
  capabilityFull ? Heading.configure({ levels: [1, 2, 3, 4, 5, 6] }) : headingLevels ? Heading.configure({ levels: [2, 3] }) : Heading,
  ...(capabilityFull ? [Subscript, Superscript, LineHeight] : []),
  ...(lists ? [...markerLists, ListItem] : []),
  ...(listMarkers ? [TaskList, TaskItem] : []),
  Blockquote, CodeBlock, HardBreak, UniqueID,
  ...(imagePolicy === 'missing' ? [] : [Image.configure({
    allowBase64: imagePolicy !== 'no-base64',
    ...(coordinatedAssets ? { uploadHandler: async () => { assetUploads++; return 'https://paste-probe.invalid/unexpected-upload.png'; } } : {}),
  })]), Table, TableRow, TableCell, TableHeader,
  ...(details ? [Details, DetailsSummary, DetailsContent] : []),
  ...(pasteFailure === null ? [] : [FailingPasteHook]),
  Markdown, SmartPaste,
  ...(lifecycle === 'veto' ? [PasteVeto] : []),
  ...(lifecycle === 'destroy-before-observe' ? [DestroyBeforeReceiptObserver] : []),
  ...(['nested-interception', 'nested-empty-interception'].includes(lifecycle) ? [ConsumeNestedPaste, ConsumeOuterAndNest] : []),
  ...(coordinatedAssets ? [AssetHookObserver] : []),
  ...(characterLimit === null ? [] : [CharacterCount.configure({ limit: characterLimit })]),
  ...(lifecycle === 'append-doc' ? [AppendDocument] : []),
  PasteCleanup.configure({
    formatting,
    feedback,
    ...(query.get('source-data') === 'forbid' ? { allowDataImages: false } : {}),
    ...(limits === undefined && query.get('diagnostics') !== 'one' ? {} : {
      limits: { ...limits, ...(query.get('diagnostics') === 'one' ? { maxDiagnostics: 1 } : {}) },
    }),
    ...(coordinatedAssets ? {
      imageAssets: {
        mode: resolverAssets ? 'resolver' : 'embedded',
        ...(resolverAssets ? {
          resolver: fixtureResolver,
          sourcePolicy: { allowedOrigins: [resolvedOrigin] },
          onRecovery: report => {
            recoveryReports.push(structuredClone(report));
            if (query.get('resolver-observer') === 'cancel-created' && report.phase === 'preparing' && report.registeredResources > 0) cancelPreparation?.();
          },
        } : {}),
        unresolved: query.get('unresolved') === 'omit' ? 'omit' : 'reject',
        ...(query.get('asset-limits') === 'small' ? { limits: { maxFileBytes: 16, maxTotalFileBytes: 32 } } : {}),
        ...(query.has('asset-total-bytes') ? { limits: {
          maxFileBytes: Number(query.get('asset-total-bytes')), maxTotalFileBytes: Number(query.get('asset-total-bytes')),
        } } : {}),
        match: context => {
          assetMatchRequests.push(structuredClone(context));
          return context.references.flatMap(reference => assetBindings
            .filter(binding => binding.reference === reference.rawReference)
            .map(binding => ({ placementId: reference.placementId, itemIndex: binding.itemIndex,
              evidence: { kind: 'host', matcherId: 'synthetic-fixture:1' } })));
        },
      },
      onPasteProgress: progress => {
        preparationProgress.push({ operationId: progress.operationId, phase: progress.phase });
        cancelPreparation = progress.cancel;
      },
    } : {}),
    onResult: result => {
      results.push(structuredClone(result));
      callbackOrder.push({ phase: 'normalize', operationId: result.operationId });
      if (resolverAssets && query.get('resolver-host') === 'insert-throw' && result.html.includes('/__resolver-images__/')) {
        const image = editor.state.schema.nodes.image;
        const source = `${resolvedOrigin}/__resolver-images__/1.png`;
        editor.view.dispatch(editor.state.tr.replaceSelectionWith(image.create({ src: source })));
        throw new Error('Synthetic host inserted an untagged image');
      }
    },
    onPasteResult: result => {
      operations.push(structuredClone(result));
      callbackOrder.push({ phase: 'operation', operationId: result.operationId });
      operationSnapshots.push({
        doc: editor.getJSON(),
        selection: editor.state.selection.toJSON(),
        focused: editor.view.hasFocus(),
      });
      if (resolverAssets && query.get('resolver-host') === 'destroy-throw') {
        resolverObserverThrows.terminal++;
        editor.destroy();
        throw new Error('Synthetic terminal observer failed after destruction');
      }
    },
  }),
].filter(extension => !disabledExtensions.has(extension.name));

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
      resolverObserverThrows.update++;
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
  get wrapperCalls() { return wrapperCalls; },
  get angularForm() {
    const control = wrapper?.components?.[0]?.instance?.control;
    const signal = document.querySelector('#wrapper-html')?.textContent ?? null;
    return control === undefined ? null : { dirty: control.dirty, value: control.value, signal };
  },
  get transactions() { return transactions; },
  get operations() { return operations; },
  get operationSnapshots() { return operationSnapshots; },
  get destroyedSnapshots() { return destroyedSnapshots; },
  get callbackOrder() { return callbackOrder; },
  get hostUpdates() { return hostUpdates; },
  get preparationProgress() { return preparationProgress; },
  get assetMatchRequests() { return assetMatchRequests; },
  get assetReads() { return assetReads; },
  get assetUploads() { return assetUploads; },
  get assetHookCalls() { return assetHookCalls; },
  get resolverCalls() { return resolverCalls; },
  get resolverBlobEvidence() { return resolverBlobEvidence; },
  get resolverRegistrations() { return resolverRegistrations; },
  get resolverReleases() { return resolverReleases; },
  get resolverSettlements() { return resolverSettlements; },
  get cleanupSettlements() { return cleanupSettlements; },
  get recoveryReports() { return recoveryReports; },
  get resolverObserverThrows() { return resolverObserverThrows; },
  holdResolver(stage) { resolverHolds.add(stage); },
  async releaseResolver() {
    releaseResolverStage('before-creation');
    releaseResolverStage('after-creation');
    while (resolverCompletions.size > 0) await Promise.allSettled([...resolverCompletions]);
    // Actual adapter settlement precedes the frame; cleanup can remain explicitly held.
    await new Promise(resolve => requestAnimationFrame(resolve));
  },
  async releaseResolverCleanup() {
    releaseResolverStage('cleanup');
    while (cleanupCompletions.size > 0) await Promise.allSettled([...cleanupCompletions]);
    await new Promise(resolve => requestAnimationFrame(resolve));
  },
  setAssetBindings(bindings) { assetBindings = structuredClone(bindings); },
  holdAssetReads() { pauseAssetReads = true; },
  async releaseAssetReads() {
    pauseAssetReads = false;
    for (const release of releaseAssetReads.splice(0)) release();
    while (assetReadCompletions.size > 0) await Promise.allSettled([...assetReadCompletions]);
    // Let settled native reads and their queued continuations finish before assertions.
    await new Promise(resolve => requestAnimationFrame(resolve));
  },
  cancelPreparation() { cancelPreparation?.(); },
  changeImagePolicy(allowBase64) {
    const image = editor.extensionManager.extensions.find(extension => extension.name === 'image');
    if (image === undefined) throw new Error('The fixture has no Image extension');
    image.options.allowBase64 = allowBase64;
  },
  normalize: (html, options) => normalizePasteHTML(html, options),
  references: id => getPasteAffectedReferences(editor.view, id),
  history: () => ({ undo: undoDepth(editor.state), redo: redoDepth(editor.state) }),
  closeHistory() { editor.view.dispatch(closeHistory(editor.state.tr)); },
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
    wrapperCalls.length = 0;
    transactions.length = 0;
    operations.length = 0;
    operationSnapshots.length = 0;
    callbackOrder.length = 0;
    destroyedSnapshots.length = 0;
    preparationProgress.length = 0;
    assetMatchRequests.length = 0;
    assetHookCalls.html = 0;
    assetHookCalls.slice = 0;
    assetHookCalls.handle = 0;
    assetReads = 0;
    assetUploads = 0;
    resolverCalls.length = 0;
    resolverBlobEvidence.length = 0;
    resolverRegistrations.length = 0;
    resolverReleases.length = 0;
    recoveryReports.length = 0;
    resolverObserverThrows.update = 0;
    resolverObserverThrows.terminal = 0;
    resolverSettlements = 0;
    cleanupSettlements = 0;
    cancelPreparation = undefined;
    hostUpdates = 0;
    lifecycleReady = true;
  },
  snapshot() { return { doc: editor.getJSON(), selection: editor.state.selection.toJSON() }; },
  serializeSelection() {
    const { dom, text } = editor.view.serializeForClipboard(editor.state.selection.content());
    return { html: dom.innerHTML, text };
  },
};

// The callbacks each wrapper derives from the editor's events.
const wrapperCallbacks = {
  onUpdate: () => { wrapperCalls.push('update'); },
  onSelectionChange: () => { wrapperCalls.push('selection'); },
};

if (framework === 'vanilla') {
  const { DomternalEditor } = await import('@domternal/vanilla');
  const mount = document.querySelector('#fixture');
  if (listMarkers) mount.classList.add('dm-editor');
  mount.replaceChildren();
  wrapper = new DomternalEditor(mount, { extensions, content: '<p></p>', onCreate: capture, ...wrapperCallbacks });
} else if (framework === 'react') {
  const { createElement: h } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { DomternalEditor } = await import('@domternal/react');
  wrapper = createRoot(document.querySelector('#fixture'));
  wrapper.render(h(DomternalEditor, { extensions, content: '<p></p>', onCreate: capture, ...wrapperCallbacks }));
} else if (framework === 'vue') {
  const { createApp, h } = await import('vue');
  const { DomternalEditor } = await import('@domternal/vue');
  wrapper = createApp({
    setup: () => () => h(DomternalEditor, { extensions, content: '<p></p>', onCreate: capture, ...wrapperCallbacks }),
  });
  wrapper.mount('#fixture');
} else if (framework === 'angular') {
  await import('@angular/compiler');
  const { Component, provideZonelessChangeDetection } = await import('@angular/core');
  const { bootstrapApplication } = await import('@angular/platform-browser');
  const { FormControl, ReactiveFormsModule } = await import('@angular/forms');
  const { DomternalEditorComponent } = await import('@domternal/angular');
  class App {
    extensions = extensions;
    control = new FormControl('<p></p>', { nonNullable: true });
    created(instance) { capture(instance); }
    record(call) { wrapperCalls.push(call); }
  }
  const outputs = '(editorCreated)="created($event)" (contentUpdated)="record(\'update\')" (selectionChanged)="record(\'selection\')"';
  Component({
    selector: 'paste-cleanup-test-app', standalone: true,
    imports: [DomternalEditorComponent, ReactiveFormsModule],
    template: angularForm
      ? `<domternal-editor #editor [extensions]="extensions" [formControl]="control" ${outputs} /><output id="wrapper-html">{{ editor.htmlContent() }}</output>`
      : `<domternal-editor [extensions]="extensions" content="<p></p>" ${outputs} />`,
  })(App);
  wrapper = await bootstrapApplication(App, { providers: [provideZonelessChangeDetection()] });
} else {
  throw new Error(`Unknown framework: ${framework}`);
}
