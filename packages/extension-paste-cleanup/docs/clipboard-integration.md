# Clipboard integration and paste feedback

Use this reference when integrating custom paste handlers, application feedback or affected ranges. Start with the [package quickstart](https://github.com/domternal/domternal/blob/main/packages/extension-paste-cleanup/README.md).

## Clipboard ownership

PasteCleanup registers single clipboard slots from the experimental
`@domternal/core/clipboard` subpath on each editor it is installed in: the copy
annotation always, and the HTML preparation when `imageAssets` is enabled. Core
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
PasteCleanup out of it. For the HTML preparation, `imageAssets: false` leaves the
slot to the other registration, and `imageAssets` with `mode: 'resolver'` stages
pasted images in application storage without a separate preparation.

## Built-in notice

The default nonmodal notice displays warnings, removed-image guidance and blocked
input. It provides a details disclosure and dismissal without moving focus or
adding document content. A polite live region beside the notice, visually hidden
and present before any paste, announces each paste's title, also when two pastes
in a row share it. When Dismiss, Escape or Cancel hides the notice while focus is
in it, or while a pointer press left focus on the page, focus returns to the
editor with its selection. A clean paste or intentional
formatting adaptation alone stays quiet, including when its informational findings
fill the diagnostic allowance. Load the normal `@domternal/theme` CSS
for styling. The notice follows editor adoption and is removed on destruction.

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
formatting policy synchronously. Both list the same diagnostics, except that an
applied paste's result leaves out the heading warning of a pasted heading that
merged into the block at the caret, as [destination checks](https://github.com/domternal/domternal/blob/main/packages/extension-paste-cleanup/docs/html-normalization.md#destination-checks) describe.
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
