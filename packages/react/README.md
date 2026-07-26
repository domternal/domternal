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
pnpm add @domternal/react @domternal/core react react-dom
```

`react` (>=18), `react-dom` (>=18), and `@domternal/core` (>=0.13.0) are peer dependencies. Import the theme
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

## Exports

- **Hooks**: `useEditor`, `useEditorState` (full state or a granular selector), `useCurrentEditor`
- **Constants**: `DEFAULT_EXTENSIONS`
- **Composable component**: `Domternal` with `Domternal.Toolbar`, `Domternal.Content`, `Domternal.BubbleMenu`,
  `Domternal.FloatingMenu`, `Domternal.EmojiPicker`, `Domternal.Loading`
- **Components**: `DomternalEditor`, `EditorContent`, `DomternalToolbar`, `DomternalBubbleMenu`,
  `DomternalFloatingMenu`, `DomternalEmojiPicker`, `DomternalNotionColorPicker`, `EditorProvider`
- **Node views**: `ReactNodeViewRenderer`, `NodeViewWrapper`, `NodeViewContent`, `useReactNodeView`
- **SSR helpers** (re-exported from core, work without an editor instance): `generateHTML`, `generateJSON`, `generateText`
