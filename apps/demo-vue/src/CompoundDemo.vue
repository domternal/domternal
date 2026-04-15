<script setup lang="ts">
import { h, defineComponent } from 'vue';
import { Domternal, useCurrentEditor } from '@domternal/vue';
import {
  Bold,
  Italic,
  Underline,
  Strike,
  Heading,
  BulletList,
  OrderedList,
  Link,
  LinkPopover,
  SelectionDecoration,
} from '@domternal/core';

const extensions = [
  Bold, Italic, Underline, Strike, Heading, BulletList, OrderedList,
  Link, LinkPopover, SelectionDecoration,
];

// Custom component that uses useCurrentEditor() to inject editor
const EditorProbe = defineComponent({
  name: 'EditorProbe',
  setup() {
    const { editor } = useCurrentEditor();
    return () => h('div', { 'data-testid': 'editor-probe', 'data-dm-editor-ui': '' }, [
      h('span', { 'data-testid': 'has-editor' }, editor.value ? 'yes' : 'no'),
      h('button', {
        'data-testid': 'inject-bold',
        disabled: !editor.value,
        onMousedown: (e: MouseEvent) => e.preventDefault(),
        onClick: () => editor.value?.commands['toggleBold']?.(),
      }, 'Toggle Bold via inject'),
    ]);
  },
});
</script>

<template>
  <div class="compound-demo" data-demo="compound">
    <h2>Compound Component Demo (&lt;Domternal&gt; with namespaced subcomponents)</h2>

    <Domternal :extensions="extensions" content="<p>Compound root provides editor via inject</p>">
      <Domternal.Toolbar />
      <Domternal.Content />
      <Domternal.BubbleMenu :contexts="{ text: ['bold', 'italic', 'underline'] }" />

      <h3>Editor probe (uses useCurrentEditor inject)</h3>
      <EditorProbe />
    </Domternal>
  </div>
</template>
