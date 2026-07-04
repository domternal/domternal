export type MarkdownWarningCode =
  | 'unsupported-node'
  | 'unsupported-mark'
  | 'lossy-attribute';

/** A non-fatal fidelity loss that happened during conversion. */
export interface MarkdownWarning {
  code: MarkdownWarningCode;
  message: string;
  /** The node or mark type the warning originates from, when known. */
  nodeType?: string;
}

/** The serialized document plus everything that did not survive at full fidelity. */
export interface SerializeMarkdownResult {
  markdown: string;
  warnings: MarkdownWarning[];
}
