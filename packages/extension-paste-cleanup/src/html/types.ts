export type PasteSource = 'word' | 'google-docs' | 'libreoffice' | 'html';
export type PasteFormatting = 'preserve' | 'adapt';

/** Stable codes for host-owned localized feedback. Source content is never included. */
export type PasteDiagnosticCode =
  | 'input-limit' | 'structure-limit' | 'parse-failed'
  | 'unsafe-content-removed' | 'unsupported-formatting'
  | 'image-removed' | 'link-removed' | 'formatting-adapted';

export interface PasteDiagnostic {
  code: PasteDiagnosticCode;
  severity: 'info' | 'warning' | 'error';
  /** UTF-16 source offset, when the parser can locate the affected element. */
  offset?: number;
}

export interface PasteHTMLLimits {
  /** UTF-16 code units, checked before parsing. */
  maxInputLength: number;
  /** Parser allocation events, including text chunks and elements. */
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
