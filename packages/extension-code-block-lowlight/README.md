# @domternal/extension-code-block-lowlight

Syntax-highlighted code blocks for the Domternal editor, powered by [lowlight](https://github.com/wooorm/lowlight) (highlight.js).

Part of the [Domternal](https://github.com/domternal/domternal) toolkit. Full docs at [domternal.dev](https://domternal.dev).

## Installation

```bash
npm install @domternal/core @domternal/extension-code-block-lowlight lowlight
```

## Usage

```ts
import { Editor, StarterKit } from '@domternal/core';
import { CodeBlockLowlight } from '@domternal/extension-code-block-lowlight';
import { createLowlight, common } from 'lowlight';

const lowlight = createLowlight(common);

const editor = new Editor({
  element: document.getElementById('editor')!,
  extensions: [
    StarterKit.configure({ codeBlock: false }), // disable the default CodeBlock
    CodeBlockLowlight.configure({ lowlight }),
  ],
});
```

### Options

| Option | Default | Description |
|---|---|---|
| `lowlight` | (required) | A lowlight instance created with `createLowlight()` |
| `defaultLanguage` | `null` | Default language when none is specified |
| `autoDetect` | `true` | Auto-detect language when none is specified |
| `tabIndentation` | `true` | Tab key inserts spaces inside code blocks |
| `tabSize` | `2` | Number of spaces per tab |

### Server-Side Rendering

Use `generateHighlightedHTML` to produce syntax-highlighted HTML on the server:

```ts
import { generateHighlightedHTML } from '@domternal/extension-code-block-lowlight';

const html = generateHighlightedHTML(jsonContent, { lowlight });
```

## License

[MIT](https://github.com/domternal/domternal/blob/main/LICENSE)
