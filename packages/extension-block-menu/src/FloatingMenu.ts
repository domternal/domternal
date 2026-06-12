/**
 * FloatingMenu extension: registers the floating-menu plugin under the shared
 * `floatingMenuPluginKey`. The plugin machinery (visibility, positioning,
 * dismiss, keyboard entry) lives in `@domternal/core` so framework wrappers
 * can build their menus without depending on this package; everything is
 * re-exported here for backward compatibility.
 */
import {
  Extension,
  createFloatingMenuPlugin,
  floatingMenuPluginKey,
  defaultFloatingMenuShouldShow,
} from '@domternal/core';
import type { Editor, FloatingMenuOptions } from '@domternal/core';

export {
  createFloatingMenuPlugin,
  floatingMenuPluginKey,
  showFloatingMenu,
  hideFloatingMenu,
  FLOATING_MENU_META,
} from '@domternal/core';
export type {
  FloatingMenuOptions,
  CreateFloatingMenuPluginOptions,
  FloatingMenuKeymap,
} from '@domternal/core';

export const FloatingMenu = Extension.create<FloatingMenuOptions>({
  name: 'floatingMenu',

  addOptions() {
    return {
      element: null,
      shouldShow: defaultFloatingMenuShouldShow,
      offset: 0,
      requireExplicitTrigger: false,
    };
  },

  addProseMirrorPlugins() {
    const { element, shouldShow, offset, keymap, requireExplicitTrigger } = this.options;
    if (!element) return [];
    const editor = this.editor as Editor | null;
    if (!editor) return [];

    return [
      createFloatingMenuPlugin({
        pluginKey: floatingMenuPluginKey,
        editor,
        element,
        shouldShow,
        offset,
        keymap,
        ...(requireExplicitTrigger !== undefined && { requireExplicitTrigger }),
      }),
    ];
  },
});
