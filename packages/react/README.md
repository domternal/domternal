# @domternal/react

[![Version](https://img.shields.io/npm/v/@domternal/react.svg)](https://www.npmjs.com/package/@domternal/react)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/domternal/domternal/blob/main/LICENSE)

React components and hooks for the [Domternal](https://domternal.dev) rich text editor.
Compose an editor with a toolbar and menus, manage it with hooks, or render custom
node views as React components.

## Install

```bash
pnpm add @domternal/react @domternal/core @domternal/theme react react-dom
```

The package declares Node.js 22 or later for tooling. Requires React and React DOM 18 or later, and `@domternal/core >=1.3.0 <2.0.0`.
Keep installed Domternal packages on the same release. The theme supplies default
styles; import it once in your application entry point.

## Quick start

```tsx
import { Domternal } from '@domternal/react';
import { StarterKit, BubbleMenu } from '@domternal/core';
import '@domternal/theme';

const extensions = [StarterKit, BubbleMenu];

export default function TextEditor() {
  return (
    <Domternal
      extensions={extensions}
      content="<p>Hello from React!</p>"
      onUpdate={({ editor }) => console.log(editor.getHTML())}
    >
      <Domternal.Toolbar />
      <Domternal.Content />
      <Domternal.BubbleMenu contexts={{ text: ['bold', 'italic', 'underline'] }} />
    </Domternal>
  );
}
```

`Domternal` owns the editor lifecycle and shares the instance with its children.
The toolbar renders controls contributed by your extensions. Keep `extensions`
stable, for example at module scope or with `useMemo`: a changed array recreates
the editor while preserving its content.

## Working with the editor

Use `useEditor` for direct access to commands and content. It returns an `editor`
instance and an `editorRef` for the mount element, and cleans up on unmount:

```tsx
import { useEditor, useEditorState } from '@domternal/react';
import { StarterKit } from '@domternal/core';

const extensions = [StarterKit];

export function TextEditor() {
  const { editor, editorRef } = useEditor({
    extensions,
    content: '<p>Start typing...</p>',
  });
  const isEmpty = useEditorState(editor, (ed) => ed.isEmpty);

  return (
    <>
      <button type="button" onClick={() => editor?.chain().focus().toggleBold().run()}>
        Bold
      </button>
      <div className="dm-editor"><div ref={editorRef} /></div>
      <p>{isEmpty ? 'The document is empty.' : 'The document has content.'}</p>
    </>
  );
}
```

For shared controls, wrap descendants in `EditorProvider` and read the instance
with `useCurrentEditor`. See the [React guide](https://domternal.dev/v1/guides/react/)
for component props, selectors, custom node views, and additional menus.

## Configuration notes

- The wrapper includes `Document`, `Paragraph`, `Text`, `BaseKeymap`, and `History`.
  `StarterKit` adds common formatting. To use another undo manager, disable the
  wrapper's history with `history: false` and omit History from your extensions,
  including [StarterKit's history](https://domternal.dev/v1/extensions/history/#disabling-the-built-in-history).
- `content` accepts HTML or JSON. Changed values sync to the editor; use
  `outputFormat="json"` for JSON comparison and `editor.getJSON()` for JSON output.
  `editable` controls read-only mode. `preset="notion"` is read at creation.
- Editor creation waits until the component mounts, so `editor` starts as `null`.
  Keep the default `immediatelyRender: false` for SSR. Next.js App Router editor
  components need `'use client'`; see [SSR setup](https://domternal.dev/v1/guides/react/#ssr-nextjs).
- `onContentError` reports invalid initial content; `onContentDiagnostic` reports
  normalized content values. See [content diagnostics](https://domternal.dev/v1/guides/editor-api/#content-diagnostics)
  and [event behavior](https://domternal.dev/v1/guides/editor-api/#transaction-flow).
- Custom `icons` contain raw SVG. Supply trusted, developer-authored constants.

## Further reading

- [React guide and component reference](https://domternal.dev/v1/guides/react/)
- [Editor commands and content API](https://domternal.dev/v1/guides/editor-api/)
- [Theming](https://domternal.dev/v1/guides/theming/) and [localization with `i18n`](https://domternal.dev/v1/guides/i18n/#react)
- [Optional clipboard HTML cleanup](https://domternal.dev/v1/extensions/paste-cleanup/)
- [Custom React node views](https://domternal.dev/v1/guides/react/#custom-node-views)
