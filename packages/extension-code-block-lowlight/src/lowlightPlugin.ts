import { Plugin, PluginKey } from 'prosemirror-state';
import type { EditorState, Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import type { createLowlight } from 'lowlight';

/** The lowlight instance type (return type of createLowlight) */
export type Lowlight = ReturnType<typeof createLowlight>;

// Minimal hast types (lowlight output)
interface HastText {
  readonly type: 'text';
  readonly value: string;
}

interface HastElement {
  readonly type: 'element';
  readonly properties?: { readonly className?: readonly string[] };
  readonly children: readonly HastNode[];
}

type HastNode = HastText | HastElement;

export interface LowlightPluginOptions {
  name: string;
  lowlight: Lowlight | null;
  defaultLanguage: string | null;
  autoDetect: boolean;
}

/** Internal type after validation — lowlight guaranteed non-null */
interface ValidatedOptions extends LowlightPluginOptions {
  lowlight: Lowlight;
}

interface Token {
  text: string;
  classes: string[];
}

/** Flatten hast tree into a list of text tokens with their CSS classes */
function flattenNodes(nodes: readonly HastNode[], classes: string[] = []): Token[] {
  return nodes.flatMap((node): Token[] => {
    if (node.type === 'element') {
      const childClasses = [...classes, ...(node.properties?.className ?? [])];
      return flattenNodes(node.children, childClasses);
    }
    return [{ text: node.value, classes }];
  });
}

/** Create inline decorations for a single code block */
function decorateCodeBlock(
  node: PMNode,
  pos: number,
  lowlight: Lowlight,
  defaultLanguage: string | null,
  autoDetect: boolean,
): Decoration[] {
  const language = (node.attrs['language'] as string | null) ?? defaultLanguage;
  const text = node.textContent;
  if (!text) return [];

  let result;
  if (language && lowlight.registered(language)) {
    result = lowlight.highlight(language, text);
  } else if (autoDetect) {
    result = lowlight.highlightAuto(text);
  } else {
    return [];
  }

  const tokens = flattenNodes(result.children as HastNode[]);
  const decorations: Decoration[] = [];
  let offset = pos + 1; // +1 to skip the node's opening token

  for (const token of tokens) {
    if (token.classes.length > 0) {
      decorations.push(
        Decoration.inline(offset, offset + token.text.length, {
          class: token.classes.join(' '),
        }),
      );
    }
    offset += token.text.length;
  }

  return decorations;
}

/** Build decorations for all code blocks in the document */
function decorateAll(doc: PMNode, options: ValidatedOptions): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === options.name) {
      decorations.push(
        ...decorateCodeBlock(node, pos, options.lowlight, options.defaultLanguage, options.autoDetect),
      );
    }
  });
  return DecorationSet.create(doc, decorations);
}

export const lowlightPluginKey = new PluginKey('lowlight');

export function lowlightPlugin(options: LowlightPluginOptions): Plugin {
  const { lowlight } = options;
  if (!lowlight) {
    throw new Error(
      '[@domternal/extension-code-block-lowlight] The "lowlight" option is required. ' +
      'Provide a lowlight instance: CodeBlockLowlight.configure({ lowlight: createLowlight(common) })',
    );
  }

  // After validation, lowlight is guaranteed non-null
  const validated = { ...options, lowlight };

  return new Plugin({
    key: lowlightPluginKey,

    state: {
      init(_config: unknown, state: EditorState) {
        return decorateAll(state.doc, validated);
      },

      apply(tr: Transaction, decorationSet: DecorationSet, _oldState: EditorState, newState: EditorState) {
        if (!tr.docChanged) return decorationSet;

        // Compute changed ranges in final document coordinates
        // Uses oldStart/oldEnd from each step map, mapped through the full
        // remaining mapping to get final positions.
        const changedRanges: { from: number; to: number }[] = [];
        for (let i = 0; i < tr.steps.length; i++) {
          const map = tr.mapping.maps[i];
          if (!map) continue;
          map.forEach((oldStart: number, oldEnd: number) => {
            const from = tr.mapping.slice(i).map(oldStart, -1);
            const to = tr.mapping.slice(i).map(oldEnd, 1);
            changedRanges.push({ from, to });
          });
        }

        // Map existing decorations to new positions
        let updated = decorationSet.map(tr.mapping, tr.doc);

        // Find code blocks that overlap with changed ranges
        const affected: { node: PMNode; pos: number }[] = [];
        newState.doc.descendants((node, pos) => {
          if (node.type.name !== validated.name) return;
          const end = pos + node.nodeSize;
          if (changedRanges.some((r) => r.from <= end && r.to >= pos)) {
            affected.push({ node, pos });
          }
        });

        if (affected.length === 0) return updated;

        // Re-highlight only affected code blocks
        for (const block of affected) {
          const end = block.pos + block.node.nodeSize;
          const stale = updated.find(block.pos, end);
          updated = updated.remove(stale);

          const fresh = decorateCodeBlock(
            block.node, block.pos,
            validated.lowlight, validated.defaultLanguage, validated.autoDetect,
          );
          updated = updated.add(newState.doc, fresh);
        }

        return updated;
      },
    },

    props: {
      decorations(state: EditorState) {
        return lowlightPluginKey.getState(state) as DecorationSet | undefined;
      },
    },
  });
}
