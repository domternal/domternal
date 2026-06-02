<script setup lang="ts">
import { watch, onBeforeUnmount } from 'vue';
import { useEditor } from '@domternal/vue';
import { StarterKit, type AnyExtension } from '@domternal/core';

/**
 * "Tab + lists" demo (Vue). Two StarterKit editors embedded between form fields,
 * the page-builder / form scenario from issue #98.
 *
 *  - LEFT  (default StarterKit): `listIndent` OFF. Tab on a paragraph that
 *    merely follows a list moves focus to the next field.
 *  - RIGHT (StarterKit.configure({ listIndent: true })): opt-in. Tab on the
 *    paragraph after the list pulls it INTO the list, focus stays.
 *
 * E2E hook: `window.__TAB_EDITORS__` = [defaultEditor, optInEditor].
 */

const CONTENT =
  '<ul><li><p>Bullet one</p></li><li><p>Bullet two</p></li></ul>' +
  '<p>Para after list</p>' +
  '<p>Plain paragraph</p>';

const DEFAULT_EXT: AnyExtension[] = [StarterKit];
const OPT_IN_EXT: AnyExtension[] = [StarterKit.configure({ listIndent: true }) as AnyExtension];

const { editor: editorA, editorRef: editorRefA } = useEditor({ extensions: DEFAULT_EXT, content: CONTENT });
const { editor: editorB, editorRef: editorRefB } = useEditor({ extensions: OPT_IN_EXT, content: CONTENT });

function writeGlobal(): void {
  const w = window as unknown as Record<string, unknown>;
  w.__TAB_EDITORS__ = [editorA.value, editorB.value].filter(Boolean);
}
watch([editorA, editorB], writeGlobal, { immediate: true });
onBeforeUnmount(() => {
  const w = window as unknown as Record<string, unknown>;
  delete w.__TAB_EDITORS__;
});
</script>

<template>
  <div class="app-tab-indent-demo">
    <p style="color: var(--dm-text-muted, #9a9aa2); margin: 0 0 16px;">
      Two StarterKit editors embedded between form fields. Put the caret in "Para after list" and press Tab. Left
      (default): focus jumps to the next field. Right (listIndent: true): the paragraph is pulled into the list and
      focus stays.
    </p>

    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; align-items: start;">
      <div
        class="tab-indent-panel"
        :data-editor-index="0"
        style="border: 1px solid rgba(128, 128, 128, 0.3); border-radius: 8px; padding: 12px;"
      >
        <strong style="display: block; margin: 0 0 8px;">StarterKit (default - listIndent OFF)</strong>
        <input type="text" data-testid="tab-prev-0" placeholder="Field before editor 0" style="display: block; width: 100%; box-sizing: border-box; margin: 0 0 8px;" />
        <div class="dm-editor"><div ref="editorRefA" /></div>
        <input type="text" data-testid="tab-next-0" placeholder="Field after editor 0" style="display: block; width: 100%; box-sizing: border-box; margin: 8px 0 0;" />
      </div>

      <div
        class="tab-indent-panel"
        :data-editor-index="1"
        style="border: 1px solid rgba(128, 128, 128, 0.3); border-radius: 8px; padding: 12px;"
      >
        <strong style="display: block; margin: 0 0 8px;">StarterKit({ listIndent: true })</strong>
        <input type="text" data-testid="tab-prev-1" placeholder="Field before editor 1" style="display: block; width: 100%; box-sizing: border-box; margin: 0 0 8px;" />
        <div class="dm-editor"><div ref="editorRefB" /></div>
        <input type="text" data-testid="tab-next-1" placeholder="Field after editor 1" style="display: block; width: 100%; box-sizing: border-box; margin: 8px 0 0;" />
      </div>
    </div>
  </div>
</template>
