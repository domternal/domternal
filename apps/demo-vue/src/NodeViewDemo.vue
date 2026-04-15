<script setup lang="ts">
import { useEditor, DomternalToolbar, provideEditor } from '@domternal/vue';
import { useExposeEditorForE2E } from './useExposeEditorForE2E.js';
import {
  Bold,
  Italic,
  Underline,
  Heading,
  BulletList,
  OrderedList,
  SelectionDecoration,
} from '@domternal/core';
import { Callout, type CalloutVariant } from './Callout.js';

const extensions = [
  Bold, Italic, Underline, Heading, BulletList, OrderedList,
  SelectionDecoration,
  Callout,
];

const initialContent = `
<h2>Vue NodeView Demo</h2>
<p>Below is a custom <strong>Callout</strong> block rendered by a Vue component via <code>VueNodeViewRenderer</code>.</p>
<div data-type="callout" data-variant="info">
  <p>This is an info callout - try <strong>typing</strong> inside it, switching variant, or deleting it.</p>
</div>
<p>Below this paragraph you can insert more callouts using the buttons.</p>
`;

const { editor, editorRef } = useEditor({ extensions, content: initialContent });

// Required for VueNodeViewRenderer: stores Vue appContext for inject chain forwarding
provideEditor(editor);

function insertCallout(variant: CalloutVariant) {
  editor.value?.chain().focus().insertCallout(variant).run();
}

useExposeEditorForE2E(editor);

defineExpose({ editor, editorRef });
</script>

<template>
  <div class="nodeview-demo" data-demo="nodeview">
    <h2>Vue NodeView Demo</h2>

    <div class="nodeview-controls">
      <button type="button" data-testid="insert-info" @click="insertCallout('info')">+ Info</button>
      <button type="button" data-testid="insert-warning" @click="insertCallout('warning')">+ Warning</button>
      <button type="button" data-testid="insert-success" @click="insertCallout('success')">+ Success</button>
      <button type="button" data-testid="insert-danger" @click="insertCallout('danger')">+ Danger</button>
    </div>

    <DomternalToolbar v-if="editor" :editor="editor" />

    <div class="dm-editor" data-dm-editor-ui="">
      <div ref="editorRef" />
    </div>
  </div>
</template>

<style scoped>
.nodeview-controls {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
  flex-wrap: wrap;
}
.nodeview-controls button {
  padding: 0.25rem 0.75rem;
  border: 1px solid #ccc;
  border-radius: 0.375rem;
  background: none;
  cursor: pointer;
  color: inherit;
  font-size: 0.875rem;
}
.nodeview-controls button:hover {
  background: rgba(0, 0, 0, 0.05);
}
</style>
