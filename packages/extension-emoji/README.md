# @domternal/extension-emoji

[![Version](https://img.shields.io/npm/v/@domternal/extension-emoji.svg)](https://www.npmjs.com/package/@domternal/extension-emoji)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/domternal/domternal/blob/main/LICENSE)

Inline emoji for the [Domternal](https://domternal.dev) editor. Adds an atom
`emoji` node with `:shortcode:` input rules, optional emoticon shortcuts (`:)`,
`<3`), and a **headless** suggestion plugin that powers autocomplete dropdowns on
a `:` trigger. Ships a curated ~200-emoji dataset (`emojis`) plus an extended
~500-emoji set (`allEmojis`), the `emoticons` mapping table, built-in frequency
tracking, and a framework-free vanilla DOM renderer. No external suggestion library
required.

## Links

<u>[Website](https://domternal.dev)</u> &nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp; <u>[Documentation](https://domternal.dev/v1/nodes/emoji)</u> &nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp; <u>[Live examples](https://domternal.dev/examples)</u>

## Install

```bash
pnpm add @domternal/extension-emoji
```

`@domternal/core` and `@domternal/pm` are peer dependencies (installed with the
editor itself).

## Usage

```ts
import { Editor, Document, Text, Paragraph } from '@domternal/core';
import { Emoji, emojis, createEmojiSuggestionRenderer } from '@domternal/extension-emoji';

const editor = new Editor({
  extensions: [
    Document,
    Text,
    Paragraph,
    Emoji.configure({
      emojis,
      enableEmoticons: true,
      suggestion: { render: createEmojiSuggestionRenderer() },
    }),
  ],
  content: '<p>Type :smile: or :) to insert an emoji.</p>',
});
```

Typing `:smile:` converts to an emoji node as soon as the closing colon lands. With
`enableEmoticons: true`, emoticons like `:)` and `<3` convert on the space typed after
them, and that space is kept. Neither rule fires inside a code block or inline code.
Typing `:` followed by a name opens the suggestion dropdown (when a `render` factory is
provided).

> The default suggestion dropdown is styled by `@domternal/theme`
> (`_emoji-picker.scss`, via the `dm-emoji-suggestion` classes). Import the theme,
> or supply your own `render` factory if you want fully custom markup.

## Commands

```ts
editor.commands.insertEmoji('fire'); // insert by EmojiItem name (not shortcode)
editor.commands.suggestEmoji();        // inserts the ':' trigger to open the picker (requires suggestion configured)
```

## Options

- `emojis` - dataset to use. Defaults to the built-in ~200 popular emoji; pass
  `allEmojis` for the extended ~500-emoji set, or your own `EmojiItem[]`.
- `enableEmoticons` - convert text emoticons like `:)` and `<3`. Default `false`.
- `plainText` - insert the raw emoji character instead of an atom node. Default `false`.
- `suggestion` - `SuggestionOptions` for the autocomplete picker, or `null` to disable. Default `null`.
- `toolbar` - show the emoji button in the toolbar. Default `true`.
- `HTMLAttributes` - attributes applied to the rendered emoji `span`.

For a custom picker, drive the headless plugin directly with `createSuggestionPlugin`
and read its state via `emojiSuggestionPluginKey`. The `Emoji` storage also exposes
`searchEmoji`, `findEmoji`, `getFrequentlyUsed`, and `addFrequentlyUsed`.
