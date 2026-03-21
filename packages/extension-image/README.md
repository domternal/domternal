# @domternal/extension-image

Image extension for Domternal with paste/drop upload, URL input, XSS protection, and bubble menu controls.

Part of the [Domternal](https://github.com/domternal/domternal) toolkit. Full docs at [domternal.dev](https://domternal.dev).

## Installation

```bash
npm install @domternal/core @domternal/extension-image
```

## Usage

```ts
import { Editor, StarterKit } from '@domternal/core';
import { Image } from '@domternal/extension-image';

const editor = new Editor({
  element: document.getElementById('editor')!,
  extensions: [
    StarterKit,
    Image.configure({
      allowBase64: true,
      uploadHandler: async (file) => {
        // Upload the file and return the URL
        const url = await myUploadService(file);
        return url;
      },
    }),
  ],
});

// Insert an image programmatically
editor.commands.setImage({ src: 'https://example.com/photo.jpg', alt: 'A photo' });

// Float image to the left
editor.commands.setImageFloat('left');
```

### Options

| Option | Default | Description |
|---|---|---|
| `inline` | `false` | When `true`, images render inline within paragraphs |
| `allowBase64` | `true` | Allow `data:image/` URLs. When `false`, only `http(s)` URLs are accepted |
| `uploadHandler` | `null` | Async function that receives a `File` and returns a URL string. Enables paste/drop upload |

### Commands

- `setImage({ src, alt?, title?, width?, height?, float? })` - insert or update an image
- `setImageFloat('left' | 'right' | 'center' | 'none')` - set text wrapping
- `deleteImage()` - remove the selected image

## License

[MIT](https://github.com/domternal/domternal/blob/main/LICENSE)
