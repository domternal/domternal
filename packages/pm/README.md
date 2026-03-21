# @domternal/pm

Convenience re-exports of ProseMirror packages via subpath imports, so you can depend on a single package instead of twelve.

Part of the [Domternal](https://github.com/domternal/domternal) toolkit. Full docs at [domternal.dev](https://domternal.dev).

## Installation

```bash
npm install @domternal/pm
```

## Usage

Import ProseMirror modules through subpath exports:

```ts
import { EditorState, Plugin, PluginKey } from '@domternal/pm/state';
import { EditorView } from '@domternal/pm/view';
import { Schema, Node, Mark } from '@domternal/pm/model';
import { ReplaceStep } from '@domternal/pm/transform';
import { keymap } from '@domternal/pm/keymap';
import { undo, redo, history } from '@domternal/pm/history';
import { baseKeymap } from '@domternal/pm/commands';
import { inputRules } from '@domternal/pm/inputrules';
import { dropCursor } from '@domternal/pm/dropcursor';
import { gapCursor } from '@domternal/pm/gapcursor';
import { tableEditing, columnResizing } from '@domternal/pm/tables';
import { wrapInList, liftListItem } from '@domternal/pm/schema-list';
```

### Available Subpath Exports

| Import | Re-exports |
|---|---|
| `@domternal/pm/state` | `prosemirror-state` |
| `@domternal/pm/view` | `prosemirror-view` |
| `@domternal/pm/model` | `prosemirror-model` |
| `@domternal/pm/transform` | `prosemirror-transform` |
| `@domternal/pm/commands` | `prosemirror-commands` |
| `@domternal/pm/keymap` | `prosemirror-keymap` |
| `@domternal/pm/history` | `prosemirror-history` |
| `@domternal/pm/inputrules` | `prosemirror-inputrules` |
| `@domternal/pm/dropcursor` | `prosemirror-dropcursor` |
| `@domternal/pm/gapcursor` | `prosemirror-gapcursor` |
| `@domternal/pm/tables` | `prosemirror-tables` |
| `@domternal/pm/schema-list` | `prosemirror-schema-list` |

## License

[MIT](https://github.com/domternal/domternal/blob/main/LICENSE)
