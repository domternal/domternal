# @domternal/extension-paste-cleanup

[![Version](https://img.shields.io/npm/v/@domternal/extension-paste-cleanup.svg)](https://www.npmjs.com/package/@domternal/extension-paste-cleanup)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/domternal/domternal/blob/main/LICENSE)

Clean clipboard HTML before it enters a [Domternal](https://domternal.dev) editor. Keep supported source formatting or adapt it to your editor's theme, with notices when content is removed or a paste is blocked.

Part of **Domternal Free**, introduced in **1.3.0**. Add it explicitly alongside StarterKit; it works with Vanilla, React, Vue and Angular editors. It handles clipboard HTML, including supported Word and Google Docs shapes. It does not import DOCX files or promise full source-document fidelity. The separate Pro DOCX importer remains unreleased.

[Documentation](https://domternal.dev/v1/extensions/paste-cleanup/) · [Source](https://github.com/domternal/domternal/tree/main/packages/extension-paste-cleanup/src) · [Support matrix](https://github.com/domternal/domternal/blob/main/e2e/native-office-capture/SUPPORT-MATRIX.md)

## Install

The package declares Node.js 22 or later for tooling.

For a new editor:

```bash
pnpm add @domternal/core @domternal/pm @domternal/theme @domternal/extension-paste-cleanup
```

For an existing editor, add `@domternal/extension-paste-cleanup` and keep installed Domternal Free packages on the same release. Version 1.3.0 requires `@domternal/core` and `@domternal/pm` peers in `>=1.3.0 <2.0.0`; Core 1.2.0 lacks the clipboard API it needs.

## Quick start

Add a mount element to your page:

```html
<div id="editor" class="dm-editor"></div>
```

Then initialize the editor in your application's browser entry point:

```ts
import { Editor, StarterKit } from '@domternal/core';
import { PasteCleanup } from '@domternal/extension-paste-cleanup';
import '@domternal/theme';

const editor = new Editor({
  element: document.getElementById('editor')!,
  extensions: [
    StarterKit,
    PasteCleanup.configure({ formatting: 'preserve' }),
  ],
  content: '<p>Paste content from a document here.</p>',
});

// When your application removes this editor:
// editor.destroy();
```

This provides paragraphs, headings, lists and basic marks. Add the corresponding extensions for tables, images, colors, fonts, alignment or other content your editor should retain. Table capability checks can block a paste that the destination cannot represent; other unsupported formatting produces diagnostics. Cleanup cannot add capabilities to the receiving schema.

The default nonmodal notice reports warnings and blocked input, with details and dismissal. The theme styles it. Clean pastes and intentional formatting adaptation stay quiet. Markdown, Link, SmartPaste and history keep their normal insertion behavior; plain text and code-block pastes keep their interpretation, subject to the limits below.

## Preserve or adapt formatting

| Policy | Behavior |
| --- | --- |
| `formatting: 'preserve'` (default) | Keep supported inline typography, alignment, structure and emphasis that the destination can represent. |
| `formatting: 'adapt'` | Remove external fonts, sizes, colors, alignment and line spacing while keeping structure and emphasis. |
| `preserveTextAlignment: true` | Keep supported source alignment when using `adapt`. |

For content that should follow your application's theme, replace the configuration above with:

```ts
PasteCleanup.configure({
  formatting: 'adapt',
  preserveTextAlignment: true,
});
```

Neither policy reproduces page layout or arbitrary stylesheets. Recognized copies between PasteCleanup editors on the same page retain editor formatting in both modes. See [HTML and formatting](https://github.com/domternal/domternal/blob/main/packages/extension-paste-cleanup/docs/html-normalization.md) and [lists](https://github.com/domternal/domternal/blob/main/packages/extension-paste-cleanup/docs/lists.md) for supported shapes and fallbacks.

## Observe the result

Add `onPasteResult` to your configuration to observe an operation after synchronous insertion processing settles:

```ts
PasteCleanup.configure({
  onPasteResult(result) {
    console.log(result.status, result.diagnostics);
  },
});
```

| Status | Meaning |
| --- | --- |
| `applied` | An accepted tagged transaction changed the document. |
| `rejected` | Cleanup blocked insertion. |
| `noop` | Nothing survived parsing, or an accepted transaction changed nothing. |
| `untracked` | No accepted receipt was found, for example with a custom handler. |

`applied` does not promise complete fidelity, and `untracked` does not prove nothing was inserted. `onResult` is an earlier normalization callback, not an insertion receipt. Both include an operation ID; diagnostics exclude source HTML. To render your own feedback, set `feedback: 'application'` and provide `onPasteResult`, which is required in that mode. See [feedback, callbacks and clipboard integration](https://github.com/domternal/domternal/blob/main/packages/extension-paste-cleanup/docs/clipboard-integration.md) for localization, affected ranges and custom-handler boundaries.

## Normalize HTML without an editor

The `/html` entry works without a browser DOM, Editor or ProseMirror instance:

```ts
import { normalizePasteHTML } from '@domternal/extension-paste-cleanup/html';

const result = normalizePasteHTML(
  '<p style="font-family: Arial; color: red"><strong>Hello</strong> world</p>',
  {
    formatting: 'adapt',
    limits: { maxInputLength: 500_000, maxTableCells: 5_000 },
  },
);

if (result.status === 'cleaned') {
  console.log(result.html, result.diagnostics);
} else {
  console.warn('Paste rejected', result.diagnostics);
}
```

The output is editor input, still subject to your destination schema, not a general HTML publication policy. Rejection returns empty HTML. Both entries support ESM and CommonJS. If you already import the editor extension, import `normalizePasteHTML` from the main entry too, to avoid loading a second normalizer bundle. See the [standalone API contract](https://github.com/domternal/domternal/blob/main/packages/extension-paste-cleanup/docs/html-normalization.md#standalone-api).

## Images, network access and limits

- Remote images are removed by default. `allowRemoteImages: true` keeps HTTP(S) references; rendering them can contact those hosts.
- `allowDataImages: true` retains bounded PNG, JPEG, GIF and static WebP data images when the destination supports them. SVG, APNG and animated WebP are removed. Match this to the Image extension's `allowBase64` policy.
- Local asset preparation is off by default. Use `imageAssets: { mode: 'embedded' }` for bounded local raster files, or an explicit application resolver for persistent storage. Mixed HTML needs application-supplied image bindings; there is no automatic Word/CID association. Image-only pastes can otherwise use the Image extension's existing upload or embedding behavior.
- The HTML normalizer performs no network requests. An explicitly configured resolver or the destination's existing Image upload handler can perform application-owned network work.

| Resource | Default ceiling |
| --- | ---: |
| Input length | 2,000,000 UTF-16 units |
| Parser allocations and generated tree nodes | 30,000 |
| Tree depth | 128 |
| Diagnostics | 100 |
| Expanded table cells | 20,000 |
| Images | 200 |
| Total declared raster pixels | 50,000,000 |

HTML limits can be lowered, not raised. Plain text and Markdown also have a conservative markup-token budget before conversion. A resource rejection inserts nothing; HTML is never truncated to fit. Cleanup is synchronous, and these ceilings are not memory or latency guarantees.

For configuration details, see [local clipboard images](https://github.com/domternal/domternal/blob/main/packages/extension-paste-cleanup/docs/images.md), [persistent image resolvers](https://github.com/domternal/domternal/blob/main/packages/extension-paste-cleanup/docs/image-resolver.md), and [limits, links and security](https://github.com/domternal/domternal/blob/main/packages/extension-paste-cleanup/docs/limits-and-security.md).

## Tested source boundaries

Historical native qualification covers bounded scenarios on macOS 26.5.2: Word 16.113.3 for Mac through Safari 26.5.2, Chrome 154 and Firefox 155, plus Google Docs web through Chrome 153. General stylesheet resolution, automatic Office image association and full Word layout are outside that qualification. Google Docs through Safari/Firefox, Word for Windows, Word on the web, LibreOffice and Collabora remain unqualified.

The [support matrix](https://github.com/domternal/domternal/blob/main/e2e/native-office-capture/SUPPORT-MATRIX.md) records source-specific limits, evidence provenance and the distinction between historical native qualification and current authored regression fixtures.

## License

[MIT](https://github.com/domternal/domternal/blob/main/LICENSE)
