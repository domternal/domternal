<script setup lang="ts">
import { ref } from 'vue';
import EditorDemo from './EditorDemo.vue';
import VModelDemo from './VModelDemo.vue';
import CompoundDemo from './CompoundDemo.vue';
import NodeViewDemo from './NodeViewDemo.vue';

const isDark = ref(false);
const useLayout = ref(false);
const demoMode = ref<'manual' | 'vmodel' | 'compound' | 'nodeview'>('manual');

function toggleTheme() {
  isDark.value = !isDark.value;
  document.body.classList.toggle('dm-theme-dark');
}
</script>

<template>
  <div class="demo">
    <h1>
      Domternal Vue Demo
      <button type="button" class="theme-toggle" :title="isDark ? 'Switch to light' : 'Switch to dark'" @click="toggleTheme">
        {{ isDark ? '\u2600\uFE0F' : '\uD83C\uDF19' }}
      </button>
    </h1>

    <div class="demo-mode-toggle" data-testid="demo-mode-toggle">
      <button
        type="button"
        data-testid="mode-manual"
        :class="{ active: demoMode === 'manual' }"
        @click="demoMode = 'manual'"
      >
        Manual (useEditor)
      </button>
      <button
        type="button"
        data-testid="mode-vmodel"
        :class="{ active: demoMode === 'vmodel' }"
        @click="demoMode = 'vmodel'"
      >
        v-model (DomternalEditor)
      </button>
      <button
        type="button"
        data-testid="mode-compound"
        :class="{ active: demoMode === 'compound' }"
        @click="demoMode = 'compound'"
      >
        Compound (&lt;Domternal&gt;)
      </button>
      <button
        type="button"
        data-testid="mode-nodeview"
        :class="{ active: demoMode === 'nodeview' }"
        @click="demoMode = 'nodeview'"
      >
        NodeView (VueNodeViewRenderer)
      </button>
    </div>

    <template v-if="demoMode === 'manual'">
      <div class="toolbar-mode-toggle">
        <button type="button" :class="{ active: !useLayout }" @click="useLayout = false">
          Default toolbar
        </button>
        <button type="button" :class="{ active: useLayout }" @click="useLayout = true">
          Custom layout
        </button>
      </div>

      <EditorDemo :use-layout="useLayout" />
    </template>

    <VModelDemo v-else-if="demoMode === 'vmodel'" />

    <CompoundDemo v-else-if="demoMode === 'compound'" />

    <NodeViewDemo v-else-if="demoMode === 'nodeview'" />
  </div>
</template>

<style scoped>
.demo-mode-toggle {
  display: flex;
  gap: 0.25rem;
  margin-bottom: 1rem;
}
.demo-mode-toggle button {
  background: none;
  border: 1px solid #ccc;
  border-radius: 0.375rem;
  padding: 0.375rem 0.75rem;
  font-size: 0.875rem;
  cursor: pointer;
  color: inherit;
}
.demo-mode-toggle button.active {
  background: #e0e7ff;
  border-color: #6366f1;
  color: #4338ca;
}
</style>
