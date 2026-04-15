<script setup lang="ts">
import { ref, watch } from 'vue';
import { DomternalEditor } from '@domternal/vue';
import {
  Bold,
  Italic,
  Underline,
  Strike,
  Heading,
  BulletList,
  OrderedList,
  SelectionDecoration,
} from '@domternal/core';

const extensions = [Bold, Italic, Underline, Strike, Heading, BulletList, OrderedList, SelectionDecoration];

const content = ref('<p>Edit me - changes sync via v-model</p>');
const updateCount = ref(0);

// Track number of model updates to verify v-model emits
watch(content, () => {
  updateCount.value++;
});

function setContent(html: string) {
  content.value = html;
}

function clearContent() {
  content.value = '<p></p>';
}
</script>

<template>
  <div class="vmodel-demo" data-demo="vmodel">
    <h2>v-model Two-Way Binding Demo</h2>

    <div class="vmodel-controls">
      <button type="button" data-testid="set-initial" @click="setContent('<p>Initial from parent</p>')">Set initial</button>
      <button type="button" data-testid="set-bold" @click="setContent('<p><strong>Bold from parent</strong></p>')">Set bold from parent</button>
      <button type="button" data-testid="clear" @click="clearContent">Clear</button>
      <span data-testid="update-count">Updates: {{ updateCount }}</span>
    </div>

    <DomternalEditor v-model="content" :extensions="extensions" output-format="html" />

    <h3>Parent state (bound via v-model)</h3>
    <pre class="output" data-testid="vmodel-output">{{ content }}</pre>

    <h3>Hidden textarea synced with v-model (for test assertions)</h3>
    <textarea
      data-testid="vmodel-textarea"
      :value="content"
      readonly
      style="width: 100%; min-height: 60px; font-family: monospace;"
    />
  </div>
</template>

<style scoped>
.vmodel-controls {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  margin-bottom: 1rem;
  flex-wrap: wrap;
}
.vmodel-controls button {
  padding: 0.25rem 0.75rem;
  border: 1px solid #ccc;
  border-radius: 0.375rem;
  background: none;
  cursor: pointer;
  color: inherit;
  font-size: 0.875rem;
}
.vmodel-controls button:hover {
  background: rgba(0, 0, 0, 0.05);
}
</style>
