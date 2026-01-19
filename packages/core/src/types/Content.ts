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
