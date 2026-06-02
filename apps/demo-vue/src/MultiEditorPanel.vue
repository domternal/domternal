<script setup lang="ts">
import { watch, onBeforeUnmount } from 'vue';
import { useEditor, DomternalToolbar, DomternalBubbleMenu } from '@domternal/vue';
import type { Editor } from '@domternal/core';
import { sharedExtensions, sampleContent } from './multiEditorShared.js';

interface PanelSpec { id: number; withToolbar: boolean }

const props = defineProps<{ spec: PanelSpec; index: number }>();
const emit = defineEmits<{
  editor: [id: number, editor: Editor | null];
  remove: [id: number];
}>();

// SAME shared array passed to every editor; the manager clones it per editor.
const { editor, editorRef } = useEditor({
  extensions: sharedExtensions,
  content: sampleContent(props.spec.id),
});

// Report the editor up (sync); the parent owns the window globals.
watch(editor, (e) => { emit('editor', props.spec.id, e ?? null); }, { immediate: true });
onBeforeUnmount(() => { emit('editor', props.spec.id, null); });
</script>

<template>
  <div
    class="multi-editor-panel"
    :data-editor-index="index"
    style="border: 1px solid rgba(128, 128, 128, 0.3); border-radius: 8px; padding: 12px;"
  >
    <div style="display: flex; justify-content: space-between; align-items: center; margin: 0 0 8px;">
      <strong>Editor {{ spec.id }} ({{ spec.withToolbar ? 'toolbar' : 'bubble menu' }})</strong>
      <button data-testid="multi-remove-editor" @click="emit('remove', spec.id)">Remove</button>
    </div>

    <DomternalToolbar v-if="spec.withToolbar && editor" :editor="editor" />

    <div class="dm-editor">
      <div ref="editorRef" />
    </div>

    <DomternalBubbleMenu
      v-if="!spec.withToolbar && editor"
      :editor="editor"
      :contexts="{ text: ['bold', 'italic', 'underline', 'strike', 'code'] }"
    />
  </div>
</template>
