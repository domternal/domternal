// @domternal/extension-markdown - public API.
// M-A1 ships the serializer; the parser, extension, and commands land next.

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
