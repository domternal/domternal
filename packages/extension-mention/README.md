# @domternal/extension-mention

[![Version](https://img.shields.io/npm/v/@domternal/extension-mention.svg)](https://www.npmjs.com/package/@domternal/extension-mention)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/domternal/domternal/blob/main/LICENSE)

Inline `@`-mention nodes for the [Domternal](https://domternal.dev) editor. Adds an
atomic `mention` node that carries an `id` and `label`, plus a headless suggestion
plugin that watches one or more trigger characters (`@`, `#`, ...), tracks the query,
and fetches matching items from your own data source (sync or async). You supply the
data and, optionally, the dropdown UI; a framework-free default renderer is included.

## Links

<u>[Website](https://domternal.dev)</u> &nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp; <u>[Documentation](https://domternal.dev/v1/nodes/mention)</u> &nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp; <u>[Live examples](https://domternal.dev/examples)</u>

## Install

```bash
pnpm add @domternal/extension-mention
```

`@domternal/core` and `@domternal/pm` are peer dependencies and are already installed
with the editor.

## Usage

```ts
import { Editor, Document, Paragraph, Text } from '@domternal/core';
import { Mention, createMentionSuggestionRenderer } from '@domternal/extension-mention';

const users = [
  { id: '1', label: 'Alice Johnson' },
  { id: '2', label: 'Bob Smith' },
  { id: '3', label: 'Charlie Brown' },
];

const editor = new Editor({
  extensions: [
    Document,
    Paragraph,
    Text,
    Mention.configure({
      suggestion: {
        char: '@',
        name: 'user',
        items: ({ query }) =>
          users.filter((u) =>
            u.label.toLowerCase().includes(query.toLowerCase()),
          ),
        render: createMentionSuggestionRenderer(),
      },
    }),
  ],
  content: '<p>Type @ to mention someone!</p>',
});
```

Type `@` to open the dropdown, navigate with arrow keys, press `Enter` to insert, and
`Escape` to dismiss.
`items` may also return a `Promise`, so suggestions can come from a remote API; pair
that with `debounce` on the trigger to rate-limit calls.

> The inserted `span.mention`, the underline on the `@query` range still being typed,
> and the default dropdown (the `dm-mention-suggestion` classes) are all styled by
> `@domternal/theme` (`_mention.scss`). Import the theme, or supply your own `render`
> factory if you want fully custom markup.

## Commands and storage

The extension registers two chainable commands:

```ts
// Insert a mention at the current selection
editor.commands.insertMention({ id: '1', label: 'Alice', type: 'user' });

// Delete by id, or the mention immediately before the cursor when no id is passed
editor.commands.deleteMention('1');
editor.commands.deleteMention();
```

It also exposes `editor.storage.mention.findMentions()`, which returns every mention
in the document as `{ id, label, type, pos }`.

## Multiple triggers

Pass a `triggers` array to mix, for example, `@` users and `#` tags. Each trigger has
its own `name`, `items` source, and renderer:

```ts
Mention.configure({
  triggers: [
    { char: '@', name: 'user', items: fetchUsers, render: createMentionSuggestionRenderer() },
    { char: '#', name: 'tag', items: fetchTags, render: createMentionSuggestionRenderer() },
  ],
});
```

## Options

Per-trigger options are `char`, `name`, `items`, `render`, `minQueryLength`,
`allowSpaces`, `appendText` (default `' '`), `invalidNodes`, `debounce`,
`decorationClass`, `decorationTag`, and `shouldShow`. Extension-level options, set
alongside `suggestion` or `triggers`, are `deleteTriggerWithBackspace` (Backspace on a
mention removes the trigger char with it, default `false`), `renderHTML`, `renderText`,
and `HTMLAttributes`.

For a custom picker, drive the headless plugin directly with
`createMentionSuggestionPlugin` and close it with
`dismissMentionSuggestion(view, triggerName)`. For full details and framework wrapper
examples, see the [documentation](https://domternal.dev/v1/nodes/mention).
