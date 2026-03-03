/**
 * Suppress column-resize handle during non-resize mouse drags.
 *
 * The columnResizing plugin detects cell borders on every mousemove and
 * shows a blue resize line — confusing when the user is dragging to
 * select cells or text, not to resize a column. This plugin adds a
 * `dm-mouse-drag` CSS class during non-resize drags and blocks
 * columnResizing's mousemove handler from detecting borders.
 */

import { Plugin } from 'prosemirror-state';
import { columnResizingPluginKey } from 'prosemirror-tables';

export function createResizeSuppressionPlugin(): Plugin {
  return new Plugin({
    props: {
      handleDOMEvents: {
        mousedown: (view, event) => {
          if (event.button !== 0) return false;
          // Only suppress for non-resize drags (activeHandle === -1 means
          // the cursor is NOT on a column border)
          const resizeState = columnResizingPluginKey.getState(view.state) as
            | { activeHandle: number; dragging: unknown } | undefined;
          if (!resizeState || resizeState.activeHandle === -1) {
            view.dom.classList.add('dm-mouse-drag');
            document.addEventListener('mouseup', () => {
              view.dom.classList.remove('dm-mouse-drag');
            }, { once: true });
          }
          return false;
        },
        mousemove: (view, event) => {
          if (event.buttons !== 1) return false;
          // Allow columnResizing to process during active column resize
          const resizeState = columnResizingPluginKey.getState(view.state) as
            | { activeHandle: number; dragging: unknown } | undefined;
          if (resizeState?.dragging) return false;
          // Block columnResizing from detecting borders during drag
          return true;
        },
      },
    },
  });
}
