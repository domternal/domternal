// @domternal/extension-markdown - public API.
// M-A2 ships serializer + parser; the extension and commands land next.

export { createMarkdownParser, parseMarkdown } from './parser/parser.js';
export type { MarkdownParser } from './parser/parser.js';
export { MarkdownParseState } from './parser/state.js';

export {
  createMarkdownSerializer,
  serializeMarkdown,
} from './serializer/serializer.js';
export type {
  MarkdownSerializer,
  MarkdownSerializerSpecOverrides,
  SerializeMarkdownOptions,
} from './serializer/serializer.js';

export { defaultMarkSpecs, defaultNodeSerializers } from './serializer/specs.js';
export { MarkdownSerializerState, backticksFor } from './serializer/state.js';
export type {
  MarkdownMarkSpec,
  MarkdownNodeSerializer,
  MarkdownSerializerOptions,
  MarkdownSerializerSpecs,
} from './serializer/state.js';

export type {
  MarkdownWarning,
  MarkdownWarningCode,
  SerializeMarkdownResult,
} from './types.js';
