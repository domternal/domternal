/**
 * Highlight Extension
 *
 * Adds background-color highlighting via the TextStyle mark.
 * Requires TextStyle mark to be enabled.
 *
 * @example
 * ```ts
 * import { TextStyle, Highlight } from '@domternal/core';
 *
 * const editor = new Editor({
 *   extensions: [
 *     // ... other extensions
 *     TextStyle,
 *     Highlight, // uses the default 25-color palette
 *   ],
 * });
 *
 * editor.commands.setHighlight({ color: '#fef08a' });
 * editor.commands.unsetHighlight();
 * editor.commands.toggleHighlight();
 * ```
 */
import { Extension } from '../Extension.js';
import { normalizeColor } from '../helpers/normalizeColor.js';
import { InputRule } from '@domternal/pm/inputrules';
import type { CommandSpec } from '../types/Commands.js';
import type { ToolbarItem } from '../types/Toolbar.js';

declare module '../types/Commands.js' {
  interface RawCommands {
    setHighlight: CommandSpec<[attributes?: { color?: string }]>;
    unsetHighlight: CommandSpec;
    toggleHighlight: CommandSpec<[attributes?: { color?: string }]>;
  }
}

/**
 * Default 25-color highlight palette (5 columns x 5 rows).
 * Row 1–2: warm pastels (yellow → pink)
 * Row 3–4: cool pastels (green → purple)
 * Row 5: neutrals
 */
export const DEFAULT_HIGHLIGHT_COLORS: string[] = [
  // Row 1 — Classic warm highlights
  '#fef08a', '#fde68a', '#fed7aa', '#fecaca', '#fbcfe8',
  // Row 2 — Lighter warm pastels
  '#fef9c3', '#fef3c7', '#ffedd5', '#fee2e2', '#fce7f3',
  // Row 3 — Cool highlights
  '#a7f3d0', '#99f6e4', '#a5f3fc', '#bfdbfe', '#c4b5fd',
  // Row 4 — Lighter cool pastels
  '#d1fae5', '#ccfbf1', '#cffafe', '#dbeafe', '#ede9fe',
  // Row 5 — Neutrals
  '#e5e7eb', '#d1d5db', '#f3f4f6', '#fafafa', '#ffffff',
];

export interface HighlightOptions {
  /**
   * List of color values for the highlight palette.
   * Pass an empty array to get a simple toggle button instead of a dropdown.
   */
  colors: string[];

  /**
   * Number of columns in the palette grid.
   * @default 5
   */
  columns: number;

  /**
   * Default highlight color used by keyboard shortcut and ==text== input rule.
   * @default '#fef08a'
   */
  defaultColor: string;
}

export const Highlight = Extension.create<HighlightOptions>({
  name: 'highlight',

  addOptions() {
    return {
      colors: DEFAULT_HIGHLIGHT_COLORS,
      columns: 5,
      defaultColor: '#fef08a',
    };
  },

  addGlobalAttributes() {
    const { options } = this;
    return [
      {
        types: ['textStyle'],
        attributes: {
          backgroundColor: {
            default: null,
            parseHTML: (element: HTMLElement) => {
              const raw = element.style.backgroundColor.replace(/['"]+/g, '');
              if (raw) return normalizeColor(raw);
              // Plain <mark> without inline background-color → use default
              if (element.tagName === 'MARK') return options.defaultColor;
              return null;
            },
            renderHTML: (attributes: Record<string, unknown>) => {
              const bg = attributes['backgroundColor'] as string | null;
              if (!bg) return null;
              return { style: `background-color: ${bg}` };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    const defaultColor = this.options.defaultColor;
    return {
      setHighlight:
        (attributes?: { color?: string }) =>
        ({ commands }) => {
          const color = attributes?.color ?? defaultColor;
          return commands.setMark('textStyle', { backgroundColor: color });
        },

      unsetHighlight:
        () =>
        ({ commands }) => {
          if (!commands.setMark('textStyle', { backgroundColor: null })) return false;
          commands.removeEmptyTextStyle();
          return true;
        },

      toggleHighlight:
        (attributes?: { color?: string }) =>
        ({ commands, state }) => {
          const color = attributes?.color ?? defaultColor;
          const markType = state.schema.marks['textStyle'];
          if (!markType) return false;

          const { from, to, empty } = state.selection;
          let hasHighlight = false;

          if (empty) {
            const marks = state.storedMarks ?? state.doc.resolve(from).marks();
            const mark = markType.isInSet(marks);
            hasHighlight = !!mark?.attrs['backgroundColor'];
          } else {
            state.doc.nodesBetween(from, to, (node) => {
              if (hasHighlight) return false;
              const mark = markType.isInSet(node.marks);
              if (mark?.attrs['backgroundColor']) {
                hasHighlight = true;
                return false;
              }
              return true;
            });
          }

          if (hasHighlight) {
            commands.setMark('textStyle', { backgroundColor: null });
            commands.removeEmptyTextStyle();
            return true;
          }

          return commands.setMark('textStyle', { backgroundColor: color });
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-h': () =>
        this.editor?.commands.toggleHighlight() ?? false,
    };
  },

  addInputRules() {
    const defaultColor = this.options.defaultColor;
    return [
      new InputRule(
        /(?:==)([^=]+)(?:==)$/,
        (state, match, start, end) => {
          const textStyleType = state.schema.marks['textStyle'];
          if (!textStyleType) return null;

          const content = match[1];
          if (!content) return null;

          const { tr } = state;
          tr.replaceWith(start, end, state.schema.text(content));
          tr.addMark(
            start,
            start + content.length,
            textStyleType.create({ backgroundColor: defaultColor }),
          );
          tr.removeStoredMark(textStyleType);
          return tr;
        },
      ),
    ];
  },

  addToolbarItems(): ToolbarItem[] {
    const defaultColor = this.options.defaultColor;

    if (this.options.colors.length === 0) {
      return [
        {
          type: 'button',
          name: 'highlight',
          command: 'toggleHighlight',
          isActive: { name: 'textStyle', attributes: { backgroundColor: defaultColor } },
          icon: 'highlighterCircle',
          label: 'Highlight',
          shortcut: 'Mod-Shift-H',
          group: 'format',
          priority: 150,
        },
      ];
    }

    return [
      {
        type: 'dropdown',
        name: 'highlight',
        icon: 'highlighterCircle',
        label: 'Highlight',
        group: 'format',
        priority: 150,
        layout: 'grid',
        gridColumns: this.options.columns,
        items: [
          {
            type: 'button' as const,
            name: 'unsetHighlight',
            command: 'unsetHighlight',
            icon: 'prohibit',
            label: 'No highlight',
          },
          ...this.options.colors.map((color, i) => ({
            type: 'button' as const,
            name: `highlight-${color}`,
            command: 'setHighlight',
            commandArgs: [{ color }],
            isActive: { name: 'textStyle', attributes: { backgroundColor: color } },
            icon: '',
            label: color,
            color,
            priority: 200 - i,
          })),
        ],
      },
    ];
  },
});
