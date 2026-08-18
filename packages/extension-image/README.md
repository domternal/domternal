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
- `allowBase64` (`boolean`, default `true`) - permit `data:image/` URLs; when `false`, only non-data sources are allowed.
- `uploadHandler` (`(file: File) => Promise<string>` or `null`, default `null`) - when set, enables image upload on paste and drop.
- `allowedMimeTypes` (`string[]`) - MIME types accepted for upload (defaults to `image/jpeg`, `image/png`, `image/gif`, `image/webp`, `image/svg+xml`, `image/avif`).
- `maxFileSize` (`number`, default `0`) - max upload size in bytes; `0` means unlimited.
- `onUploadStart` / `onUploadError` - callbacks fired when an upload begins or fails.
- `HTMLAttributes` (`Record<string, unknown>`) - attributes merged onto the rendered `<img>`.

## Commands

- `setImage(attributes: SetImageOptions)` - insert an image (`src` required; optional `alt`, `title`, `width`, `height`, `loading`, `crossorigin`, `float`, `align`).
- `setImageFloat(float: ImageFloat)` - set wrapping on the selected image (`'none' | 'left' | 'right' | 'center'`).
- `setImageAlign(align: ImageAlign)` - set alignment on the selected image (`'none' | 'left' | 'center' | 'right'`).
- `deleteImage()` - delete the selected image.

Float and align are one choice on a node, so setting either clears the other. Alignment
serializes as `data-align` plus block margins, never a float, so exported HTML lands
correctly with no theme loaded. `ImageFloat`, `ImageAlign`, `ImagePlacement`,
`SetImageOptions`, and `ImageOptions` are exported, along with `imageUploadPluginKey`,
whose plugin state is the `DecorationSet` of in-flight upload placeholders.

## Editing UI

The user-facing counterpart to the commands above:

- Selecting an image opens a bubble menu with placement controls, an "Edit alt text" action, and Delete. The menu offers exactly one placement set: wrapping (Inline / Float left / Center / Float right) under the classic preset, alignment (Align left / Align center / Align right) under `preset: 'notion'`, or whichever the `placement` option pins.
- The main toolbar and the slash (floating) menu both expose an "Image" action that opens a popover with a URL field and a button to browse for a local file. Alt text is set afterward: the bubble menu's "Edit alt text" action reopens the same popover with a single alt field, pre-filled from the image.
- When `uploadHandler` is set, pasting or dropping an image file uploads it through the handler and inserts the returned URL. Without an `uploadHandler`, pasted and dropped images are inlined as base64 `data:` URLs.
