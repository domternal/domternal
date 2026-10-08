# @domternal/vue

[![Version](https://img.shields.io/npm/v/@domternal/vue.svg)](https://www.npmjs.com/package/@domternal/vue)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/domternal/domternal/blob/main/LICENSE)

Vue 3 components and composables for the [Domternal](https://domternal.dev) rich
text editor. Includes toolbar and menu components, `v-model` support, reactive
editor state, and custom node views written as Vue components.

## Install

```bash
pnpm add @domternal/vue @domternal/core @domternal/theme vue
```

The package declares Node.js 22 or later for tooling. Requires Vue 3.3 or later and `@domternal/core >=1.3.0 <2.0.0`.
Keep installed Domternal packages on the same release. Import the theme once in
your application for default styling.

## Quick start

Use the composable component to arrange the toolbar, content, and menus:

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

`Domternal` creates the editor, provides it to descendants, and destroys it on
unmount. The toolbar renders controls contributed by the loaded extensions.

## Bind content with v-model

Use `DomternalEditor` when the document should bind to application state:

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { DomternalEditor } from '@domternal/vue';
import { StarterKit, type Content } from '@domternal/core';

const extensions = [StarterKit];
const content = ref<Content>('<p>Start typing...</p>');
</script>

<template>
  <DomternalEditor v-model="content" :extensions="extensions" />
</template>
```

The model holds HTML by default. Set `outputFormat="json"` and initialize it with
JSON content to bind JSON instead.

For full control, `useEditor` returns `editor`, a `ShallowRef<Editor | null>`, and
`editorRef`, which you bind to the mount element. Use `provideEditor(editor)` to
share it and `useEditorState(editor, ed => ed.isActive('bold'))` for derived state.
See the [composable example](https://domternal.dev/v1/guides/vue/#composable-hook-pattern-full-control).

## Configuration notes

- The wrapper includes `Document`, `Paragraph`, `Text`, `BaseKeymap`, and `History`.
  `StarterKit` adds common formatting.
- `Domternal` and `DomternalEditor` do **not** forward a `history` prop. To use
  another undo manager, call `useEditor({ history: false, extensions })` and omit
  History from those extensions as well. See [disabling history](https://domternal.dev/v1/extensions/history/#disabling-the-built-in-history).
- Creation happens in `onMounted`, so the editor is `null` during SSR and initial
  setup. Leave `immediatelyRender` off for SSR; see [Nuxt integration](https://domternal.dev/v1/guides/vue/#ssr-nuxt).
- `editable` controls read-only mode. `preset="notion"` is read at creation.
  Replace `i18n` to update UI translations without recreating the editor.
- `onContentError` reports invalid initial content; `onContentDiagnostic` reports
  normalized content values. The [Vue guide](https://domternal.dev/v1/guides/vue/#options)
  documents callback options; the [Editor API](https://domternal.dev/v1/guides/editor-api/#content-diagnostics)
  explains diagnostics.
- Custom `icons` contain raw SVG. Supply trusted, developer-authored constants.

## Further reading

- [Vue guide and component reference](https://domternal.dev/v1/guides/vue/)
- [Editor commands and content API](https://domternal.dev/v1/guides/editor-api/)
- [Theming](https://domternal.dev/v1/guides/theming/) and [localization with `i18n`](https://domternal.dev/v1/guides/i18n/#vue)
- [Optional clipboard HTML cleanup](https://domternal.dev/v1/extensions/paste-cleanup/)
- [Custom Vue node views](https://domternal.dev/v1/guides/vue/#custom-node-views)
