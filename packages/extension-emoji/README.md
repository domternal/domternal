# @domternal/extension-emoji

[![Version](https://img.shields.io/npm/v/@domternal/extension-emoji.svg)](https://www.npmjs.com/package/@domternal/extension-emoji)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/domternal/domternal/blob/main/LICENSE)

Emoji input for the [Domternal](https://domternal.dev) editor: `:shortcode:`
conversion, optional emoticons, and an autocomplete dropdown. Includes two emoji
datasets, frequency tracking, and a DOM suggestion renderer. Use structured emoji
nodes or insert plain Unicode text.

[Documentation](https://domternal.dev/v1/nodes/emoji/) · [Live examples](https://domternal.dev/examples/)

## Install

The package declares Node.js 22 or later for tooling.

```bash
pnpm add @domternal/core @domternal/pm @domternal/extension-emoji @domternal/theme
```

Requires `@domternal/core` and `@domternal/pm` `>=1.3.0 <2.0.0`.
The theme styles the suggestion dropdown; you can supply your own styles instead.

## Quick start

Add a host, then run the TypeScript after it is mounted in a browser app that
supports CSS imports:

```html
<div class="dm-editor"><div id="editor"></div></div>
```

```ts
import { Editor, StarterKit } from '@domternal/core';
import {
  Emoji,
  emojis,
  createEmojiSuggestionRenderer,
} from '@domternal/extension-emoji';
import '@domternal/theme';

const editor = new Editor({
  element: document.getElementById('editor')!,
  extensions: [
    StarterKit,
    Emoji.configure({
      emojis,
      enableEmoticons: true,
      suggestion: { render: createEmojiSuggestionRenderer() },
    }),
  ],
  content: '<p>Try typing :smile: or an emoticon followed by a space.</p>',
});
```

Type `:` and a name to open suggestions. Use arrow keys to navigate, `Enter` to
insert, and `Escape` to dismiss. A complete shortcode such as `:smile:` converts
when its closing colon is typed. With emoticons enabled, `:)` or `<3` converts on
the following space, which is kept. These input rules do not run in code blocks or
inline code, and do not convert text already in the initial content.

Call `editor.destroy()` when removing the editor.

## Commands

```ts
editor.chain().focus().insertEmoji('fire').run();
editor.chain().focus().suggestEmoji().run();
```

`insertEmoji()` takes a dataset name, not a colon-delimited shortcode.
`suggestEmoji()` inserts the trigger and requires `suggestion` to be configured.
A compatible toolbar's emoji button emits an `insertEmoji` event: connect that
event to `suggestEmoji()` or your own picker. See the
[toolbar integration](https://domternal.dev/v1/nodes/emoji/#toolbar-items).

## Options and custom UI

| Option | Default | Use |
| --- | --- | --- |
| `emojis` | `emojis` | Use the curated dataset, the larger exported `allEmojis`, or your own `EmojiItem[]`. |
| `enableEmoticons` | `false` | Convert shortcuts such as `:)` and `<3`. |
| `plainText` | `false` | Insert Unicode text instead of an emoji atom node. |
| `suggestion` | `null` | Enable autocomplete and provide a renderer. Without it, shortcode input still works. |
| `toolbar` | `true` | Contribute the emoji toolbar button. |
| `HTMLAttributes` | `{}` | Attributes on serialized emoji spans. |

For custom suggestions, supply a `render` factory through `suggestion`. Storage at
`editor.storage.emoji` exposes `searchEmoji`, `findEmoji`, `getFrequentlyUsed`, and
`addFrequentlyUsed`. The lower-level `createSuggestionPlugin` and
`emojiSuggestionPluginKey` are also exported. See the
[suggestion reference](https://domternal.dev/v1/nodes/emoji/#suggestion-plugin)
for the renderer lifecycle and options.

## Localization

`emojiMessages` provides typed message keys. German `deMessages` and
`deSearchAliases` are exported from `@domternal/extension-emoji/locales/de`.
See the [localization guide](https://domternal.dev/v1/guides/i18n/) for combining
catalogs. Missing messages fall back to English; emoji names, shortcodes, and
custom dataset labels remain application-owned.
