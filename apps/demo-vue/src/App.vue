<script setup lang="ts">
import { ref } from 'vue';
import EditorDemo from './EditorDemo.vue';

const isDark = ref(false);
const useLayout = ref(false);

function toggleTheme() {
  isDark.value = !isDark.value;
  document.body.classList.toggle('dm-theme-dark');
}
</script>

<template>
  <div class="demo">
    <h1>
      Domternal Vue Demo
      <button class="theme-toggle" :title="isDark ? 'Switch to light' : 'Switch to dark'" @click="toggleTheme">
        {{ isDark ? '\u2600\uFE0F' : '\uD83C\uDF19' }}
      </button>
    </h1>

    <div class="toolbar-mode-toggle">
      <button :class="{ active: !useLayout }" @click="useLayout = false">
        Default toolbar
      </button>
      <button :class="{ active: useLayout }" @click="useLayout = true">
        Custom layout
      </button>
    </div>

    <EditorDemo :use-layout="useLayout" />
  </div>
</template>
