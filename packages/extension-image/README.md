# @domternal/extension-image

[![Version](https://img.shields.io/npm/v/@domternal/extension-image.svg)](https://www.npmjs.com/package/@domternal/extension-image)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/domternal/domternal/blob/main/LICENSE)

Images for the [Domternal](https://domternal.dev) editor, with resizing, alignment,
text wrapping, alt text and file paste/drop support. Store files through your own
upload handler or embed them as data URLs. Images are block nodes by default;
inline images are optional.

[Documentation](https://domternal.dev/v1/nodes/image/) · [Examples](https://domternal.dev/examples)

## Install

The package declares Node.js 22 or later for tooling.

```bash
pnpm add @domternal/core @domternal/pm @domternal/extension-image @domternal/theme
```

Core and pm are peers with the range `>=1.3.0 <2.0.0`. Use version 1.3.1 for all
installed Domternal packages. The optional theme provides the resize handles and
placement styles; supply equivalent CSS if you omit it. Exported HTML includes
placement styles independently of the theme.

## Quick start

```html
<div id="editor" class="dm-editor"></div>
```

```ts
import { Editor, StarterKit } from '@domternal/core';
import { Image } from '@domternal/extension-image';
import '@domternal/theme';

const editor = new Editor({
  element: document.getElementById('editor')!,
  extensions: [StarterKit, Image],
  content: '<p>Paste an image or add one by URL.</p>',
});
```

Add an image using a URL your application serves:

```ts
editor.chain().focus().setImage({
  src: '/uploads/photo.jpg',
  alt: 'A mountain reflected in a lake',
}).run();
```

Call `editor.destroy()` when removing the editor. The extension contributes image
controls to Domternal's toolbar and bubble menu when those UI components are
mounted; a bare Core editor does not create those components.

## Upload files to your application

Without an upload handler, accepted files are embedded in the document as data
URLs. To store files elsewhere, replace `Image` in the extension array with a
configured instance. This example expects your own `/api/upload` endpoint to
return JSON containing a `url` string:

```ts
Image.configure({
  allowBase64: false,
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  maxFileSize: 5 * 1024 * 1024,
  maxFiles: 5,
  uploadHandler: async (file) => {
    const form = new FormData();
    form.append('file', file);
    const response = await fetch('/api/upload', { method: 'POST', body: form });
    if (!response.ok) throw new Error('Image upload failed');

    const result = await response.json() as { url?: unknown };
    if (typeof result.url !== 'string' || !result.url) {
      throw new Error('The upload endpoint did not return an image URL');
    }
    return result.url;
  },
  onUploadError: (error) => {
    console.error(error.message);
  },
});
```

The same MIME, size and count rules apply to pasted, dropped and file-picker
images. Validate uploads on your server too. Files keep their insertion order
while asynchronous uploads finish. Applications can style the
`.domternal-image-uploading` placeholder; the theme does not give it a visible
loading indicator. See [file insertion and undo](https://domternal.dev/v1/nodes/image/#how-files-are-inserted)
for selection replacement, cancellation and collaborative edits.

## Common options

| Option | Default | Purpose |
| --- | --- | --- |
| `inline` | `false` | Place images inside text instead of as blocks. |
| `placement` | `null` | Let the preset choose float or align controls; set `'float'` or `'align'` explicitly to override. |
| `allowBase64` | `true` | Accept image data URLs and embed files when no upload handler is supplied. |
| `uploadHandler` | `null` | Store a file and return its URL. |
| `maxFileSize` | `0` | Maximum bytes per file; `0` leaves size unlimited. |
| `maxFiles` | `10` | Maximum accepted files per operation; `0` removes the count limit. |
| `allowedMimeTypes` | JPEG, PNG, GIF, WebP, SVG, AVIF | MIME types accepted for files. |

With `allowBase64: false` and no `uploadHandler`, files cannot be inserted.
Remote image URLs can still be used. The [full option reference](https://domternal.dev/v1/nodes/image/#options)
also covers HTML attributes and upload callbacks.

## Commands and alt text

| Command | Purpose |
| --- | --- |
| `setImage({ src, alt, ... })` | Insert an image with its attributes. |
| `setImageFloat('left')` | Wrap text around the selected image. |
| `setImageAlign('center')` | Align the selected image without text wrapping. |
| `deleteImage()` | Remove the selected image. |

Float and align each accept `'none'`, `'left'`, `'center'` and `'right'`; setting
one clears the other. Commands operate on the current selection.

Use a descriptive `alt` for meaningful images. `alt: ''` marks an image as
decorative and renders `alt=""`; `null` means no description has been supplied
and omits the attribute. See [alt text editing](https://domternal.dev/v1/nodes/image/#editing-alt-text).

## Clipboard and source policy

A screenshot or image-only clipboard inserts image files. When copied content
has text of its own, the HTML/text takes priority so Word's picture of a copied
selection does not replace the actual content. Office HTML normalization is a
separate opt-in [PasteCleanup](https://github.com/domternal/domternal/tree/main/packages/extension-paste-cleanup)
feature; Image alone does not apply its raster or structural limits.

Built-in parsing, commands and rendering apply Core's URL policy. A refused
stored source remains in JSON but is not loaded by the node view. URL checks do
not inspect remote response bytes. See [image security](https://domternal.dev/v1/guides/security/#image-security)
and the [URL policy reference](https://github.com/domternal/domternal/blob/main/packages/core/docs/url-and-style-policy.md).

## More documentation

- [Image guide](https://domternal.dev/v1/nodes/image/): inline mode, popovers, resizing, file handling and node views.
- [Clipboard destinations](https://domternal.dev/v1/nodes/image/#clipboard-image-destination): cooperating with a custom image node.
- [Localization](https://domternal.dev/v1/guides/i18n/): `imageMessages` and optional `@domternal/extension-image/locales/de` catalogs. Authored alt text is never translated.

## License

[MIT](https://github.com/domternal/domternal/blob/main/LICENSE).
