# @domternal/vue

[![Version](https://img.shields.io/npm/v/@domternal/vue.svg)](https://www.npmjs.com/package/@domternal/vue)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/domternal/domternal/blob/main/LICENSE)

Vue 3 bindings for the [Domternal](https://domternal.dev) editor. Provides the composable
`Domternal` component with namespaced subcomponents, the `useEditor` and `useEditorState`
composables for full control, provide/inject helpers for sharing one editor across descendants,
and `VueNodeViewRenderer` for writing custom node views as Vue SFCs. SSR-safe by default: the
editor is created in `onMounted`. Requires Vue 3.3+ and the Composition API.

## Links

<u>[Website](https://domternal.dev)</u> &nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp; <u>[Documentation](https://domternal.dev/v1/guides/vue)</u> &nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp; <u>[Live examples](https://domternal.dev/examples)</u>

## Install

```bash
pnpm add @domternal/vue @domternal/core @domternal/theme vue
```

`vue` (>=3.3) and `@domternal/core` (>=1.2.0 <2.0.0) are peer dependencies. `@domternal/theme`
supplies the editor styles.

This package is part of the coordinated Domternal 1.2.0 release.
Upgrade installed `@domternal/*` packages together.

## Usage

Composable component pattern (recommended): `Domternal` creates the editor and provides it to all
subcomponents via inject, so children need no `editor` prop.

```vue
<script setup lang="ts">
import { Domternal } from '@domternal/vue';
import { StarterKit, BubbleMenu } from '@domternal/core';
import '@domternal/theme';

const extensions = [StarterKit, BubbleMenu];
</script>

<template>
  <Domternal :extensions="extensions" content="<p>Hello from Vue!</p>">
    <Domternal.Toolbar />
    <Domternal.Content />
    <Domternal.BubbleMenu :contexts="{ text: ['bold', 'italic', 'underline'] }" />
  </Domternal>
</template>
```

### Composable hook

Use `useEditor` directly when you need the editor instance, then read reactive state with
`useEditorState`:

```vue
<script setup lang="ts">
import { useEditor, useEditorState, provideEditor, DomternalToolbar } from '@domternal/vue';
import { StarterKit } from '@domternal/core';

const { editor, editorRef } = useEditor({
  extensions: [StarterKit],
  content: '<p>Start typing...</p>',
  onUpdate: ({ editor }) => console.log(editor.getHTML()),
});

provideEditor(editor);

const { htmlContent, isEmpty } = useEditorState(editor);
</script>

<template>
  <DomternalToolbar />
  <div class="dm-editor">
    <div ref="editorRef" />
  </div>
</template>
```

`useEditor` returns `editor` (a `ShallowRef<Editor | null>`, null until mounted unless
`immediatelyRender` is set) and `editorRef` (bind to the mount element). `useEditorState`
returns `htmlContent`, `jsonContent`, `isEmpty`, `isFocused`, and `isEditable`, or pass a
selector for a granular `ComputedRef`:

```ts
const isBold = useEditorState(editor, (ed) => ed.isActive('bold'));
```

## Options

`useEditor(options)` takes:

| Option | Type | Default | Description |
|---|---|---|---|
| `extensions` | `AnyExtension[]` | `[]` | Extensions to load on top of `DEFAULT_EXTENSIONS`. |
| `history` | `boolean` | `true` | Whether the built-in History extension is loaded. Turn it off when an extension brings its own undo. |
| `content` | `Content` | `''` | Initial content, HTML string or JSON. |
| `editable` | `boolean` | `true` | Whether the editor is editable. |
| `i18n` | `I18nOptions` | `{}` | UI translations and formatting. Replacing the object updates the existing editor without changing authored content. |
| `preset` | `'classic' \| 'notion'` | `'classic'` | `'notion'` paints `dm-notion-mode` on the `.dm-editor` host and switches preset-aware extensions to their Notion behavior. Create-time only. |
| `autofocus` | `FocusPosition` | `false` | Where to place the caret on mount. |
| `outputFormat` | `'html' \| 'json'` | `'html'` | Format used when comparing incoming content against the document. |
| `immediatelyRender` | `boolean` | `false` | Create the editor during setup instead of in `onMounted`. Not SSR-safe. |

`onCreate`, `onUpdate`, `onSelectionChange`, `onFocus`, `onBlur`, and `onDestroy` callbacks are
accepted alongside them. `<Domternal>` and `<DomternalEditor>` take the same options as props,
except `history`: their prop lists are fixed, so `:history="false"` never reaches the composable.
Call `useEditor({ history: false })` with `provideEditor` instead.

Toolbar, bubble-menu, and floating-menu `icons` props accept raw SVG through `IconSet`.
Use only trusted, developer-authored constants. Never build an `IconSet` from user input,
persisted document content, or an API response.

The wrapper has no locale subpath. Import `I18nOptions` from `@domternal/core`, and import
`deMessages` and `deSearchAliases` from `@domternal/core/locales/de` for its built-in
toolbar, menus, and pickers. Merge locale entries from any loaded extensions. Missing
messages fall back to English. See the
[i18n guide](https://domternal.dev/v1/guides/i18n) for complete examples.

## Exports

- **Composables**: `useEditor`, `useEditorState` (full state or a granular selector),
  `useCurrentEditor`, `provideEditor`, `useNotionColorPicker`
- **Constants**: `DEFAULT_EXTENSIONS`, `EDITOR_KEY`
- **Composable component**: `Domternal` with `Domternal.Toolbar`, `Domternal.Content`,
  `Domternal.BubbleMenu`, `Domternal.FloatingMenu`, `Domternal.EmojiPicker`, `Domternal.Loading`
- **Components**: `DomternalEditor` (supports `v-model`), `EditorContent`, `DomternalToolbar`,
  `DomternalBubbleMenu`, `DomternalFloatingMenu`, `DomternalEmojiPicker`,
  `DomternalNotionColorPicker`
- **Node views**: `VueNodeViewRenderer`, `NodeViewWrapper`, `NodeViewContent`, `useVueNodeView`
- **Core re-exports**: the `Editor` class plus the `Content`, `AnyExtension`, `FocusPosition`,
  and `JSONContent` types
- **SSR helpers** (re-exported from core, work without an editor instance): `generateHTML`, `generateJSON`, `generateText`
