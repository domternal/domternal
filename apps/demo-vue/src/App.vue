<script setup lang="ts">
import { computed, ref } from 'vue';
import { DEMO_I18N, type DemoLanguage } from './demo-i18n.js';
import EditorDemo from './EditorDemo.vue';
import VModelDemo from './VModelDemo.vue';
import CompoundDemo from './CompoundDemo.vue';
import NodeViewDemo from './NodeViewDemo.vue';
import NotionDemo from './NotionDemo.vue';
import MultiEditorDemo from './MultiEditorDemo.vue';
import TabIndentDemo from './TabIndentDemo.vue';

const isDark = ref(false);
const language = ref<DemoLanguage>('en');
const editorI18n = computed(() => DEMO_I18N[language.value]);
const useLayout = ref(false);
const demoMode = ref<'manual' | 'vmodel' | 'compound' | 'nodeview' | 'notion' | 'notion-scrollable' | 'multi' | 'tab'>('manual');

function setLanguage(value: string): void {
  if (value === 'en' || value === 'de') language.value = value;
}

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
      <select
        class="language-select"
        aria-label="Editor language"
        data-testid="demo-language"
        :value="language"
        @change="setLanguage(($event.target as HTMLSelectElement).value)"
      >
        <option value="en" lang="en">English</option>
        <option value="de" lang="de">Deutsch</option>
      </select>
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
      <button
        type="button"
        data-testid="mode-notion"
        :class="{ active: demoMode === 'notion' }"
        @click="demoMode = 'notion'"
      >
        Notion style
      </button>
      <button
        type="button"
        data-testid="mode-notion-scrollable"
        :class="{ active: demoMode === 'notion-scrollable' }"
        @click="demoMode = 'notion-scrollable'"
      >
        Notion scrollable
      </button>
      <button
        type="button"
        data-testid="mode-multi"
        :class="{ active: demoMode === 'multi' }"
        @click="demoMode = 'multi'"
      >
        Multiple editors
      </button>
      <button
        type="button"
        data-testid="mode-tab"
        :class="{ active: demoMode === 'tab' }"
        @click="demoMode = 'tab'"
      >
        Tab + lists
      </button>
    </div>

    <!-- `:key` forces a fresh mount when switching between the two Notion
         variants - mirrors the vanilla demo which destroys + recreates
         the NotionDemo on mode change. -->
    <NotionDemo
      :i18n="editorI18n"
      v-if="demoMode === 'notion' || demoMode === 'notion-scrollable'"
      :key="demoMode"
      :scrollable="demoMode === 'notion-scrollable'"
    />

    <MultiEditorDemo :i18n="editorI18n" v-else-if="demoMode === 'multi'" />

    <TabIndentDemo :i18n="editorI18n" v-else-if="demoMode === 'tab'" />

    <div v-else class="app-editor-demo">
      <template v-if="demoMode === 'manual'">
        <div class="toolbar-mode-toggle">
          <button type="button" :class="{ active: !useLayout }" @click="useLayout = false">
            Default toolbar
          </button>
          <button type="button" :class="{ active: useLayout }" @click="useLayout = true">
            Custom layout
          </button>
        </div>

        <EditorDemo :i18n="editorI18n" :use-layout="useLayout" />
      </template>

      <VModelDemo :i18n="editorI18n" v-else-if="demoMode === 'vmodel'" />

      <CompoundDemo :i18n="editorI18n" v-else-if="demoMode === 'compound'" />

      <NodeViewDemo :i18n="editorI18n" v-else-if="demoMode === 'nodeview'" />
    </div>
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
