# @domternal/extension-emoji

Emoji extension for Domternal with a picker panel and `:shortcode:` autocomplete suggestions.

Part of the [Domternal](https://github.com/domternal/domternal) toolkit. Full docs at [domternal.dev](https://domternal.dev).

## Installation

```bash
npm install @domternal/core @domternal/extension-emoji
```

## Usage

```ts
import { Editor, StarterKit } from '@domternal/core';
import { Emoji, emojis } from '@domternal/extension-emoji';

const editor = new Editor({
  element: document.getElementById('editor')!,
  extensions: [
    StarterKit,
    Emoji.configure({
      emojis,
      enableEmoticons: true,  // converts :) and <3 to emoji
    }),
  ],
});

// Insert emoji by name
editor.commands.insertEmoji('smile');

// Open the suggestion picker programmatically
editor.commands.suggestEmoji();
```

### Features

- **Shortcode input rules** - type `:smile:` to insert an emoji inline
- **Emoticon support** - converts common emoticons like `:)`, `<3`, and `:(` when `enableEmoticons` is enabled
- **Autocomplete suggestions** - type `:` followed by a query to see matching emoji in a dropdown
- **Built-in dataset** - includes approximately 200 popular emoji out of the box
- **Custom emoji** - provide your own `EmojiItem[]` array for a custom set

## License

[MIT](https://github.com/domternal/domternal/blob/main/LICENSE)
