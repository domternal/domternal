/**
 * Dropcursor Extension
 *
 * Shows a visual indicator when dragging content to help users
 * see where the content will be dropped.
 */
import { dropCursor } from 'prosemirror-dropcursor';
import { Extension } from '../Extension.js';

export interface DropcursorOptions {
  /**
   * Color of the drop cursor line.
   * @default 'currentColor'
   */
  color: string;

  /**
   * Width of the drop cursor line in pixels.
   * @default 1
   */
  width: number;

  /**
   * CSS class to add to the drop cursor element.
   * @default undefined
   */
  class?: string;
}

export const Dropcursor = Extension.create<DropcursorOptions>({
  name: 'dropcursor',

  addOptions() {
    return {
      color: 'currentColor',
      width: 1,
    };
  },

  addProseMirrorPlugins() {
    return [
      dropCursor({
        color: this.options.color,
        width: this.options.width,
        ...(this.options.class ? { class: this.options.class } : {}),
      }),
    ];
  },
});
