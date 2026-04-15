<script setup lang="ts">
/**
 * Vue NodeView for the Callout demo extension.
 *
 * Exercises the full VueNodeViewRenderer contract:
 * - reactive props (node, selected) → UI updates when ProseMirror calls update()
 * - updateAttributes() → changes node.attrs, persists to document
 * - deleteNode() → removes the node
 * - NodeViewWrapper / NodeViewContent → editable nested content + drag handle
 * - useCurrentEditor() inside a node view (exercises appContext forwarding)
 */
import { computed } from 'vue';
import {
  NodeViewWrapper,
  NodeViewContent,
  useCurrentEditor,
  type VueNodeViewProps,
} from '@domternal/vue';

const props = defineProps<VueNodeViewProps>();

const { editor: injectedEditor } = useCurrentEditor();

const variant = computed(() => (props.node.attrs['variant'] as string) ?? 'info');

const variants = [
  { value: 'info', icon: '\u2139\uFE0F', label: 'Info' },
  { value: 'warning', icon: '\u26A0\uFE0F', label: 'Warning' },
  { value: 'success', icon: '\u2705', label: 'Success' },
  { value: 'danger', icon: '\u{1F6A8}', label: 'Danger' },
];

const currentVariant = computed(() => variants.find((v) => v.value === variant.value) ?? variants[0]);

function onVariantChange(e: Event) {
  const value = (e.target as HTMLSelectElement).value;
  props.updateAttributes({ variant: value });
}

function onDelete() {
  props.deleteNode();
}

function focusEditor() {
  // Uses the injected editor (exercises useCurrentEditor inside a NodeView)
  injectedEditor.value?.view.focus();
}
</script>

<template>
  <NodeViewWrapper
    class="callout"
    :class="[`callout--${variant}`, { 'callout--selected': selected }]"
    :data-variant="variant"
    data-testid="callout-wrapper"
  >
    <div class="callout-header" contenteditable="false">
      <span class="callout-icon" data-testid="callout-icon">{{ currentVariant?.icon }}</span>
      <select
        class="callout-variant"
        data-testid="callout-variant-select"
        :value="variant"
        @change="onVariantChange"
      >
        <option v-for="v in variants" :key="v.value" :value="v.value">{{ v.label }}</option>
      </select>
      <span data-testid="callout-injected-editor-ok">{{ injectedEditor ? 'injected' : 'no-inject' }}</span>
      <button
        type="button"
        class="callout-focus-btn"
        data-testid="callout-focus-btn"
        @mousedown.prevent
        @click="focusEditor"
      >
        Focus editor
      </button>
      <button
        type="button"
        class="callout-delete-btn"
        data-testid="callout-delete-btn"
        @mousedown.prevent
        @click="onDelete"
      >
        ×
      </button>
    </div>
    <NodeViewContent class="callout-content" />
  </NodeViewWrapper>
</template>

<style scoped>
.callout {
  border-left: 4px solid var(--callout-accent, #6366f1);
  background: var(--callout-bg, #f4f4f5);
  border-radius: 4px;
  padding: 0.5rem 0.75rem;
  margin: 0.5rem 0;
  position: relative;
}
.callout--info    { --callout-accent: #3b82f6; --callout-bg: #eff6ff; }
.callout--warning { --callout-accent: #f59e0b; --callout-bg: #fffbeb; }
.callout--success { --callout-accent: #10b981; --callout-bg: #ecfdf5; }
.callout--danger  { --callout-accent: #ef4444; --callout-bg: #fef2f2; }

.callout--selected {
  outline: 2px solid #6366f1;
  outline-offset: 2px;
}

.callout-header {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  margin-bottom: 0.25rem;
  user-select: none;
  font-size: 0.875rem;
}

.callout-icon {
  font-size: 1.1rem;
}

.callout-variant {
  padding: 0.125rem 0.375rem;
  font-size: 0.8125rem;
}

.callout-delete-btn,
.callout-focus-btn {
  margin-left: auto;
  background: none;
  border: 1px solid #ccc;
  border-radius: 0.25rem;
  padding: 0.125rem 0.5rem;
  cursor: pointer;
  font-size: 0.8125rem;
}
.callout-delete-btn { margin-left: 0; }
.callout-delete-btn:hover { background: rgba(239, 68, 68, 0.1); border-color: #ef4444; }
.callout-focus-btn:hover  { background: rgba(99, 102, 241, 0.1); border-color: #6366f1; }

.callout-content :deep(p) {
  margin: 0.25rem 0;
}
</style>
