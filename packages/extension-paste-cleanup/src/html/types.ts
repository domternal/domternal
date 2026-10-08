/**
 * Where pasted HTML most likely came from, read from its markup. The list is open: a minor
 * release can add a source or detect one more precisely, so keep a default branch when you
 * switch on it.
 */
export type PasteSource = 'word' | 'google-docs' | 'libreoffice' | 'html';
export type PasteFormatting = 'preserve' | 'adapt';

/**
 * Stable codes for host-owned localized feedback. Source content is never included.
 * The list is open: a minor release can add a code, so keep a default branch when
 * you switch on it.
 */
export type PasteDiagnosticCode =
  | 'input-limit' | 'structure-limit' | 'parse-failed'
  | 'unsafe-content-removed' | 'unsupported-formatting'
  | 'image-removed' | 'link-removed' | 'formatting-adapted' | 'office-list-unsupported'
  | 'destination-formatting-unconfirmed' | 'destination-table-unsupported' | 'destination-heading-level-adapted'
  | 'hidden-text-removed';

export interface PasteDiagnostic {
  code: PasteDiagnosticCode;
  severity: 'info' | 'warning' | 'error';
  /** UTF-16 source offset, when the parser can locate the affected element. */
  offset?: number;
}

export interface PasteHTMLLimits {
  /** UTF-16 code units, checked before parsing. */
  maxInputLength: number;
  /** Parser allocation events and generated output tree nodes, including text and elements. */
  maxNodes: number;
  maxDepth: number;
  maxDiagnostics: number;
  maxTableCells: number;
  maxImages: number;
  /** Total declared raster pixels, including GIF frames. */
  maxImagePixels: number;
}

export interface NormalizePasteHTMLOptions {
  formatting?: PasteFormatting;
  /** Keep external text alignment in adapt mode. Preserve mode always keeps supported alignment. */
  preserveTextAlignment?: boolean;
  /** Remote images are removed by default so later rendering cannot fetch them. */
  allowRemoteImages?: boolean;
  /** Bounded PNG, JPEG, GIF, and WebP data URLs are retained by default. */
  allowDataImages?: boolean;
  /** Only an explicitly supplied HTTP(S) source URL can resolve relative links. */
  sourceURL?: string;
  limits?: Partial<PasteHTMLLimits>;
}

export interface NormalizePasteHTMLResult {
  status: 'cleaned' | 'rejected';
  html: string;
  source: PasteSource;
  diagnostics: PasteDiagnostic[];
  /** True when diagnostics were bounded; the HTML itself is never truncated. */
  diagnosticsTruncated: boolean;
}
