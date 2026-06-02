<script setup lang="ts">
import { ref, onBeforeUnmount } from 'vue';
import type { Editor } from '@domternal/core';
import MultiEditorPanel from './MultiEditorPanel.vue';

/**
 * "Multiple editors" demo (Vue). Several independent editors, every one built
 * from the SAME shared `extensions` array (see multiEditorShared.ts). Regression
 * surface for the shared-extension-instance bug: before the per-editor clone
 * fix, a later editor clobbered earlier ones so list Enter on the earlier ones
 * dropped an indented child paragraph instead of a new <li>. Editor 0 gets a
 * toolbar, the rest a bubble menu. Add / remove at runtime must not break others.
 *
 * E2E hooks: `window.__MULTI_EDITORS__` (core editors in panel order) and
 * `window.__DEMO_EDITOR__` (the first). Mirrors apps/demo-vanilla.
 */

interface PanelSpec { id: number; withToolbar: boolean }

// Initial layout: one toolbar editor (the "Hero") plus two bubble-menu editors
// (the "columns") - the exact shape that exposed the bug.
const panels = ref<PanelSpec[]>([
  { id: 1, withToolbar: true },
  { id: 2, withToolbar: false },
  { id: 3, withToolbar: false },
]);
let nextId = 4;

// The parent is the single owner of the window globals. `alive` guards against
// a child's unmount emit re-populating the global after this component (which
// unmounts FIRST in Vue) has already cleared it on mode switch.
const editorMap = new Map<number, Editor>();
let alive = true;

function writeGlobal(): void {
  if (!alive) return;
  const w = window as unknown as Record<string, unknown>;
  const ordered = panels.value
    .map((p) => editorMap.get(p.id))
    .filter((e): e is Editor => Boolean(e));
  w.__MULTI_EDITORS__ = ordered;
  w.__DEMO_EDITOR__ = ordered[0] ?? null;
}

function onEditor(id: number, editor: Editor | null): void {
  if (editor) editorMap.set(id, editor);
  else editorMap.delete(id);
  writeGlobal();
}

function addEditor(withToolbar: boolean): void {
  panels.value = [...panels.value, { id: nextId++, withToolbar }];
}
function removeEditor(id: number): void {
  panels.value = panels.value.filter((s) => s.id !== id);
}

onBeforeUnmount(() => {
  alive = false;
  const w = window as unknown as Record<string, unknown>;
  delete w.__MULTI_EDITORS__;
  delete w.__DEMO_EDITOR__;
});
</script>

<template>
  <div class="app-multi-editor-demo">
    <p style="color: var(--dm-text-muted, #9a9aa2); margin: 0 0 12px;">
      Several independent editors, all built from one shared extension config. Lists keep working in every editor,
      including ones mounted before later editors. Add or remove editors at runtime to confirm nothing else breaks.
    </p>

    <div style="display: flex; gap: 8px; margin: 0 0 16px;">
      <button data-testid="multi-add-bubble" @click="addEditor(false)">+ Add editor (bubble menu)</button>
      <button data-testid="multi-add-toolbar" @click="addEditor(true)">+ Add editor (toolbar)</button>
    </div>

    <div
      class="multi-editor-grid"
      style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; align-items: start;"
    >
      <MultiEditorPanel
        v-for="(spec, i) in panels"
        :key="spec.id"
        :spec="spec"
        :index="i"
        @editor="onEditor"
        @remove="removeEditor"
      />
    </div>
  </div>
</template>
