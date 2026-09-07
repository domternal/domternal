/**
 * JSON representation of a ProseMirror node attribute
 */
export type JSONAttribute =
  | string
  | number
  | boolean
  | null
  | JSONAttribute[]
  | { [key: string]: JSONAttribute };

/**
 * JSON representation of a ProseMirror mark
 */
export interface JSONMark {
  type: string;
  attrs?: Record<string, JSONAttribute>;
}

/**
 * JSON representation of a ProseMirror node
 * This is the format used for serializing/deserializing editor content
 */
export interface JSONContent {
  type: string;
  attrs?: Record<string, JSONAttribute>;
  content?: JSONContent[];
  marks?: JSONMark[];
  text?: string;
}

/**
 * Content that can be passed to the editor
 * - string: HTML string to be parsed
 * - JSONContent: JSON representation of the document
 * - JSONContent[]: Array of nodes to insert
 * - null: Empty document
 */
export type Content = string | JSONContent | JSONContent[] | null;

/**
 * Represents a range in the document
 */
export interface Range {
  from: number;
  to: number;
}

/**
 * A value that normalization replaced, or a mark it removed: in JSON content
 * while it loaded, or in the editor document through the
 * normalizeContentAttributes command. `path` holds child indices from the
 * normalized input, or from the document for that command, to the node.
 *
 * - `unknown-list-marker`: a list marker this version does not know became
 *   null, the default marker.
 * - `unsupported-heading-level`: a heading level the Heading configuration
 *   lacks, or a value that is not a level, became the nearest configured level.
 * - `unsafe-url`: a link whose href could run script or deceive was removed,
 *   and its text kept: a `javascript:`, `vbscript:` or `data:` address,
 *   credentials in a web, mail or phone address, a control character or
 *   bidi override anywhere, a format character such as a zero-width joiner
 *   in the scheme or host, or a value that is not a string. No configuration
 *   allows these.
 * - `unsupported-url`: a link whose href this Link configuration does not
 *   allow was removed, and its text kept: a scheme outside `protocols`, a
 *   relative reference the Link does not allow, a network path, a backslash,
 *   an address the URL parser rejects, or an empty or missing href.
 */
export interface ContentDiagnostic {
  readonly code: 'unknown-list-marker' | 'unsupported-heading-level' | 'unsafe-url' | 'unsupported-url';
  /** The node that holds the value, or that carries the removed mark, such as `text`. */
  readonly nodeType: string;
  /** The type of the removed mark, such as `link`; absent when a node's value was replaced. */
  readonly markType?: string;
  readonly attribute: string;
  readonly path: readonly number[];
  /** The replaced value, only when it is a string of at most 64 characters or a finite number. */
  readonly value?: string | number;
}
