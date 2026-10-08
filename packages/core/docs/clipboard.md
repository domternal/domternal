# Clipboard coordination for extension authors

Use these APIs only when writing an extension that cooperates with other paste or copy handlers. Applications that install Image, Details or PasteCleanup do not need to register clipboard hooks themselves.

[Core overview](../README.md) · [Content normalization](content.md) · [URL and style policy](url-and-style-policy.md)

## Registering clipboard behavior

Extensions that cooperate on paste and copy, such as
[`@domternal/extension-paste-cleanup`](https://github.com/domternal/domternal/tree/main/packages/extension-paste-cleanup)
and the image extension, coordinate through the `@domternal/core/clipboard` subpath. Most
applications never import it. A custom image node uses it to declare where pasted images may go:

```ts
import { registerClipboardImageDestination } from '@domternal/core/clipboard';
```

- Every name on the subpath is `@experimental` and can change before it is declared stable. The
  main `@domternal/core` entry does not declare them.
- The subpath shares its registries with the main entry of the same installed copy and module
  format. ESM and CommonJS builds loaded side by side keep separate registries, so load one format.
- A view accepts one HTML preparation coordinator and one copy annotation. A second registration
  throws instead of taking over, so the active owner disposes first.
- Image destinations are a latest-wins stack instead, so a schema with two image-like node types
  can register both. The latest active `registerClipboardImageDestination` applies, disposing it
  restores the one registered before it, and disposing an earlier one leaves the latest in place.
  Precedence follows registration time: plugin views register in plugin order, which follows
  extension priority, and plugin views recreated by a reconfiguration register again above any
  registration made directly. When the latest policy reader throws or returns `undefined`, the
  view has no destination; an earlier registration is not a fallback.
- Paste placements are a stack too, asked from the latest registration down. A node whose
  textblock takes text only, inside a parent that takes no block beside it, can register one
  with `registerClipboardPastePlacement(view, place)` to say where content pasted into that
  textblock goes. A paste handler that builds its own transaction starts it from
  `placeClipboardPaste(view, content)`, with the whole nodes it will insert: the transaction of
  the first placement that moves the paste, whose selection is where the content belongs, or
  `undefined` to insert at the selection. The placement is then part of the paste's one
  transaction, so a paste that a transaction filter refuses leaves nothing behind, and undo takes
  it back in one step. A placement that throws, or returns a transaction that does not start from
  the view's current state, counts as none.
- One rule decides when a paste's image files are the paste. `pasteHasOwnText(event, slice)`
  says whether the pasted content has text of its own: characters that show nothing (white space,
  a no-break space and Unicode format characters such as zero-width spaces and joiners or the
  soft hyphen) do not count, nor alt text a handler left in place of images it removed, nor a
  plain-text clipboard without HTML whose lines are exactly its image files' names, as a file
  manager copies files. Without text of its own, `pasteClipboardImageFiles(view, event, slice)`
  hands every image file, in clipboard order, to the latest destination's `insertFiles` (the
  optional third argument of `registerClipboardImageDestination`), with the alt text of the one
  image the content held when there is one image and one file and that alt text is not empty, and
  returns whether it took them. An empty `alt`, which marks a decorative image, leaves the file
  without alt text.
  `dropClipboardImageFiles(view, event, slice)` does the same for a drop at its position, where
  the files win over whatever else the drop carries.
  A paste whose content has text of its own keeps that content, because Office applications put
  a picture of the copied selection next to it. So does a Word or Excel copy that
  places no image (HTML whose first 8,192 characters, as written and as the browser parses them,
  have a `ProgId` meta that names `Word.Document` or `Excel.Sheet` or an element that declares
  Word's or Excel's namespace, and that places no `img` element or VML image data, nor an image tag
  in Office's conditional comments, where Office writes only markup; text, attribute values and
  other comments that name them do not count), such as a copy of
  empty paragraphs or cells: Chrome exposes Word's picture of the selection as a file next to it.
  Only those first 8,192 characters are parsed: past them an image tag counts wherever it is
  written, since a browser's parser can take seconds over a few hundred kilobytes of crafted markup.
  Metadata is read in a detached document without a browsing context, and its parsed nodes
  never enter the live editor. This classification does not sanitize the pasted content.
  On a page whose Trusted Types refuse the browser's parser, as Chromium and WebKit do without a
  default policy, the rule reads the HTML as written instead, so text that names them counts there.
  Text a handler removed counts as text of its own when the handler says so (`removedText`), as
  Paste Cleanup does for Word's hidden text: the picture of the selection can show it, so it is
  neither a paste's files nor, for `dropClipboardImageFiles`, a drop's.
  The Image extension, Paste Cleanup and the Link paste all ask this rule, so their paste handlers
  cannot disagree.

## Pasted clipboard context

HTML copied from a ProseMirror editor carries its structural context in a `data-pm-slice`
attribute on its first element: the open depths and the wrapper nodes, such as lists, list items,
blockquotes and table parts, that the copied content sat in. Any page can write that attribute,
and ProseMirror rebuilds the wrappers around the pasted content without checking that they can hold
it. Core treats the context as structure, never as trust, for every paste and drop, with or without
PasteCleanup:

- A context ProseMirror's copy does not write for Domternal's nodes is ignored. After every
  `transformPastedHTML` has run, a context that names a paragraph, heading or other textblock, an
  inline or leaf node, text or the document, one of more than 512 wrappers, or one that is not a
  JSON array, is emptied, so the HTML pastes as it would without a context. Only the marker's value
  is rewritten: the open depths and a table wrapper count stay, and the rest of the HTML is kept as
  written. ProseMirror records a textblock or an inline node only for content copied from inside
  an inline node with content, which no Domternal node has; such content pastes as it would without
  the context.
- A wrapper that cannot hold its content is removed from the pasted or dropped slice, so the
  slice fits the schema instead of throwing inside ProseMirror's replace.
- Once ProseMirror starts parsing a paste or drop, core prevents the browser's default action. A
  paste handler that throws later, whether core's, an extension's or the application's, then
  inserts nothing and the error surfaces, instead of the browser inserting the raw clipboard HTML
  and requesting its remote images. Composition input, read-only editors, pastes without clipboard
  data and events a handler already claimed are left as before.
