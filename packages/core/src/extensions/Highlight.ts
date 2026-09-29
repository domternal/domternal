import { coreMessages } from '../messages/core.js';
import { localizedLabel } from '../utils/localizeMessage.js';
import { localizedGroup } from '../messages/presentation.js';
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
import { isBlankStyleValue, isSafeCssValue } from '../helpers/isSafeCssValue.js';
import { surfaceToneAttributes } from '../helpers/surfaceTone.js';
import { InputRule } from '@domternal/pm/inputrules';
import { DOMSerializer } from '@domternal/pm/model';
import type { DOMOutputSpec, Mark as PMMark } from '@domternal/pm/model';
import { Plugin, PluginKey } from '@domternal/pm/state';
import type { EditorView, MarkView } from '@domternal/pm/view';
import type { CommandSpec } from '../types/Commands.js';
import type { ToolbarItem } from '../types/Toolbar.js';

declare module '@domternal/core' {
  interface RawCommands {
    setHighlight: CommandSpec<[attributes?: { color?: string }]>;
    unsetHighlight: CommandSpec;
    toggleHighlight: CommandSpec<[attributes?: { color?: string }]>;
    setBackgroundColorToken: CommandSpec<[token: string | null]>;
    unsetBackgroundColorToken: CommandSpec;
  }
}

/**
 * Default 25-color highlight palette (5 columns x 5 rows).
 * Row 1–2: warm pastels (yellow → pink)
 * Row 3–4: cool pastels (green → purple)
 * Row 5: neutrals
 */
export const DEFAULT_HIGHLIGHT_COLORS: string[] = [
  // Row 1 - Classic warm highlights
  '#fef08a', '#fde68a', '#fed7aa', '#fecaca', '#fbcfe8',
  // Row 2 - Lighter warm pastels
  '#fef9c3', '#fef3c7', '#ffedd5', '#fee2e2', '#fce7f3',
  // Row 3 - Cool highlights
  '#a7f3d0', '#99f6e4', '#a5f3fc', '#bfdbfe', '#c4b5fd',
  // Row 4 - Lighter cool pastels
  '#d1fae5', '#ccfbf1', '#cffafe', '#dbeafe', '#ede9fe',
  // Row 5 - Neutrals
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

/** The plugin that marks highlighted runs with the tone of their background in the editor view. */
export const highlightSurfaceToneKey = new PluginKey('highlightSurfaceTone');

/**
 * A textStyle mark view that renders exactly what ProseMirror renders by
 * default, and adds `data-dm-tone` when the mark draws its own background
 * color: light or dark, and mid for a mid tone (surfaceToneAttributes). The
 * theme draws text without a color of its own in black or white on it. A
 * painted color the editor cannot read is marked `unknown`, and its value
 * goes to the theme as `--dm-tone-surface` after the run's own style. It
 * lives in the view only, so stored content, getHTML, generateHTML and
 * clipboard HTML never carry it. A textStyle mark view an application
 * registers in a plugin of higher priority takes its place.
 */
function surfaceToneMarkView(mark: PMMark, view: EditorView, inline: boolean): MarkView {
  const toDOM = mark.type.spec.toDOM;
  // The same call ProseMirror's own mark rendering makes, attributes passed so array values stay attributes.
  const render = DOMSerializer.renderSpec.bind(DOMSerializer) as (
    doc: Document, structure: DOMOutputSpec, xmlNS: string | null, blockArraysIn: Record<string, unknown>,
  ) => { dom: Node; contentDOM?: HTMLElement };
  const rendered = render(view.dom.ownerDocument, toDOM ? toDOM(mark, inline) : ['span', 0], null, mark.attrs);
  const tone = mark.attrs['backgroundColorToken'] ? null : surfaceToneAttributes(mark.attrs['backgroundColor']);
  // An element node; the default rendering of a mark always is one.
  if (tone && rendered.dom.nodeType === 1) {
    const element = rendered.dom as Element;
    element.setAttribute('data-dm-tone', tone['data-dm-tone']);
    const style = element.getAttribute('style')?.replace(/[\s;]+$/, '');
    if (tone.style) element.setAttribute('style', style ? `${style}; ${tone.style}` : tone.style);
  }
  const dom = rendered.dom as HTMLElement;
  return rendered.contentDOM ? { dom, contentDOM: rendered.contentDOM } : { dom };
}

export const Highlight = Extension.create<HighlightOptions>({
  name: 'highlight',

  dependencies: ['textStyle'],

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
              // Token wins: when a named token is set, render data attribute
              // only (below) so theme variables control the actual color.
              const token = attributes['backgroundColorToken'] as string | null;
              // A stored value that could add a declaration or load a
              // resource is not written; the document keeps it.
              if (!bg || token || !isSafeCssValue(bg)) return null;
              return { style: `background-color: ${bg}` };
            },
          },
          backgroundColorToken: {
            default: null,
            parseHTML: (element: HTMLElement) => element.getAttribute('data-bg-color'),
            renderHTML: (attributes: Record<string, unknown>) => {
              const token = attributes['backgroundColorToken'] as string | null;
              if (!token) return null;
              return { 'data-bg-color': token };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    const defaultColor = this.options.defaultColor;
    return {
      // Hex-based highlight. Mutual exclusion: clears any named bg token so
      // the legacy hex picker and the Notion-style picker can't write
      // conflicting values to the same mark.
      setHighlight:
        (attributes?: { color?: string }) =>
        ({ commands }) => {
          const color = attributes?.color ?? defaultColor;
          // An empty value, such as a "Default" option, clears the highlight.
          if (isBlankStyleValue(color)) return commands.unsetHighlight();
          if (!isSafeCssValue(color)) return false;
          return commands.setMark('textStyle', { backgroundColor: color, backgroundColorToken: null });
        },

      unsetHighlight:
        () =>
        ({ commands }) => {
          // Clear both the hex background and the named token so the "Default"
          // swatch also resets token-based highlights.
          if (!commands.setMark('textStyle', { backgroundColor: null, backgroundColorToken: null })) return false;
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
            hasHighlight =
              !!mark?.attrs['backgroundColor'] || !!mark?.attrs['backgroundColorToken'];
          } else {
            state.doc.nodesBetween(from, to, (node) => {
              if (hasHighlight) return false;
              const mark = markType.isInSet(node.marks);
              if (mark?.attrs['backgroundColor'] || mark?.attrs['backgroundColorToken']) {
                hasHighlight = true;
                return false;
              }
              return true;
            });
          }

          if (hasHighlight) {
            commands.setMark('textStyle', { backgroundColor: null, backgroundColorToken: null });
            commands.removeEmptyTextStyle();
            return true;
          }

          if (isBlankStyleValue(color)) return commands.unsetHighlight();
          if (!isSafeCssValue(color)) return false;
          return commands.setMark('textStyle', { backgroundColor: color, backgroundColorToken: null });
        },

      // Named-token highlight. Mutual exclusion: clears the hex
      // backgroundColor so the theme-aware data attribute is the sole source
      // of truth.
      setBackgroundColorToken:
        (token: string | null) =>
        ({ commands }) => {
          if (!commands.setMark('textStyle', { backgroundColorToken: token, backgroundColor: null })) {
            return false;
          }
          if (token === null) commands.removeEmptyTextStyle();
          return true;
        },

      unsetBackgroundColorToken:
        () =>
        ({ commands }) => {
          if (!commands.setMark('textStyle', { backgroundColorToken: null })) return false;
          commands.removeEmptyTextStyle();
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    return [new Plugin({ key: highlightSurfaceToneKey, props: { markViews: { textStyle: surfaceToneMarkView } } })];
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
          // Preserve the marks the matched text already had (stored marks
          // first, like Transaction.insertText) so highlighting inside
          // commented or formatted text does not strip those marks.
          const marks = tr.storedMarks ?? tr.doc.resolve(start).marksAcross(tr.doc.resolve(end));
          tr.replaceWith(start, end, state.schema.text(content, marks));
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
          ...localizedLabel(this.editor?.i18n, coreMessages.highlight),
          shortcut: 'Mod-Shift-H',
          group: 'format',
          ...localizedGroup(this.editor?.i18n, coreMessages.groupFormat),
          priority: 150,
        },
      ];
    }

    return [
      {
        type: 'dropdown',
        name: 'highlight',
        icon: 'highlighterCircle',
        ...localizedLabel(this.editor?.i18n, coreMessages.highlight),
        group: 'format',
        ...localizedGroup(this.editor?.i18n, coreMessages.groupFormat),
        priority: 150,
        layout: 'grid',
        gridColumns: this.options.columns,
        items: [
          {
            type: 'button' as const,
            name: 'unsetHighlight',
            command: 'unsetHighlight',
            icon: 'prohibit',
            ...localizedLabel(this.editor?.i18n, coreMessages.noHighlight),
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
