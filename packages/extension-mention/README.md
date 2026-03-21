# @domternal/extension-mention

`@mention` autocomplete extension for Domternal with multi-trigger and async support.

Part of the [Domternal](https://github.com/domternal/domternal) toolkit. Full docs at [domternal.dev](https://domternal.dev).

## Installation

```bash
npm install @domternal/core @domternal/extension-mention
```

## Usage

```ts
import { Editor, StarterKit } from '@domternal/core';
import { Mention } from '@domternal/extension-mention';

const editor = new Editor({
  element: document.getElementById('editor')!,
  extensions: [
    StarterKit,
    Mention.configure({
      suggestion: {
        char: '@',
        name: 'user',
        items: ({ query }) =>
          users.filter((u) => u.label.toLowerCase().includes(query.toLowerCase())),
        render: createMentionRenderer,
      },
    }),
  ],
});

// Insert a mention programmatically
editor.commands.insertMention({ id: '1', label: 'Alice' });
```

### Multi-trigger

Use the `triggers` option to support multiple trigger characters (for example, `@` for users and `#` for tags):

```ts
Mention.configure({
  triggers: [
    {
      char: '@',
      name: 'user',
      items: ({ query }) => fetchUsers(query),
      render: createUserRenderer,
    },
    {
      char: '#',
      name: 'tag',
      items: ({ query }) => fetchTags(query),
      render: createTagRenderer,
    },
  ],
})
```

### Features

- **Autocomplete dropdown** - type a trigger character followed by a query to see matching items
- **Async item fetching** - the `items` function can return a `Promise` for server-side lookups
- **Multi-trigger** - define multiple trigger characters, each with its own item source and renderer
- **Custom rendering** - provide a `render` function for full control over the suggestion dropdown UI

## License

[MIT](https://github.com/domternal/domternal/blob/main/LICENSE)
