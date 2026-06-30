# @domternal/extension-image

[![Version](https://img.shields.io/npm/v/@domternal/extension-image.svg)](https://www.npmjs.com/package/@domternal/extension-image)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/domternal/domternal/blob/main/LICENSE)

An image node for the [Domternal](https://domternal.dev) editor: corner-handle
resizing, float/text-wrapping controls (`left`, `center`, `right`), paste and
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

## Usage

```ts
import { Editor, Document, Paragraph, Text } from '@domternal/core';
import { Image } from '@domternal/extension-image';

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

// Wrap text around it
editor.commands.setImageFloat('left');

// Remove the selected image
editor.commands.deleteImage();
```

## Options

`Image.configure({ ... })` accepts:

- `inline` (`boolean`, default `false`) - render images inline within paragraphs instead of as block nodes.
- `allowBase64` (`boolean`, default `true`) - permit `data:image/` URLs; when `false`, only non-data sources are allowed.
- `uploadHandler` (`(file: File) => Promise<string>` or `null`, default `null`) - when set, enables image upload on paste and drop.
- `allowedMimeTypes` (`string[]`) - MIME types accepted for upload (defaults to common image types).
- `maxFileSize` (`number`, default `0`) - max upload size in bytes; `0` means unlimited.
- `onUploadStart` / `onUploadError` - callbacks fired when an upload begins or fails.
- `HTMLAttributes` (`Record<string, unknown>`) - attributes merged onto the rendered `<img>`.

## Commands

- `setImage(attributes: SetImageOptions)` - insert an image (`src` required; optional `alt`, `title`, `width`, `height`, `loading`, `crossorigin`, `float`).
- `setImageFloat(float: ImageFloat)` - set wrapping on the selected image (`'none' | 'left' | 'right' | 'center'`).
- `deleteImage()` - delete the selected image.
