# @domternal/vue

[![Version](https://img.shields.io/npm/v/@domternal/vue.svg)](https://www.npmjs.com/package/@domternal/vue)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/domternal/domternal/blob/main/LICENSE)

Vue 3 bindings for the [Domternal](https://domternal.dev) editor. Provides the composable
`Domternal` component (with namespaced `Domternal.Toolbar`, `Domternal.Content`,
`Domternal.BubbleMenu`, `Domternal.FloatingMenu`, and `Domternal.EmojiPicker` subcomponents),
the `useEditor` and `useEditorState` composables for full control, provide/inject helpers for
sharing one editor across descendants, and `VueNodeViewRenderer` for writing custom node views as
Vue SFCs. SSR-safe by default: the editor is created in `onMounted`. Requires Vue 3.3+ and the
Composition API.

## Links

<u>[Website](https://domternal.dev)</u> &nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp; <u>[Documentation](https://domternal.dev/v1/guides/vue)</u> &nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp; <u>[Live examples](https://domternal.dev/examples)</u>

## Install

```bash
pnpm add @domternal/vue @domternal/core @domternal/theme vue
```

`vue` (>=3.3) and `@domternal/core` are peer dependencies. `@domternal/theme` supplies the
editor styles.

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
  content: '<p>Start typing…</p>',
  onUpdate: ({ editor }) => console.log(editor.getHTML()),
});

provideEditor(editor);

const { htmlContent, isEmpty } = useEditorState(editor);
</script>

<template>
  <DomternalToolbar />
  <div ref="editorRef" class="dm-editor" />
</template>
```

`useEditor` returns `editor` (a `ShallowRef<Editor | null>`, null until mounted) and `editorRef`
(bind to the mount element). `useEditorState` returns `htmlContent`, `jsonContent`, `isEmpty`,
`isFocused`, and `isEditable`, or pass a selector for a granular `ComputedRef`:

```ts
const isBold = useEditorState(editor, (ed) => ed.isActive('bold'));
```
