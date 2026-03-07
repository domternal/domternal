/**
 * ClearFormatting Extension
 *
 * Adds a toolbar button that removes all formatting marks from the current
 * selection. Marks with `isFormatting: false` (like Link) are preserved.
 *
 * Uses the built-in `unsetAllMarks` command.
 *
 * @example
 * ```ts
 * import { ClearFormatting } from '@domternal/core';
 *
 * const editor = new Editor({
 *   extensions: [
 *     // ... other extensions
 *     ClearFormatting,
 *   ],
 * });
 *
 * editor.commands.unsetAllMarks(); // removes formatting marks from selection
 * ```
 */
import { Extension } from '../Extension.js';
import type { ToolbarItem } from '../types/Toolbar.js';

export const ClearFormatting = Extension.create({
  name: 'clearFormatting',

  addToolbarItems(): ToolbarItem[] {
    return [
      {
        type: 'button',
        name: 'clearFormatting',
        command: 'unsetAllMarks',
        icon: 'textTSlash',
        label: 'Clear Formatting',
        group: 'utilities',
        priority: 200,
      },
    ];
  },
});
