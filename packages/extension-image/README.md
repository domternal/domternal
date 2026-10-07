# @domternal/extension-image

[![Version](https://img.shields.io/npm/v/@domternal/extension-image.svg)](https://www.npmjs.com/package/@domternal/extension-image)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/domternal/domternal/blob/main/LICENSE)

An image node for the [Domternal](https://domternal.dev) editor: corner-handle
resizing, two placements (float, where text wraps beside the picture, and align, where
the picture moves within the measure and the text stays below it, both taking `none`,
`left`, `center`, `right`), paste and
drag-and-drop file upload through your own `uploadHandler`, a markdown
`![alt](src "title")` input rule, and defense-in-depth XSS validation on `src`
(blocks `javascript:`, `vbscript:`, `file:`, and non-image `data:` URLs across
parse, render, command, and input-rule layers). Block-level by default, optional
`inline` mode.

## Links

<u>[Website](https://domternal.dev)</u> &nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp; <u>[Documentation](https://domternal.dev/v1/nodes/image)</u> &nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp; <u>[Live examples](https://domternal.dev/examples)</u>

## Install

```bash
pnpm add @domternal/extension-image
```

`@domternal/core` and `@domternal/pm` are peer dependencies (you already have
them if you are building a Domternal editor).

The node view only writes `data-float` / `data-align` attributes and bare corner
handles, so [`@domternal/theme`](https://www.npmjs.com/package/@domternal/theme), or
equivalent CSS of your own, is what makes placement and resizing visible in the editor.
Exported HTML carries its own inline styles either way.

Version 1.2.0 requires both `@domternal/core` and `@domternal/pm` in the range
`>=1.2.0 <2.0.0`. Upgrade these packages together with this extension.

## Usage

```ts
import { Editor, Document, Paragraph, Text } from '@domternal/core';
import { Image } from '@domternal/extension-image';
import '@domternal/theme';

const editor = new Editor({
  extensions: [
    Document,
    Paragraph,
    Text,
    Image.configure({
      // Optional: enables paste/drop upload. Return the stored URL.
      uploadHandler: async (file) => {
        const form = new FormData();
        form.append('file', file);
        const res = await fetch('/api/upload', { method: 'POST', body: form });
        const { url } = (await res.json()) as { url: string };
        return url;
      },
    }),
  ],
});

// Insert an image
editor.commands.setImage({ src: 'https://example.com/photo.jpg', alt: 'A photo' });

// Wrap text around the selected image
editor.commands.setImageFloat('left');

// Or move it within the measure, with the text staying below it
editor.commands.setImageAlign('center');

// Remove the selected image
editor.commands.deleteImage();
```

## Options

`Image.configure({ ... })` accepts:

- `inline` (`boolean`, default `false`) - render images inline within paragraphs instead of as block nodes.
- `placement` (`'float' | 'align'` or `null`, default `null`) - which placement set the bubble menu offers. `null` follows the editor: `preset: 'notion'` offers align, `'classic'` offers float.
- `allowBase64` (`boolean`, default `true`) - permit `data:image/` URLs; when `false`, only non-data sources are allowed, and without an `uploadHandler` pasted, dropped and chosen files are not stored at all.
- `uploadHandler` (`(file: File) => Promise<string>` or `null`, default `null`) - stores pasted, dropped and chosen image files and returns their URL; without it, files are read as `data:` URLs when `allowBase64` allows it.
- `allowedMimeTypes` (`string[]`) - MIME types accepted for upload (defaults to `image/jpeg`, `image/png`, `image/gif`, `image/webp`, `image/svg+xml`, `image/avif`).
- `maxFileSize` (`number`, default `0`) - max upload size in bytes; `0` means unlimited.
- `maxFiles` (`number`, default `10`) - the most image files one paste, drop or file choice inserts: the first ones of an accepted type and size, in order; the others are left out. Every file is read or uploaded at once and, without an `uploadHandler`, stored in the document as a `data:` URL, so the limit keeps a dropped folder of photos from filling the document. `0` inserts every file.
- `onUploadStart` / `onUploadError` - callbacks fired when an upload through `uploadHandler` begins, and when storing a file fails: an upload that rejects or throws, a file that cannot be read, or a returned source `setImage` would refuse, including none (a `RangeError`). `onUploadError` runs after the other images of the paste or drop are placed. An error either callback throws is reported through the editor's `error` event (`onError`) with the context `Image.onUploadStart` or `Image.onUploadError`, and never stops or holds back an image. An `uploadHandler` that returns the URL itself instead of a promise is read as `await` reads it.
- `HTMLAttributes` (`Record<string, unknown>`) - attributes merged onto the rendered `<img>`.

### Image sources

Sources go through the core URL policy (`checkUrl` from `@domternal/core`) with the image profile,
which reads an address the way a browser does: leading and trailing spaces and controls are
stripped and tabs and line breaks removed before the scheme is judged. Any scheme is allowed except
`javascript:`, `vbscript:`, `data:` other than an image with `allowBase64`, and `file:`; relative
and network-path sources, `blob:` and custom schemes such as `app://` keep working. An address with
credentials in a web address, a control character or bidi override anywhere, or a format
character such as a zero-width joiner in its scheme or host is refused, and so is a relative source
whose first segment holds a character reference, such as `&#106;avascript:x` or `javascript&colon;x`,
which HTML that leaves `&` unescaped would decode into a scheme. A plain `&`, as in `R&D-chart.png`
or `images/Q&A.png`, keeps working.

- HTML parsing stores an allowed source in its cleaned spelling and a refused one as no source.
- `setImage` and the Markdown input rule refuse a source the policy refuses.
- A stored source, such as one loaded from JSON, renders in its cleaned spelling; a refused one
  renders `src=""` in `getHTML()` and `generateHTML()`, and the node view does not load it.
- `null` and `''` mean no source, as before.

## Commands

- `setImage(attributes: SetImageOptions)` - insert an image (`src` required; optional `alt`, `title`, `width`, `height`, `loading`, `crossorigin`, `float`, `align`).
- `setImageFloat(float: ImageFloat)` - set wrapping on the selected image (`'none' | 'left' | 'right' | 'center'`).
- `setImageAlign(align: ImageAlign)` - set alignment on the selected image (`'none' | 'left' | 'center' | 'right'`).
- `deleteImage()` - delete the selected image.

Float and align are one choice on a node, so setting either clears the other. Alignment
serializes as `data-align` plus block margins, never a float, so exported HTML lands
correctly with no theme loaded. `ImageFloat`, `ImageAlign`, `ImagePlacement`,
`SetImageOptions`, and `ImageOptions` are exported, along with `imageUploadPluginKey`,
whose plugin state is the `DecorationSet` of the placeholders of files being stored.

## Alt text

A string describes the image. An empty string marks a decorative image, which assistive
technology skips: it renders as `alt=""` in the editor, `getHTML()` and `generateHTML()`, and
parses back as `''`. `null`, the default, means the image has no description yet and renders no
`alt`, also after a resize or another update of the image. Typing `![](src)` and clearing the field
in the Edit alt text menu store `null`; content with `alt=""`, `setImage({ src, alt: '' })` and
`updateAttributes('image', { alt: '' })` store `''`. Applying the Edit alt text menu with its field
unchanged changes nothing.

## Editing UI

The user-facing counterpart to the commands above:

- Selecting an image opens a bubble menu with placement controls, an "Edit alt text" action, and Delete. The menu offers exactly one placement set: wrapping (Inline / Float left / Center / Float right) under the classic preset, alignment (Align left / Align center / Align right) under `preset: 'notion'`, or whichever the `placement` option pins.
- The main toolbar and the slash (floating) menu both expose an "Image" action that opens a popover with a URL field and a button to browse for a local file. Alt text is set afterward: the bubble menu's "Edit alt text" action reopens the same popover with a single alt field, pre-filled from the image.
- Pasted, dropped and chosen image files take one path. Every file of an accepted type and size gets a placeholder and is stored through `uploadHandler`, or read as a `data:` URL when `allowBase64` allows it. The placeholder is a widget decoration, an empty `div` with the class `domternal-image-uploading`, which `@domternal/theme` does not style, so it shows nothing until the application's CSS gives it a size and a loading indicator. The images replace their placeholders in the order the files came, however the stores finish; a block image moves out of the start or end of a textblock instead of splitting it, so no empty paragraphs appear, and splits it only in the middle; inside a code block it goes after the block instead of splitting the code. A paste replaces the selection, and over a cell selection clears the selected cells and places the images in the first of them; a block image pasted into a text-only block whose node places pasted blocks elsewhere through `@domternal/core/clipboard`, such as a details summary, goes where that node puts them, in the transaction that adds its placeholder; a drop inserts at the drop position, which follows edits made while the files are stored, and images join the undo history as they land: the replaced selection and the images that land within half a second after it undo together, also when a block image lands beside the textblock the selection was in, while an upload that takes longer, or an edit in between, makes its image a separate undo step; a paste over selected text whose every upload fails leaves the text deleted until undone. A file chosen with the popover's browse button goes where the URL field's `setImage` puts an image: in a list or task item's label, at the top level after the item, splitting the list, and never into a code block, where the button opens no file dialog. A file whose store fails is skipped and reported to `onUploadError`. An image is dropped when its placeholder was deleted by a change across it, such as a selection over it that is deleted; deleting the text right before or after it keeps it. In a shared document, a remote change that a collaboration binding such as y-prosemirror applies as one replace of the whole document leaves a placeholder in place wherever the content around it is unchanged.
- A paste inserts the clipboard's image files only when the pasted content has no text of its own, the rule `pasteHasOwnText` of `@domternal/core/clipboard` decides: white space and invisible format characters do not count, nor a plain-text clipboard that only names its image files in order, as a file manager copies them: by name, path or `file:` URL, in any Unicode normalization form, such as the decomposed accents macOS writes. So a copied image (an `<img>` next to its file), a screenshot or a file copy inserts the file, while a copy from Word or Excel, which puts a picture of the selection next to its text, pastes the text; a Word or Excel copy that places no image, such as empty paragraphs or cells, keeps its content too, since the file Chrome exposes next to it is Word's picture of the selection. With one file and one image in the pasted content, the inserted image keeps that image's alt text, and a one-line address that only names a copied image inserts the file instead of a link. A drop inserts its image files whatever else it carries, with the alt text of the one image the drop held for one file. Paste Cleanup follows the same rule and hands over the files the same way, with the alt text it left in place of the one image it removed; Word's hidden text it left out counts as text, so a picture of the selection that can show it is never inserted.
- With `allowBase64: false` and no `uploadHandler`, no file is stored: a paste or drop of files alone inserts nothing and is taken, so the browser inserts nothing either, and the popover hides its file button. A drop of image files alone that no configuration accepts is taken too, so the browser does not open the file.

## Clipboard image destination

The image node registers its live policy (node type, `src` attribute, `inline`, `allowBase64`,
`allowedMimeTypes` and `maxFileSize`) as the editor's clipboard image destination through the
experimental `@domternal/core/clipboard` subpath. Clipboard preparation, such as
[`@domternal/extension-paste-cleanup`](https://github.com/domternal/domternal/tree/main/packages/extension-paste-cleanup) (in development)
with `imageAssets`, reads it to decide where pasted local images may go. The registration
follows the plugin view and is removed when the editor is destroyed.

A custom image-like node registers its own policy with `registerClipboardImageDestination`.
Destinations form a latest-wins stack, so both can live in one schema: the latest active
registration applies, disposing it restores the one registered before it, and disposing an
earlier one leaves the latest in place. Plugin views register in extension priority order, so a
node with a lower priority than the image node's default of 100, or the same priority and listed
after it, registers later and takes precedence.

## Localization

This package exports `imageMessages` for typed custom catalogs. Optional German UI
messages and search aliases are available from `@domternal/extension-image/locales/de`
as `deMessages` and `deSearchAliases`. Merge them with the core and other enabled feature
catalogs. Missing entries fall back to English. Image URLs, titles, and authored alt text
are never translated.
