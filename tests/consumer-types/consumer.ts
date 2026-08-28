/**
 * Type-checks against the BUILT @domternal/core dist (not source) to
 * verify every RawCommands augmentation reaches an external consumer.
 * coverage-check.mjs guarantees this list stays exhaustive.
 */
import type { Editor } from '@domternal/core';
import { coreMessages, defineMessage, resolveColorName, resolveColorSwatch, resolveEmojiCategory, resolveEmojiLabel, matchesEmojiPresentation, observeI18nPresentation, registerClipboardImageDestination, getClipboardImageDestination, setClipboardPasteBehavior } from '@domternal/core';
import type { CompleteMessages, Messages, ClipboardImageDestinationPolicy } from '@domternal/core';
import { registerClipboardHTMLPreparation, getClipboardPasteAttemptEvent } from '@domternal/core';
import type { ClipboardHTMLPreparationContext, ClipboardHTMLReplay } from '@domternal/core';

declare module '@domternal/core' {
  interface MessageParameters {
    'app.itemCount': { count: number };
  }
  interface SearchableMessages {
    'app.itemCount': true;
  }
}

// Bare imports load each extension's `declare module '@domternal/core'`
// augmentation, without which their commands appear missing.
import '@domternal/extension-details';
import '@domternal/extension-emoji';
import { emojiMessages } from '@domternal/extension-emoji';
import '@domternal/extension-image';
import '@domternal/extension-markdown';
import '@domternal/extension-math';
import '@domternal/extension-mention';
import { PasteCleanup, pasteCleanupMessages, getPasteAffectedReferences, normalizePasteHTML as normalizePasteFromMain } from '@domternal/extension-paste-cleanup';
import type { NormalizePasteHTMLResult as MainPasteHTMLResult } from '@domternal/extension-paste-cleanup';
import { DEFAULT_CLIPBOARD_ASSET_LIMITS, MAX_CLIPBOARD_ASSET_LIMITS } from '@domternal/extension-paste-cleanup';
import type { ClipboardAssetLimits, ClipboardImageBinding, ClipboardImageMatchContext, PastePreparationProgress } from '@domternal/extension-paste-cleanup';
import { normalizePasteHTML } from '@domternal/extension-paste-cleanup/html';
import type { PasteHTMLLimits, NormalizePasteHTMLResult } from '@domternal/extension-paste-cleanup/html';
import '@domternal/extension-table';
import '@domternal/extension-toc';

declare const editor: Editor;
declare const clipboardEvent: ClipboardEvent;

const disposeHTMLPreparation: () => void = registerClipboardHTMLPreparation(editor.view, (html, context: ClipboardHTMLPreparationContext) => {
  const origin: 'native' | 'programmatic' = context.origin;
  const activeEvent: ClipboardEvent | undefined = getClipboardPasteAttemptEvent(editor.view);
  return { onDeferred(replay: ClipboardHTMLReplay) {
    queueMicrotask(() => { const handled: boolean = replay(html, new ClipboardEvent('paste')); });
  } };
}, context => {
  const currentEvent: ClipboardEvent | undefined = context.event;
  const origin: 'native' | 'programmatic' = context.origin;
});
// @ts-expect-error Preparation requires a callable gate.
registerClipboardHTMLPreparation(editor.view, false);
// @ts-expect-error Attempt observers must be callable.
registerClipboardHTMLPreparation(editor.view, () => undefined, false);

const imagePolicy: ClipboardImageDestinationPolicy = {
  nodeTypeName: 'image', sourceAttribute: 'src', inline: false, allowEmbedded: true,
  allowedMimeTypes: ['image/png'], maxFileBytes: 1024, policyVersion: 'application:1',
};
const disposeImagePolicy: () => void = registerClipboardImageDestination(editor.view, () => imagePolicy);
const liveImagePolicy: ClipboardImageDestinationPolicy | undefined = getClipboardImageDestination(editor.view);
setClipboardPasteBehavior(editor.view, clipboardEvent, { preserveOrderedListStart: true, assetsAlreadyHandled: true });
// @ts-expect-error Published image policies are immutable declarations.
imagePolicy.allowedMimeTypes.push('image/svg+xml');
// @ts-expect-error Asset ownership is a boolean signal, not a string trust label.
setClipboardPasteBehavior(editor.view, clipboardEvent, { assetsAlreadyHandled: 'trusted' });

// Both published entries retain the same typed conversion contract.
PasteCleanup.configure({ formatting: 'adapt' });
const assetLimits: Readonly<ClipboardAssetLimits> = DEFAULT_CLIPBOARD_ASSET_LIMITS;
const maximumAssetBytes: number = MAX_CLIPBOARD_ASSET_LIMITS.maxTotalFileBytes;
PasteCleanup.configure({ imageAssets: {
  mode: 'embedded', limits: { maxFileBytes: 1024 }, unresolved: 'reject',
  match(context: ClipboardImageMatchContext): readonly ClipboardImageBinding[] {
    const operationId: string = context.operationId;
    // @ts-expect-error Matchers receive bounded metadata, never live File objects.
    context.items[0]?.file.arrayBuffer();
    // @ts-expect-error The original item metadata is immutable.
    context.items.push({});
    return [];
  },
}, onPasteProgress(progress: PastePreparationProgress) {
  const phase: 'preparing' = progress.phase;
  progress.cancel();
} });
PasteCleanup.configure({ imageAssets: false });
// @ts-expect-error The initial asset mode only embeds validated local images.
PasteCleanup.configure({ imageAssets: { mode: 'upload' } });
// @ts-expect-error Association must be supplied synchronously from captured metadata.
PasteCleanup.configure({ imageAssets: { mode: 'embedded', match: async () => [] } });
PasteCleanup.configure({ feedback: 'application', onPasteResult(result) {
  const status: 'applied' | 'rejected' | 'untracked' | 'noop' = result.status;
  const references = getPasteAffectedReferences(editor.view, result.operationId);
  const precision: 'operation' | undefined = references?.precision;
  // @ts-expect-error Accepted operation snapshots cannot be changed by observers.
  result.diagnostics.push({ code: 'parse-failed', severity: 'error' });
  // @ts-expect-error Affected ranges are immutable snapshots.
  references?.ranges.push({ from: 1, to: 2 });
} });
editor.i18n.t(pasteCleanupMessages.applied);
// @ts-expect-error Feedback ownership is a finite public option.
PasteCleanup.configure({ feedback: 'none' });
const pasteLimits: Partial<PasteHTMLLimits> = { maxInputLength: 20_000, maxDiagnostics: 10 };
const cleanedPaste: NormalizePasteHTMLResult = normalizePasteHTML('<p>Clipboard content</p>', {
  formatting: 'preserve',
  allowRemoteImages: false,
  allowDataImages: true,
  sourceURL: 'https://example.com/document',
  limits: pasteLimits,
});
const cleanedFromMain: MainPasteHTMLResult = normalizePasteFromMain('<p>Clipboard content</p>');
const pasteStatus: 'cleaned' | 'rejected' = cleanedPaste.status;
const pasteDiagnosticsTruncated: boolean = cleanedFromMain.diagnosticsTruncated;
// @ts-expect-error Unsupported formatting modes must not enter published options.
normalizePasteHTML('<p>Clipboard content</p>', { formatting: 'word' });
// @ts-expect-error Resource limits remain numeric in the published declaration graph.
normalizePasteFromMain('<p>Clipboard content</p>', { limits: { maxDepth: 'unlimited' } });

// Every built-in definition must retain its public parameter augmentation in dist.
type PublishedCoreMessages = CompleteMessages<typeof coreMessages>;
const builtinTranslations: Messages = {
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
editor.i18n.t(coreMessages.italic);
editor.i18n.t(coreMessages.groupInsert);
editor.i18n.t(coreMessages.headingLevel, { level: 2 });
// @ts-expect-error Built-in dynamic parameters remain checked after declaration bundling.
editor.i18n.t(coreMessages.headingLevel, { level: 'two' });
// @ts-expect-error Dynamic built-in messages require their parameters.
editor.i18n.t(coreMessages.headingLevel);
// @ts-expect-error Only declared searchable messages accept aliases.
editor.i18n.set({ searchAliases: { 'core.group.insert': ['Einfügen'] } });

resolveColorName(editor.i18n, 'blue');
resolveColorSwatch(editor.i18n, 'blue', 'bg');
resolveEmojiCategory(editor.i18n, 'Objects');
resolveEmojiLabel(editor.i18n, { name: 'smile', label: 'Custom', labelLanguage: 'en' });
matchesEmojiPresentation(editor.i18n, { name: 'smile', searchAliases: ['happy'] }, 'happy');
editor.i18n.t(coreMessages.emojiItemName, { name: 'smile' });
// @ts-expect-error Emoji display lookup preserves its stable string identity contract.
editor.i18n.t(coreMessages.emojiItemName, { name: 1 });
// @ts-expect-error Swatch variants are a finite presentation choice.
resolveColorSwatch(editor.i18n, 'blue', 'invalid');

observeI18nPresentation(editor.i18n, () => document.body, () => undefined)();

editor.i18n.t(emojiMessages.suggestionEmpty);
editor.i18n.set({ messages: { 'emoji.insert': 'Insert emoji', 'emoji.suggestion.label': 'Suggestions' } });

const itemCountMessage = defineMessage({
  id: 'app.itemCount',
  defaultValue: ({ count }, context) => `${context.number(count)} items`,
  description: 'A consumer-owned item count.',
  owner: 'app',
});
const selectedMessages: CompleteMessages<{ itemCount: typeof itemCountMessage }> = {
  'app.itemCount': ({ count }) => String(count),
};
const partialMessages: Messages = { 'core.toolbar.bold': 'Fett', ...selectedMessages };
editor.i18n.set({ locale: 'de', messages: partialMessages, searchAliases: { 'app.itemCount': ['items'] } });
editor.i18n.t(itemCountMessage, { count: 2 });
editor.i18n.refresh();
// @ts-expect-error Consumer message parameters remain checked in published declarations.
editor.i18n.t(itemCountMessage, { count: 'two' });
// @ts-expect-error Parameterized messages require their parameters.
editor.i18n.t(itemCountMessage);
// @ts-expect-error Unknown built-in IDs must not silently enter a partial catalog.
editor.i18n.set({ messages: { 'core.toolbar.bodl': 'Fett' } });

editor.commands.focus();
editor.commands.focus('end');
editor.commands.blur();
editor.commands.setContent('<p>hi</p>');
editor.commands.clearContent();
editor.commands.insertText('hi');
editor.commands.deleteSelection();
editor.commands.selectAll();
editor.commands.toggleMark('bold');
editor.commands.setMark('bold');
editor.commands.unsetMark('bold');
editor.commands.unsetAllMarks();
editor.commands.setBlockType('paragraph');
editor.commands.toggleBlockType('heading', 'paragraph');
editor.commands.wrapIn('blockquote');
editor.commands.toggleWrap('blockquote');
editor.commands.lift();
editor.commands.toggleList('bulletList', 'listItem');
editor.commands.insertContent('<p>hi</p>');
editor.commands.selectNodeBackward();
editor.commands.updateAttributes('paragraph', { textAlign: 'center' });
editor.commands.resetAttributes('paragraph', 'textAlign');

editor.commands.setBold();
editor.commands.unsetBold();
editor.commands.toggleBold();
editor.commands.setItalic();
editor.commands.unsetItalic();
editor.commands.toggleItalic();
editor.commands.setUnderline();
editor.commands.unsetUnderline();
editor.commands.toggleUnderline();
editor.commands.setStrike();
editor.commands.unsetStrike();
editor.commands.toggleStrike();
editor.commands.setCode();
editor.commands.unsetCode();
editor.commands.toggleCode();
editor.commands.setSubscript();
editor.commands.unsetSubscript();
editor.commands.toggleSubscript();
editor.commands.setSuperscript();
editor.commands.unsetSuperscript();
editor.commands.toggleSuperscript();
editor.commands.setLink({ href: 'https://example.com' });
editor.commands.unsetLink();
editor.commands.toggleLink({ href: 'https://example.com' });
editor.commands.setTextStyle({});
editor.commands.removeTextStyle();
editor.commands.removeEmptyTextStyle();

editor.commands.setHeading({ level: 1 });
editor.commands.toggleHeading({ level: 2 });
editor.commands.setParagraph();
editor.commands.setCodeBlock();
editor.commands.toggleCodeBlock();
editor.commands.setBlockquote();
editor.commands.toggleBlockquote();
editor.commands.unsetBlockquote();
editor.commands.setHorizontalRule();
editor.commands.toggleBulletList();
editor.commands.toggleOrderedList();
editor.commands.toggleTaskList();
editor.commands.turnIntoBulletList();
editor.commands.turnIntoOrderedList();
editor.commands.turnIntoTaskList();
editor.commands.toggleTask();
editor.commands.setHardBreak();
editor.commands.insertNbsp();

editor.commands.setBlockBgColor('red');
editor.commands.setBlockTextColor('red');
editor.commands.unsetBlockColors();
editor.commands.setFontFamily('Inter');
editor.commands.unsetFontFamily();
editor.commands.setFontSize('14px');
editor.commands.unsetFontSize();
editor.commands.setHighlight();
editor.commands.unsetHighlight();
editor.commands.toggleHighlight();
editor.commands.setBackgroundColorToken('red');
editor.commands.unsetBackgroundColorToken();
editor.commands.undo();
editor.commands.redo();
editor.commands.toggleInvisibleChars();
editor.commands.showInvisibleChars();
editor.commands.hideInvisibleChars();
editor.commands.setLineHeight('1.5');
editor.commands.unsetLineHeight();
editor.commands.setSelection({} as never);
editor.commands.selectNode({} as never);
editor.commands.selectParentNode();
editor.commands.extendSelection({} as never);
editor.commands.setTextAlign('center');
editor.commands.unsetTextAlign();
editor.commands.setTextColor('red');
editor.commands.unsetTextColor();
editor.commands.setTextColorToken('red');
editor.commands.unsetTextColorToken();

editor.commands.setDetails();
editor.commands.unsetDetails();
editor.commands.toggleDetails();
editor.commands.openDetails();
editor.commands.closeDetails();
editor.commands.setDetailsOpen(true);

editor.commands.insertEmoji({} as never);
editor.commands.suggestEmoji();

editor.commands.setImage({ src: 'x' });
editor.commands.setImageFloat('left');
editor.commands.setImageAlign('center');
editor.commands.deleteImage();
editor.commands.insertMarkdown('# hi');
editor.commands.setMarkdownContent('# hi');
editor.commands.setMarkdownContent('# hi', { emitUpdate: false });

editor.commands.insertMathInline('a^2');
editor.commands.insertMathBlock('a^2');

editor.commands.insertMention({} as never);
editor.commands.deleteMention();

editor.commands.insertTable({ rows: 2, cols: 2 });
editor.commands.deleteTable();
editor.commands.addRowBefore();
editor.commands.addRowAfter();
editor.commands.deleteRow();
editor.commands.addColumnBefore();
editor.commands.addColumnAfter();
editor.commands.deleteColumn();
editor.commands.toggleHeaderRow();
editor.commands.toggleHeaderColumn();
editor.commands.toggleHeaderCell();
editor.commands.mergeCells();
editor.commands.splitCell();
editor.commands.setCellAttribute('background', 'red');
editor.commands.goToNextCell();
editor.commands.goToPreviousCell();
editor.commands.fixTables();
editor.commands.setCellSelection({} as never);

editor.commands.scrollToHeading('heading-id');

editor.commands.printDocument();

editor.chain().focus().toggleBold().toggleItalic().run();
editor.can().toggleBold();

// Experimental BlockHandle extension points, type-checked against the built
// dist so option-shape drift breaks here before it breaks external plugins.
import { BlockHandle } from '@domternal/extension-block-controls';
import type { DropZoneProvider } from '@domternal/extension-block-controls';

declare const provider: DropZoneProvider;
BlockHandle.configure({
  dropZoneProviders: [provider],
  nested: { allowedNodes: ['paragraph'], anchorContainers: ['column'] },
});
