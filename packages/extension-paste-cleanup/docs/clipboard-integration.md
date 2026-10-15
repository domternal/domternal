# Clipboard integration and paste feedback

Use this reference when integrating custom paste handlers, application feedback or affected ranges. Start with the [package quickstart](https://github.com/domternal/domternal/blob/main/packages/extension-paste-cleanup/README.md).

## Clipboard ownership

PasteCleanup registers single clipboard slots from the experimental
`@domternal/core/clipboard` subpath on each editor it is installed in: the copy
annotation always, and the HTML preparation when `imageAssets` or `formattingForPaste` is enabled. Core
accepts one registration per editor for each slot, and whichever registers second
fails:

- When another registration already holds a slot, PasteCleanup throws an
  `ExtensionConfigurationError` that names the slot and how to resolve the conflict,
  with Core's refusal as its `cause`, and releases anything it had already claimed.
  During `new Editor(...)`, where only an earlier plugin view can hold the slot, the
  constructor throws it and destroys the partially built view with that plugin view,
  so nothing of the failed editor keeps running. When a later reconfiguration
  recreates the plugin views with the other one first, the reconfiguring call throws
  it and the other registration keeps its slot.
- When PasteCleanup already holds a slot, the later `registerClipboardCopyAnnotation`
  or `registerClipboardHTMLPreparation` call receives Core's error, and PasteCleanup
  keeps the slot. A plugin view that makes that call during `new Editor(...)` fails
  the constructor with Core's error, and the teardown releases PasteCleanup as well.

To resolve a conflict, remove the other registration from that editor or leave
PasteCleanup out of it. For the HTML preparation, `imageAssets: false` with no
`formattingForPaste` leaves the slot to the other registration. `imageAssets` with `mode: 'resolver'` stages
pasted images in application storage without a separate preparation.

## Choose formatting for one paste

`formattingForPaste(context)` lets an application-owned control choose `preserve` or
`adapt` when a paste starts. The frozen context contains only `defaultFormatting`
and `origin`, either `native` or `programmatic`. It does not expose source HTML,
text, browser events, files or image metadata. Return synchronously; `undefined`,
an exception, an invalid value or a Promise retains the configured `formatting`
default. Rejected Promises are contained and never disable cleanup.

The choice is captured before clipboard preparation and host HTML transforms. It
belongs to that attempt, including event-free `view.pasteHTML(...)` and
`view.pasteText(...)` calls. A nested paste chooses independently. A deferred image
operation and its authorized replay retain their original choice even if the UI
changes while preparation is pending. `onResult` and `onPasteResult` report this
same policy; cancellation, Undo and Redo do not invoke the selector again.

An empty, intercepted or code-block paste can call the selector without producing
an HTML-cleanup result. The callback does not change routing: plain text, Markdown,
code blocks and recognized same-page own copies retain their existing semantics.
Drops, direct transform calls outside a paste and the standalone `/html` API use
the static `formatting` option. The control should be available before pasting;
this API does not retain the clipboard to offer a second-format paste afterward.

## Built-in notice

The default nonmodal notice displays warnings, removed-image guidance and blocked
input. It provides a details disclosure and dismissal without moving focus or
adding document content. A polite live region beside the notice, visually hidden
and present before any paste, announces each paste's title, also when two pastes
in a row share it. When Dismiss, Escape or Cancel hides the notice while focus is
in it, or while a pointer press left focus on the page, focus returns to the
editor with its selection. A clean paste or intentional
formatting adaptation alone stays quiet, including when its informational findings
fill the diagnostic allowance. When asynchronous image preparation is accepted,
the live region announces "Images pasted." once. A clean completion leaves the
visible notice hidden; cancelled, rejected and untracked operations never receive
that success announcement. Load the normal `@domternal/theme` CSS
for styling. The notice follows editor adoption and is removed on destruction.

Press `Alt+Shift+P` while editing to focus a visible notice, including from a list
that uses Tab for indentation. Escape dismisses it and returns to the stored
editor selection. `focusFeedbackShortcut` accepts a ProseMirror shortcut such as
`'Alt-F9'`, or `false` to disable this binding. The default is `'Alt-Shift-P'`.
It does not intercept composition or act when the notice is hidden, and does not
apply to application-owned feedback. A host that reserves the default shortcut
should configure another binding and explain it in its keyboard help.

The notice is an accessible group, not a separate landmark. Give each editor a
meaningful `aria-label` or `aria-labelledby` on its editable DOM element; the
notice combines "Paste notice" with that name. Valid `aria-labelledby` references
are resolved in the editor's current document or shadow root. Unnamed editors
use the generic "Paste notice" label. Clipboard text is never used as a UI label.

With the theme, the notice stays in view in a long document on a screen at
least `30rem` tall (480 px at the default font size): it sticks to the bottom of
the visible part of the editor, in the page or in an outer scroller, and settles
after the last line once the end of the document is in view. While it sticks, it
covers the lines behind it: a pointer reaches them after scrolling, and when the
keyboard or typing brings the selection behind the notice, PasteCleanup scrolls
on until the selection's line is above it. Showing it does not scroll the page or
take focus, and its place in the DOM, the keyboard order and the accessibility
tree stays the same. In a shorter viewport, such as a phone held sideways or a laptop screen
zoomed to 200 percent, a sticky notice would cover most of the view, so the
notice stays after the document there, as it does in print. While a notice shows
on such a screen, the theme clips the element the view mounts in with
`overflow: clip` instead of `hidden`, since a scroll container would hold a
sticky notice in place; engines without `clip` show the notice after the
document. That rule has the specificity of the theme's own rule for the element,
so an application rule that overrides the theme there, such as one that makes
the element scroll, still applies, and the notice then sticks inside it. An
application that styles the notice itself needs `position: sticky` and no scroll
container between the notice and the scroller.

## Application feedback and localization

Use `feedback: 'application'` with an `onPasteResult` handler to own presentation.
Omitting that handler is a fatal configuration error. English definitions are
exported as `pasteCleanupMessages`; the optional `/locales/de` entry exports
`deMessages` and `deSearchAliases`. Merge the catalog with your other per-editor
i18n messages. Visible notices update when the locale changes.

## Normalization and accepted results

`onResult` receives a result for HTML cleanup and rejected input. Its exceptions
cannot disable cleanup. The observer is not an insertion receipt: downstream
editor handlers may still reject the paste. Source HTML is not stored in editor
storage, diagnostics, or a remote service.

`onPasteResult` runs once in a microtask for each observed normalization operation,
including plain-text transforms. Its frozen result contains `operationId`,
`source`, `formatting`, `status`, bounded `diagnostics`, `diagnosticsTruncated` and
`references`, without source HTML. `onResult` includes the same operation ID and
formatting policy synchronously. An applied paste's result can refine these
diagnostics: it leaves out the heading warning of a pasted heading that merged
into the block at the caret, and adds `destination-formatting-removed` when
accepted appended processing demonstrably removes known formatting from an
identified insertion. This bounded check starts after parsing and does not prove
complete source fidelity. Equal-text replacements and other ambiguous changes
remain unverified, as [destination checks](https://github.com/domternal/domternal/blob/main/packages/extension-paste-cleanup/docs/html-normalization.md#destination-checks) describe.
Before insertion, the integration also probes bounded actual formatting values
against the destination parser and serializer. For example, a font size or line
height refused by a custom parser or rendering allowlist produces
`destination-formatting-unconfirmed` in both callbacks. This advisory warning
does not block the content and is different from the proven post-insertion
removal warning. Later custom HTML or slice transforms remain outside that
source-value proof.
Callback exceptions cannot revoke an accepted paste or disable cleanup.

| Status | Meaning |
| --- | --- |
| `applied` | A tagged paste transaction changed the installed editor document |
| `rejected` | Cleanup blocked the operation before insertion |
| `noop` | Nothing survived parsing, or an accepted transaction made no document change |
| `untracked` | No accepted receipt was found, for example after a plugin veto or a custom handler |

An empty cleaned slice preserves the selection instead of deleting selected text.

`untracked` does not prove that nothing was inserted. Custom asynchronous handlers
and legacy image-only routes that skip text/HTML transforms are outside this receipt
contract. The optional `imageAssets` coordinator does track its image-only route.
`applied` does not establish complete source or destination-schema fidelity.

Image-file routing has separate receipt boundaries; see [image files and cleaned content](https://github.com/domternal/domternal/blob/main/packages/extension-paste-cleanup/docs/images.md#image-files-and-cleaned-content).

## Affected references

`getPasteAffectedReferences(editor.view, operationId)` reads the latest installed
state. References use `precision: 'operation'` and describe changed transaction
regions, not exact diagnostic or comment anchors. Outside edits map their positions;
interior edits, undo, replacement or unsupported custom steps can expire them.
Check `expired` before using ranges, and reacquire them after document changes.
The store retains the most recent 16 accepted operations and at most 32 regions
per operation. A missing or destroyed receipt returns `undefined`. References are
ephemeral and must not be persisted or used to reapply formatting to edited content.

The receipt references are experimental and may change in a minor release:
`getPasteAffectedReferences`, `PasteAffectedReferences`, `PasteAffectedRange` and
the `references` field of `PasteOperationResult` carry `@experimental`.
