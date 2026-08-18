# @domternal/react

[![Version](https://img.shields.io/npm/v/@domternal/react.svg)](https://www.npmjs.com/package/@domternal/react)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/domternal/domternal/blob/main/LICENSE)

React components and hooks for the [Domternal](https://domternal.dev) editor. Wraps the headless
[`@domternal/core`](https://www.npmjs.com/package/@domternal/core) editor with React-native APIs: a composable
`Domternal` component with namespaced subcomponents, a `useEditor` hook for full control, an `EditorProvider`
context, and `ReactNodeViewRenderer` for writing custom node views as React components. Works with React 18
and React 19.

## Links

<u>[Website](https://domternal.dev)</u> &nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp; <u>[Documentation](https://domternal.dev/v1/guides/react)</u> &nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp; <u>[Live examples](https://domternal.dev/examples)</u>

## Install

```bash
pnpm add @domternal/react @domternal/core @domternal/theme react react-dom
```

`react` (>=18), `react-dom` (>=18), and `@domternal/core` (>=0.15.0) are peer dependencies. Import the theme
([`@domternal/theme`](https://www.npmjs.com/package/@domternal/theme)) in your entry CSS for default styling:

```css
@import '@domternal/theme';
```

## Usage

The recommended pattern uses the composable `Domternal` component. It creates the editor and provides it
to every subcomponent via context, so no `editor` prop needs to be passed down:

```tsx
import { Domternal } from '@domternal/react';
import { StarterKit, BubbleMenu } from '@domternal/core';

export default function Editor() {
  return (
    <Domternal
      extensions={[StarterKit, BubbleMenu]}
      content="<p>Hello from React!</p>"
    >
      <Domternal.Toolbar />
      <Domternal.Content />
      <Domternal.BubbleMenu contexts={{ text: ['bold', 'italic', 'underline'] }} />
    </Domternal>
  );
}
```

Need direct access to the editor instance? Use the `useEditor` hook and mount the view yourself:

```tsx
import { useEditor, EditorProvider, DomternalToolbar } from '@domternal/react';
import { StarterKit } from '@domternal/core';

export default function Editor() {
  const { editor, editorRef } = useEditor({
    extensions: [StarterKit],
    content: '<p>Hello</p>',
    onUpdate: ({ editor }) => console.log(editor.getHTML()),
  });

  return (
    <EditorProvider editor={editor}>
      {editor && <DomternalToolbar />}
      <div className="dm-editor">
        <div ref={editorRef} />
      </div>
    </EditorProvider>
  );
}
```

## Options

`useEditor(options, deps?)` and `<Domternal>` take the same options:

| Option | Type | Default | Description |
|---|---|---|---|
| `extensions` | `AnyExtension[]` | `[]` | Extensions to load on top of `DEFAULT_EXTENSIONS`. |
| `history` | `boolean` | `true` | Whether the built-in History extension is loaded. Turn it off when an extension brings its own undo. |
| `content` | `Content` | `''` | Initial content, HTML string or JSON. Changing it syncs the editor. |
| `editable` | `boolean` | `true` | Whether the editor is editable. |
| `preset` | `'classic' \| 'notion'` | `'classic'` | `'notion'` paints `dm-notion-mode` on the `.dm-editor` host and switches preset-aware extensions to their Notion behavior. Create-time only. |
| `autofocus` | `FocusPosition` | `false` | Where to place the caret on mount. |
| `outputFormat` | `'html' \| 'json'` | `'html'` | Format used when comparing the `content` prop against the document. |
| `immediatelyRender` | `boolean` | `false` | Create the editor during the first render, so `editor` is never null. Throws in SSR. |

`onCreate`, `onUpdate`, `onSelectionChange`, `onFocus`, `onBlur`, and `onDestroy` callbacks are
accepted alongside them. `<Domternal>` additionally takes `deps`, the dependency array
`useEditor` reads as its second argument: change a value in it and the editor is rebuilt.

## Exports

- **Hooks**: `useEditor`, `useEditorState` (full state or a granular selector), `useCurrentEditor`,
  `useNotionColorPicker`
- **Constants**: `DEFAULT_EXTENSIONS`
- **Composable component**: `Domternal` with `Domternal.Toolbar`, `Domternal.Content`, `Domternal.BubbleMenu`,
  `Domternal.FloatingMenu`, `Domternal.EmojiPicker`, `Domternal.Loading`
- **Components**: `DomternalEditor`, `EditorContent`, `DomternalToolbar`, `DomternalBubbleMenu`,
  `DomternalFloatingMenu`, `DomternalEmojiPicker`, `DomternalNotionColorPicker`, `EditorProvider`
- **Node views**: `ReactNodeViewRenderer`, `NodeViewWrapper`, `NodeViewContent`, `useReactNodeView`
- **Core re-exports**: the `Editor` class plus the `Content`, `AnyExtension`, `FocusPosition`,
  and `JSONContent` types
- **SSR helpers** (re-exported from core, work without an editor instance): `generateHTML`, `generateJSON`, `generateText`
