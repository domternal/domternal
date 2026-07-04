import type { Node as PMNode } from '@domternal/pm/model';
import type { SerializeMarkdownResult } from '../types.js';
import { defaultMarkSpecs, defaultNodeSerializers } from './specs.js';
import {
  MarkdownSerializerState,
  type MarkdownMarkSpec,
  type MarkdownNodeSerializer,
  type MarkdownSerializerOptions,
} from './state.js';

export interface MarkdownSerializerSpecOverrides {
  /** Extra or replacement node serializers, merged over the defaults. */
  nodes?: Record<string, MarkdownNodeSerializer>;
  /** Extra or replacement mark specs, merged over the defaults. */
  marks?: Record<string, MarkdownMarkSpec>;
}

export interface MarkdownSerializer {
  /** Serialize a document (or any block node) to Markdown. */
  serialize(node: PMNode): SerializeMarkdownResult;
}

export function createMarkdownSerializer(
  specs: MarkdownSerializerSpecOverrides = {},
  options: MarkdownSerializerOptions = {}
): MarkdownSerializer {
  const nodes = { ...defaultNodeSerializers, ...specs.nodes };
  const marks = { ...defaultMarkSpecs, ...specs.marks };
  return {
    serialize(node: PMNode): SerializeMarkdownResult {
      const state = new MarkdownSerializerState({ nodes, marks }, options);
      if (node.isTextblock) {
        state.render(node, node, 0);
      } else {
        state.renderContent(node);
      }
      return { markdown: state.finish().replace(/\n+$/, ''), warnings: state.warnings };
    },
  };
}

export interface SerializeMarkdownOptions extends MarkdownSerializerOptions {
  specs?: MarkdownSerializerSpecOverrides;
}

/** One-shot convenience wrapper around {@link createMarkdownSerializer}. */
export function serializeMarkdown(
  node: PMNode,
  options: SerializeMarkdownOptions = {}
): SerializeMarkdownResult {
  const { specs, ...serializerOptions } = options;
  return createMarkdownSerializer(specs, serializerOptions).serialize(node);
}
