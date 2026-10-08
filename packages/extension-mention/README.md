# @domternal/extension-mention

[![Version](https://img.shields.io/npm/v/@domternal/extension-mention.svg)](https://www.npmjs.com/package/@domternal/extension-mention)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/domternal/domternal/blob/main/LICENSE)

Inline mentions for the [Domternal](https://domternal.dev) editor. Connect `@` users,
`#` tags, or another trigger to your own data source. The extension stores each
mention's `id`, `label`, and `type`, supports synchronous and asynchronous search,
and includes a DOM dropdown renderer you can replace with your own UI.

[Documentation](https://domternal.dev/v1/nodes/mention/) · [Live examples](https://domternal.dev/examples/)

## Install

The package declares Node.js 22 or later for tooling.

```bash
pnpm add @domternal/core @domternal/pm @domternal/extension-mention @domternal/theme
```

Requires `@domternal/core` and `@domternal/pm` `>=1.3.0 <2.0.0`.
The theme styles mentions and the suggestion dropdown; custom styles are also supported.

## Quick start

Add a host, then run the TypeScript after it is mounted in a browser app that
supports CSS imports:

```html
<div class="dm-editor"><div id="editor"></div></div>
```

```ts
import { Editor, StarterKit } from '@domternal/core';
import {
  Mention,
  createMentionSuggestionRenderer,
} from '@domternal/extension-mention';
import '@domternal/theme';

const users = [
  { id: '1', label: 'Alice Johnson' },
  { id: '2', label: 'Bob Smith' },
  { id: '3', label: 'Charlie Brown' },
];

const editor = new Editor({
  element: document.getElementById('editor')!,
  extensions: [
    StarterKit,
    Mention.configure({
      suggestion: {
        char: '@',
        name: 'user',
        items: ({ query }) => users.filter((user) =>
          user.label.toLowerCase().includes(query.toLowerCase()),
        ),
        render: createMentionSuggestionRenderer(),
      },
    }),
  ],
  content: '<p>Type @ to mention someone.</p>',
});
```

Type `@` to open suggestions, use arrow keys to navigate, `Enter` to insert, and
`Escape` to dismiss. The trigger's `name` becomes the inserted mention's `type`.
Call `editor.destroy()` when removing the editor.

## Commands and storage

```ts
import type { MentionStorage } from '@domternal/extension-mention';

editor.chain().focus().insertMention({ id: '1', label: 'Alice', type: 'user' }).run();
editor.commands.deleteMention('1');

const mentionStorage = editor.storage.mention as MentionStorage;
const mentions = mentionStorage.findMentions();
```

`deleteMention(id)` removes the first matching mention. Without an ID it removes
the mention immediately before the cursor. `findMentions()` returns the document's
mentions as `{ id, label, type, pos }` objects.

## Search configuration

- `items` may return a `Promise<MentionItem[]>` for API-backed search. Set
  `debounce` in milliseconds and `minQueryLength` to control when requests run.
- `allowSpaces: true` allows multiword queries. It defaults to `false`.
- `appendText` controls text inserted after a suggestion, defaulting to a space.
- Suggestions automatically stay closed in code blocks and inline code.
  `invalidNodes` excludes additional node types and defaults to an empty list.
- Replace `render` with your own factory to integrate a framework dropdown.

For multiple sources, use `triggers` instead of `suggestion`. Each trigger requires
its own unique `name`, character, item provider, and optional renderer. For example,
add a `user` trigger for `@` and a `tag` trigger for `#`. A nonempty `triggers` array
takes precedence over `suggestion`.

Backspace deletes a mention immediately before the cursor. Set
`deleteTriggerWithBackspace: true` to also remove a matching trigger character
immediately before that mention, if present. `renderHTML`, `renderText`, and
`HTMLAttributes` customize how stored mentions are presented.

See the [full reference](https://domternal.dev/v1/nodes/mention/) for multiple-trigger
examples, async providers, rendering, and the exported headless plugin helpers.

## Localization

`mentionMessages` provides typed message keys. German `deMessages` and
`deSearchAliases` are exported from `@domternal/extension-mention/locales/de`.
See the [localization guide](https://domternal.dev/v1/guides/i18n/) for combining
catalogs. Missing messages fall back to English; provider-supplied names and labels
remain unchanged.
