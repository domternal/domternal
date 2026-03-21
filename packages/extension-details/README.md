# @domternal/extension-details

Collapsible details/accordion blocks for the Domternal editor, rendered as semantic `<details>`/`<summary>` HTML.

Part of the [Domternal](https://github.com/domternal/domternal) toolkit. Full docs at [domternal.dev](https://domternal.dev).

## Installation

```bash
npm install @domternal/core @domternal/extension-details
```

## Usage

```ts
import { Editor, StarterKit } from '@domternal/core';
import { Details, DetailsSummary, DetailsContent } from '@domternal/extension-details';

const editor = new Editor({
  element: document.getElementById('editor')!,
  extensions: [StarterKit, Details, DetailsSummary, DetailsContent],
  content: '<p>Hello world</p>',
});

// Wrap selected content in a details block
editor.commands.setDetails();

// Toggle details on/off
editor.commands.toggleDetails();

// Open or close programmatically
editor.commands.openDetails();
editor.commands.closeDetails();
```

### Commands

| Command | Description |
|---|---|
| `setDetails` | Wrap selected content in a details structure |
| `unsetDetails` | Lift content out of details (preserves summary as paragraph) |
| `toggleDetails` | Toggle between wrapped and unwrapped |
| `openDetails` / `closeDetails` | Programmatic open/close control |
| `setDetailsOpen(boolean)` | Set the open state explicitly |

### Options

| Option | Default | Description |
|---|---|---|
| `persist` | `false` | Persist the open/closed state in the document |

## License

[MIT](https://github.com/domternal/domternal/blob/main/LICENSE)
