/**
 * The CommonJS half of the consumer type check.
 *
 * Every package here ships two declaration graphs, `.d.ts` for `import` and
 * `.d.cts` for `require`, and until this file existed only the first one was
 * ever type-checked. A CommonJS consumer reads the other one, and the two are
 * emitted separately: a rewritten specifier, a lost `types` condition or a
 * re-export that only resolves under `import` breaks the `.d.cts` graph while
 * the `.d.ts` graph stays perfectly healthy.
 *
 * Its own config, `tsconfig.check-cjs.json`, keeps `skipLibCheck` off so the
 * declaration files this file pulls in are checked rather than trusted.
 *
 * The `require` form is the point. `verbatimModuleSyntax` forbids ESM syntax
 * in a `.cts` file, so writing these as `import ... from` would not compile,
 * and writing them as `import type` would resolve the ESM graph instead: the
 * very thing this file is here to avoid.
 *
 * Command calls below are one per augmenting package, not the exhaustive list
 * `consumer.ts` carries. Exhaustiveness is `coverage-check.mjs`'s job and it
 * reads `consumer.ts` only: what is being proved here is that each package's
 * `declare module '@domternal/core'` block lands in its `.d.cts` and resolves
 * to core's `.d.cts` identity, which one call per package settles.
 */
import core = require('@domternal/core');
import clipboard = require('@domternal/core/clipboard');
import listLabels = require('@domternal/core/list-labels');
import blockControls = require('@domternal/extension-block-controls');
import lowlight = require('@domternal/extension-code-block-lowlight');
import details = require('@domternal/extension-details');
import emoji = require('@domternal/extension-emoji');
import image = require('@domternal/extension-image');
import markdown = require('@domternal/extension-markdown');
import math = require('@domternal/extension-math');
import mention = require('@domternal/extension-mention');
import pasteCleanup = require('@domternal/extension-paste-cleanup');
import pasteHTML = require('@domternal/extension-paste-cleanup/html');
import table = require('@domternal/extension-table');
import toc = require('@domternal/extension-toc');

declare const editor: core.Editor;
declare const clipboardEvent: ClipboardEvent;

// Clipboard coordination resolves through the subpath's own CommonJS declarations.
const disposeHTMLPreparation: () => void = clipboard.registerClipboardHTMLPreparation(editor.view, (html, context: clipboard.ClipboardHTMLPreparationContext) => {
  const origin: 'native' | 'programmatic' = context.origin;
  const activeEvent: ClipboardEvent | undefined = clipboard.getClipboardPasteAttemptEvent(editor.view);
  return { onDeferred(replay: clipboard.ClipboardHTMLReplay) {
    queueMicrotask(() => { const handled: boolean = replay(html, new ClipboardEvent('paste')); });
  } };
}, context => {
  const currentEvent: ClipboardEvent | undefined = context.event;
  const origin: 'native' | 'programmatic' = context.origin;
});
// @ts-expect-error CommonJS preparation requires a callable gate.
clipboard.registerClipboardHTMLPreparation(editor.view, false);
// @ts-expect-error CommonJS attempt observers must be callable.
clipboard.registerClipboardHTMLPreparation(editor.view, () => undefined, false);

const imagePolicy: clipboard.ClipboardImageDestinationPolicy = {
  nodeTypeName: 'image', sourceAttribute: 'src', inline: false, allowEmbedded: true,
  allowedMimeTypes: ['image/png'], maxFileBytes: 1024, policyVersion: 'application:1',
};
const disposeImagePolicy: () => void = clipboard.registerClipboardImageDestination(editor.view, () => imagePolicy);
const liveImagePolicy: clipboard.ClipboardImageDestinationPolicy | undefined = clipboard.getClipboardImageDestination(editor.view);
clipboard.setClipboardPasteBehavior(editor.view, clipboardEvent, { preserveOrderedListStart: true, assetsAlreadyHandled: true });
// @ts-expect-error CommonJS image policies retain their immutable declaration.
imagePolicy.allowedMimeTypes.push('image/svg+xml');
// @ts-expect-error CommonJS asset ownership retains its boolean type.
clipboard.setClipboardPasteBehavior(editor.view, clipboardEvent, { assetsAlreadyHandled: 'trusted' });
const pasteBehavior: Readonly<clipboard.ClipboardPasteBehavior> | undefined = clipboard.getClipboardPasteBehavior(editor.view, clipboardEvent);
const disarmPaste: () => void = clipboard.armClipboardPasteTransaction(editor.view, new core.PluginKey('consumerPaste'), { operationId: 'consumer' });
const disposeCopyAnnotation: () => void = clipboard.registerClipboardCopyAnnotation(editor.view, (fragment: DocumentFragment) => {
  fragment.firstElementChild?.setAttribute('data-consumer-copy', '');
});
const deferral: clipboard.ClipboardHTMLDeferral = { onDeferred() { /* Resumed by the application. */ } };
const copied: Promise<boolean> = core.writeToClipboard('consumer');
// @ts-expect-error The CommonJS main entry does not declare clipboard coordination.
core.registerClipboardHTMLPreparation(editor.view, () => undefined);
// @ts-expect-error The CommonJS main entry does not declare clipboard coordination.
core.setClipboardPasteBehavior(editor.view, clipboardEvent, {});
// @ts-expect-error The CommonJS main entry does not declare clipboard coordination types.
type MainClipboardHTMLReplay = core.ClipboardHTMLReplay;
// @ts-expect-error The gate type stays internal to the CommonJS subpath declarations.
type SubpathClipboardHTMLPreparationGate = clipboard.ClipboardHTMLPreparationGate;
// @ts-expect-error writeToClipboard stays on the CommonJS main entry.
clipboard.writeToClipboard('consumer');

// The standalone HTML entry must also resolve through its CommonJS declarations.
pasteCleanup.PasteCleanup.configure({ formatting: 'adapt' });
const assetLimits: Readonly<pasteCleanup.ClipboardAssetLimits> = pasteCleanup.DEFAULT_CLIPBOARD_ASSET_LIMITS;
const maximumAssetBytes: number = pasteCleanup.MAX_CLIPBOARD_ASSET_LIMITS.maxTotalFileBytes;
pasteCleanup.PasteCleanup.configure({ imageAssets: {
  mode: 'embedded', limits: { maxFileBytes: 1024 }, unresolved: 'reject',
  match(context: pasteCleanup.ClipboardImageMatchContext): readonly pasteCleanup.ClipboardImageBinding[] {
    const operationId: string = context.operationId;
    // @ts-expect-error CommonJS matchers receive no live File objects.
    context.items[0]?.file.arrayBuffer();
    // @ts-expect-error CommonJS item metadata retains its immutable shape.
    context.items.push({});
    return [];
  },
}, onPasteProgress(progress: pasteCleanup.PastePreparationProgress) {
  const phase: 'preparing' = progress.phase;
  progress.cancel();
} });
pasteCleanup.PasteCleanup.configure({ imageAssets: false });
// @ts-expect-error CommonJS asset mode retains its finite contract.
pasteCleanup.PasteCleanup.configure({ imageAssets: { mode: 'upload' } });
// @ts-expect-error CommonJS image association remains synchronous.
pasteCleanup.PasteCleanup.configure({ imageAssets: { mode: 'embedded', match: async () => [] } });
const assetResolver: pasteCleanup.ClipboardResolverAdapter = {
  idempotency: 'operation-asset-key',
  async resolve(request) {
    const blob: Blob = request.blob;
    const signal: AbortSignal = request.signal;
    const resource: pasteCleanup.ClipboardCreatedResource | undefined = request.registerCreated('application-resource');
    // @ts-expect-error CommonJS resolver requests retain the immutable Blob boundary.
    request.blob.name;
    if (resource === undefined) return { status: 'failed', creation: 'unknown', recoveryToken: 'application-recovery' };
    return { status: 'resolved', src: 'https://images.example/test.png', ownership: 'created', resource };
  },
  async releaseUncommitted(request) {
    const operationId: string = request.operationId;
    const handle: string = request.handle;
    return { status: 'released' };
  },
};
const assetRecovery = (report: pasteCleanup.ClipboardAssetRecoveryReport): void => {
  const revision: number = report.revision;
  const settled: boolean = report.settled;
  // @ts-expect-error CommonJS recovery reports never expose source URLs.
  report.src;
  // @ts-expect-error CommonJS recovery snapshots remain immutable.
  report.recovery.push({});
};
pasteCleanup.PasteCleanup.configure({ imageAssets: { mode: 'resolver', resolver: assetResolver, sourcePolicy: { allowedOrigins: ['https://images.example'] }, onRecovery: assetRecovery } });
// @ts-expect-error CommonJS resolver mode also requires recovery observation.
pasteCleanup.PasteCleanup.configure({ imageAssets: { mode: 'resolver', resolver: assetResolver, sourcePolicy: { allowedOrigins: ['https://images.example'] } } });
// @ts-expect-error CommonJS created ownership cannot forge a registered capability.
const forgedCreatedResource: pasteCleanup.ClipboardCreatedResource = {};
pasteCleanup.PasteCleanup.configure({ feedback: 'application', onPasteResult(result) {
  const status: 'applied' | 'rejected' | 'untracked' | 'noop' = result.status;
  const references = pasteCleanup.getPasteAffectedReferences(editor.view, result.operationId);
  const precision: 'operation' | undefined = references?.precision;
  // @ts-expect-error CommonJS operation snapshots remain immutable.
  result.diagnostics.push({ code: 'parse-failed', severity: 'error' });
  // @ts-expect-error CommonJS affected ranges remain immutable.
  references?.ranges.push({ from: 1, to: 2 });
} });
editor.i18n.t(pasteCleanup.pasteCleanupMessages.applied);
// @ts-expect-error CommonJS feedback ownership is a finite option.
pasteCleanup.PasteCleanup.configure({ feedback: 'none' });
const pasteLimits: Partial<pasteHTML.PasteHTMLLimits> = { maxInputLength: 20_000, maxDiagnostics: 10 };
const cleanedPaste: pasteHTML.NormalizePasteHTMLResult = pasteHTML.normalizePasteHTML('<p>Clipboard content</p>', {
  formatting: 'preserve',
  allowRemoteImages: false,
  allowDataImages: true,
  sourceURL: 'https://example.com/document',
  limits: pasteLimits,
});
const cleanedFromMain: pasteCleanup.NormalizePasteHTMLResult = pasteCleanup.normalizePasteHTML('<p>Clipboard content</p>');
const pasteStatus: 'cleaned' | 'rejected' = cleanedPaste.status;
const pasteDiagnosticsTruncated: boolean = cleanedFromMain.diagnosticsTruncated;
// @ts-expect-error CommonJS consumers keep the finite formatting mode contract.
pasteHTML.normalizePasteHTML('<p>Clipboard content</p>', { formatting: 'word' });
// @ts-expect-error CommonJS resource limits must not become permissive declarations.
pasteCleanup.normalizePasteHTML('<p>Clipboard content</p>', { limits: { maxDepth: 'unlimited' } });

declare module '@domternal/core' {
  interface MessageParameters {
    'app.itemCount': { count: number };
  }
  interface SearchableMessages {
    'app.itemCount': true;
  }
}
// Every built-in definition must retain its public parameter augmentation in dist.
type PublishedCoreMessages = core.CompleteMessages<typeof core.coreMessages>;
type DocumentNoteMessageId = 'core.documentNotes.footnote' | 'core.documentNotes.endnote'
  | 'core.documentNotes.missing' | 'core.documentNotes.duplicate'
  | 'core.documentNotes.unreferenced' | 'core.documentNotes.limit';
declare const pre16CoreCatalog: Omit<PublishedCoreMessages, DocumentNoteMessageId>;
const compatiblePre16CoreCatalog: PublishedCoreMessages = pre16CoreCatalog;
const translatedNoteCatalog: PublishedCoreMessages = {
  ...pre16CoreCatalog,
  'core.documentNotes.footnote': ({ label }) => { const text: string = label; return `Footnote ${text}`; },
  'core.documentNotes.endnote': ({ label }) => { const text: string = label; return `Endnote ${text}`; },
};
const everyNoteTranslated: Required<PublishedCoreMessages> = {
  ...pre16CoreCatalog,
  'core.documentNotes.footnote': ({ label }) => `Footnote ${label}`,
  'core.documentNotes.endnote': ({ label }) => `Endnote ${label}`,
  'core.documentNotes.missing': 'Missing note',
  'core.documentNotes.duplicate': 'Duplicate note',
  'core.documentNotes.unreferenced': 'Unreferenced note',
  'core.documentNotes.limit': 'Note navigation unavailable',
};
// @ts-expect-error Strict CommonJS catalogs still require every new note translation.
const missingStrictNoteTranslations: Required<PublishedCoreMessages> = pre16CoreCatalog;
// @ts-expect-error Optional CommonJS note callbacks retain their string label parameter.
const invalidNoteLabel: PublishedCoreMessages = { ...pre16CoreCatalog, 'core.documentNotes.footnote': ({ label }: { label: number }) => String(label) };
// @ts-expect-error CommonJS endnote callbacks also require a string label.
const invalidEndnoteLabel: PublishedCoreMessages = { ...pre16CoreCatalog, 'core.documentNotes.endnote': ({ label }: { label: number }) => String(label) };

// A 1.2 catalog can opt into partial overrides or add the new 1.3 translation.
declare const legacyCoreCatalog: Omit<PublishedCoreMessages, 'core.linkPopover.invalidUrl'>;
const compatibleCoreCatalog: core.Messages = legacyCoreCatalog;
const extendedCoreCatalog: PublishedCoreMessages = {
  ...legacyCoreCatalog, 'core.linkPopover.invalidUrl': 'This link is not allowed.',
};
declare const completeCoreCatalog: PublishedCoreMessages;
const completeOldTranslation: core.MessageValue<undefined> = completeCoreCatalog['core.toolbar.bold'];
const completeNewTranslation: core.MessageValue<undefined> = completeCoreCatalog['core.linkPopover.invalidUrl'];
declare const incompleteLegacyCoreCatalog: Omit<PublishedCoreMessages, 'core.toolbar.bold'>;
// @ts-expect-error Previously required messages remain required in a complete catalog.
const incompleteCoreCatalog: PublishedCoreMessages = incompleteLegacyCoreCatalog;
// @ts-expect-error Complete catalogs also guarantee the new translation is present.
const incompleteNewCoreCatalog: PublishedCoreMessages = legacyCoreCatalog;
// @ts-expect-error New translations require text or a correctly typed callback.
const invalidNewTranslation: PublishedCoreMessages = { ...legacyCoreCatalog, 'core.linkPopover.invalidUrl': 123 };
const builtinTranslations: core.Messages = {
  'core.toolbar.italic': 'Kursiv',
  'core.group.insert': 'Einfügen',
  'core.group.media': 'Medien',
  'core.group.advanced': 'Erweitert',
  'core.heading.level': ({ level }) => `Überschrift ${String(level)}`,
};
editor.i18n.set({
  messages: builtinTranslations,
  searchAliases: { 'core.floating.quote': ['Zitat'], 'core.heading.level': ['Überschrift'] },
});
editor.i18n.t(core.coreMessages.italic);
editor.i18n.t(core.coreMessages.groupInsert);
editor.i18n.t(core.coreMessages.headingLevel, { level: 2 });
// @ts-expect-error Built-in dynamic parameters remain checked after declaration bundling.
editor.i18n.t(core.coreMessages.headingLevel, { level: 'two' });
// @ts-expect-error Dynamic built-in messages require their parameters.
editor.i18n.t(core.coreMessages.headingLevel);
// @ts-expect-error Only declared searchable messages accept aliases.
editor.i18n.set({ searchAliases: { 'core.group.insert': ['Einfügen'] } });

core.resolveColorName(editor.i18n, 'blue');
core.resolveColorSwatch(editor.i18n, 'blue', 'bg');
core.resolveEmojiCategory(editor.i18n, 'Objects');
core.resolveEmojiLabel(editor.i18n, { name: 'smile', label: 'Custom', labelLanguage: 'en' });
core.matchesEmojiPresentation(editor.i18n, { name: 'smile', searchAliases: ['happy'] }, 'happy');
editor.i18n.t(core.coreMessages.emojiItemName, { name: 'smile' });
// @ts-expect-error Emoji display lookup preserves its stable string identity contract.
editor.i18n.t(core.coreMessages.emojiItemName, { name: 1 });
// @ts-expect-error Swatch variants are a finite presentation choice.
core.resolveColorSwatch(editor.i18n, 'blue', 'invalid');

core.observeI18nPresentation(editor.i18n, () => document.body, () => undefined)();

editor.i18n.t(emoji.emojiMessages.suggestionEmpty);
editor.i18n.set({ messages: { 'emoji.insert': 'Insert emoji', 'emoji.suggestion.label': 'Suggestions' } });

const itemCountMessage = core.defineMessage({
  id: 'app.itemCount',
  defaultValue: ({ count }, context) => `${context.number(count)} items`,
  description: 'A consumer-owned item count.',
  owner: 'app',
});
const selectedMessages: core.CompleteMessages<{ itemCount: typeof itemCountMessage }> = {
  'app.itemCount': ({ count }) => String(count),
};
const partialMessages: core.Messages = { 'core.toolbar.bold': 'Fett', ...selectedMessages };
editor.i18n.set({ locale: 'de', messages: partialMessages, searchAliases: { 'app.itemCount': ['items'] } });
editor.i18n.t(itemCountMessage, { count: 2 });
// @ts-expect-error The CommonJS declaration graph must retain parameter types.
editor.i18n.t(itemCountMessage, { count: 'two' });
// @ts-expect-error A parameterized message cannot omit parameters.
editor.i18n.t(itemCountMessage);
// @ts-expect-error Unknown built-in IDs remain errors in CommonJS consumers.
editor.i18n.set({ messages: { 'core.toolbar.bodl': 'Fett' } });

/*
 * One command per package that augments `RawCommands`, which is every package
 * above except extension-block-controls and extension-paste-cleanup. Their
 * public extension and helper contracts are exercised separately.
 */
editor.commands.toggleBold();
editor.commands.toggleDetails();
editor.commands.suggestEmoji();
editor.commands.deleteImage();
editor.commands.insertMarkdown('# hi');
editor.commands.insertMathInline('a^2');
editor.commands.deleteMention();
editor.commands.cancelPrintPreparation();
editor.commands.deleteTable();
const tableRowLayout: table.TableRowLayout = { height: 80, allowSplit: false };
const tableCellLayout: table.TableCellLayout = { padding: { top: 12 } };
editor.commands.setTableLayout({ breakBefore: 'page' });
editor.commands.setTableRowLayout(tableRowLayout);
editor.commands.setTableCellLayout(tableCellLayout);
const tableJSON: core.JSONContent = { type: 'tableRow', attrs: { rowLayout: tableRowLayout }, content: [
  { type: 'tableCell', attrs: { cellLayout: tableCellLayout }, content: [{ type: 'paragraph' }] },
] };
const cjsCellLayout: table.TableCellLayout | null = table.getNodeTableCellLayout(editor.state.doc);

editor.commands.scrollToHeading('heading-id');
editor.chain().focus().toggleBold().run();

/*
 * Every package's main export, named so a `.d.cts` that resolves but ships an
 * empty or renamed surface fails here rather than passing quietly.
 */
declare const extensions: core.Extension[];
extensions.push(
  blockControls.BlockHandle,
  details.Details,
  emoji.Emoji,
  image.Image,
  markdown.Markdown,
  math.MathInline,
  mention.Mention,
  pasteCleanup.PasteCleanup,
  table.Table,
  table.TableLayout,
  toc.TableOfContents
);

/**
 * Resolves to `never` when `T` has silently become `any`.
 *
 * The two re-exports below cross a package boundary, and a boundary that stops
 * resolving is exactly what turns a re-exported name into `any`. With
 * `skipLibCheck` off, tsc reports that on its own; this pair of assertions
 * keeps the guarantee even if a future dependency ever forces the flag back
 * on, the way it is forced on next door in the Pro repository.
 */
type NotAny<T> = 0 extends 1 & T ? never : T;
/** Compiles only for `true`, so a `false` argument is the failure. */
type Assert<T extends true> = T;

/* Re-exported by extension-block-controls from @domternal/core. */
type _FloatingMenuResolves = Assert<
  [NotAny<blockControls.FloatingMenuOptions>] extends [never] ? false : true
>;
/* Re-exported by extension-table from @domternal/pm/tables. */
type _TableMapResolves = Assert<[NotAny<table.TableMap>] extends [never] ? false : true>;
/* Lowlight augments no commands, so an options type is what there is to touch. */
type _LowlightResolves = Assert<
  [NotAny<lowlight.CodeBlockLowlightOptions>] extends [never] ? false : true
>;

/* The BlockHandle option shape, mirroring the ESM consumer's own check. */
declare const provider: blockControls.DropZoneProvider;
blockControls.BlockHandle.configure({
  dropZoneProviders: [provider],
  nested: { allowedNodes: ['paragraph'], anchorContainers: ['column'] },
});

// The published 1.3 option types remain writable across configuration forms.
let configurableLink = core.Link.configure({ protocols: null });
configurableLink = core.Link.configure({ protocols: ['https:'] }).configure({ openOnClick: false });
configurableLink.options.protocols = [{ scheme: 'https' }];
configurableLink.options.protocols = null;
let configurablePopover = core.LinkPopover.configure({ protocols: null });
configurablePopover = core.LinkPopover.configure({ protocols: ['https:'] }).configure({}).clone();
configurablePopover.options.protocols = [{ scheme: 'https' }];
configurablePopover.options.protocols = null;
const defaultLinkOptions = core.Link.clone();
defaultLinkOptions.options.protocols = null;
const defaultPopoverOptions = core.LinkPopover.clone();
defaultPopoverOptions.options.protocols = [{ scheme: 'https' }];
const extendedLinkOptions: typeof core.Link = core.Link.extend({});
const extendedPopoverOptions: typeof core.LinkPopover = core.LinkPopover.extend({});
const readonlyProtocolInput = [{ scheme: 'https' }] as const;
core.Link.configure({ protocols: readonlyProtocolInput }).clone();
core.LinkPopover.configure({ protocols: readonlyProtocolInput }).clone();
// @ts-expect-error A popover configuration must be an options object.
core.LinkPopover.configure(123);
// @ts-expect-error Unknown popover options remain rejected.
core.LinkPopover.configure({ unknownOption: true });
// @ts-expect-error Unknown Link options remain rejected.
core.Link.configure({ openOnClick: false, unknownOption: true });
// @ts-expect-error A Link configuration must be an options object.
core.Link.configure(123);
// @ts-expect-error A function is not a Link options object.
core.Link.configure(() => 1);

const listLabel: import('@domternal/core').CounterListLabel = { kind: 'counter', format: 'decimal', prefix: '', suffix: ') ' };
const listJSON: import('@domternal/core').JSONContent = { type: 'orderedList', attrs: { listLabel } };
import listLabelCore = require('@domternal/core');
const listLabelCSS: string = listLabelCore.getListLabelStyleSheet(listJSON);
const listLabelText: string | null = listLabelCore.formatListLabel(listLabel, 0);
listLabelCore.ListLabels.configure({ nonce: 'host-nonce' });

// The pure subpath also exposes its own CommonJS declarations.
const pureLabel: listLabels.ListLabel | null = listLabels.readListLabel({ kind: 'text', text: '✓' });
const pureMarker: string | null = listLabels.formatListLabel(pureLabel);
const pureStyles: string = listLabels.getListLabelStyleSheet({ type: 'bulletList', attrs: { listLabel: pureLabel } });


const compoundLabel: listLabels.CompoundListLabel = { kind: 'compound', parts: [{ ancestor: 1, format: 'inherit' }, '.', { ancestor: 0, format: 'decimal' }], fallback: 'decimal' };
const imageLabel: core.ImageListLabel = { kind: 'image', src: 'data:image/png;base64,applicationPayload', text: '*' };
const ancestors: readonly listLabels.ListLabelAncestor[] = [{ ordinal: 4, format: 'upper-alpha' }];
const compoundText: string | null = listLabels.formatExtendedListLabel(compoundLabel, 0, ancestors);
const parsedImage: listLabels.ExtendedListLabel | null = listLabels.parseExtendedListLabel(JSON.stringify(imageLabel));
const transform: image.ImageTransform = { naturalWidth: 1200, naturalHeight: 800, crop: { left: 0.1 }, rotation: 90 };
const transformOptions: image.SetImageTransformOptions = { rotation: 90, flipX: true };
editor.commands.setImage({ src: 'image.png', imageTransform: transform });
editor.commands.setImageTransform(transformOptions);
editor.commands.setImageTransform(null);
// @ts-expect-error CommonJS image geometry keeps numeric rotation.
editor.commands.setImageTransform({ rotation: '90deg' });
// @ts-expect-error CommonJS picture labels also require fallback text.
const missingPictureFallback: listLabels.ImageListLabel = { kind: 'image', src: 'data:image/png;base64,applicationPayload' };

// Existing consumers can exhaust the original union after an additive minor update.
function legacyLabelConsumer(label: core.ListLabel): string {
  if (label.kind === 'counter') return label.format;
  return label.text;
}
function legacyPureLabelConsumer(label: listLabels.ListLabel): string {
  switch (label.kind) {
    case 'counter': return label.format;
    case 'text': return label.text;
    default: { const unreachable: never = label; return unreachable; }
  }
}
const legacyReadResult = core.readListLabel({ kind: 'text', text: '*' });
if (legacyReadResult !== null) legacyLabelConsumer(legacyReadResult);
const legacyNodeResult = core.getNodeListLabel(editor.state.doc);
if (legacyNodeResult !== null) legacyPureLabelConsumer(legacyNodeResult);

editor.commands.insertDocumentNote({ noteId: 'commonjs-note', kind: 'endnote' });
editor.commands.insertDocumentNoteReference({ noteId: 'commonjs-note', kind: 'endnote' });
editor.commands.focusDocumentNote({ noteId: 'commonjs-note', kind: 'endnote' });
void [core.DocumentNotes, core.DocumentNote, core.DocumentNoteReference, core.getDocumentNotes(editor.state.doc), core.getDocumentNoteTypes(editor.schema)];
