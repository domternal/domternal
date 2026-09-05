/**
 * Normalizes JSON content before it reaches Node.fromJSON.
 *
 * List marker attributes keep their strict validators, so direct
 * schema.nodeFromJSON and Node.check still reject an unknown value. The
 * editor's JSON entry points replace such a value with null instead of
 * failing, and report it as a diagnostic.
 */
import type { Schema } from '@domternal/pm/model';
import type { Transaction } from '@domternal/pm/state';
import type { ContentDiagnostic, JSONAttribute, JSONContent } from '../types/Content.js';
import type { ContentDiagnosticProps } from '../types/EditorEvents.js';
import { forEachNormalizedAttribute, normalizedAttributeTypes } from '../utils/normalizedAttributes.js';

export interface NormalizeContentOptions {
  /** Receives up to 100 diagnostics per call. Errors it throws are ignored. */
  readonly onDiagnostic?: (diagnostic: ContentDiagnostic) => void;
}

const REPORT_LIMIT = 100;
const DIAGNOSTICS_META = 'contentDiagnostics';

/** @internal Diagnostics of one entry point call: the first 100 kept, all counted. */
export interface ContentReport {
  readonly diagnostics: ContentDiagnostic[];
  total: number;
}

/** @internal What a transaction carries for Editor to emit once it is accepted. */
export type ContentDiagnosticRecord = Omit<ContentDiagnosticProps, 'editor'>;

/** @internal */
export const contentReport = (): ContentReport => ({ diagnostics: [], total: 0 });

/** @internal Records a replaced value, copying `path` because callers reuse it. */
export function reportReplacedValue(
  report: ContentReport,
  code: ContentDiagnostic['code'],
  nodeType: string,
  attribute: string,
  path: readonly number[],
  value: unknown,
): void {
  if (report.total++ >= REPORT_LIMIT) return;
  report.diagnostics.push(Object.freeze({
    code,
    nodeType,
    attribute,
    path: [...path],
    ...(typeof value === 'string' && value.length <= 64 ? { value } : {}),
  }));
}

/** @internal Delivers diagnostics; a throwing callback never interrupts loading content. */
export function deliverDiagnostics(report: ContentReport, onDiagnostic?: (diagnostic: ContentDiagnostic) => void): void {
  for (const diagnostic of report.diagnostics) {
    try { onDiagnostic?.(diagnostic); } catch { /* Diagnostics are advisory. */ }
  }
}

/** @internal Attaches diagnostics to a transaction, appending to any that an earlier command in a chain attached. */
export function recordContentDiagnostics(tr: Transaction, source: ContentDiagnosticRecord['source'], report: ContentReport): void {
  if (report.total === 0) return;
  const previous = contentDiagnosticsOf(tr);
  tr.setMeta(DIAGNOSTICS_META, {
    source: previous?.source ?? source,
    diagnostics: [...previous?.diagnostics ?? [], ...report.diagnostics].slice(0, REPORT_LIMIT),
    total: (previous?.total ?? 0) + report.total,
  });
}

/** @internal */
export const contentDiagnosticsOf = (tr: Transaction): ContentDiagnosticRecord | undefined =>
  tr.getMeta(DIAGNOSTICS_META) as ContentDiagnosticRecord | undefined;

/**
 * @internal Returns `content` with unsupported attribute values replaced,
 * copying only the objects on the way to a change. Malformed nodes pass
 * through for Node.fromJSON to reject.
 */
export function normalizeInto<T>(content: T, schema: Schema, report: ContentReport): T {
  if (normalizedAttributeTypes(schema).size === 0) return content;
  const path: number[] = [];
  const children = (list: readonly unknown[]): readonly unknown[] => {
    let copy: unknown[] | undefined;
    list.forEach((child, index) => {
      path.push(index);
      const next = node(child);
      path.pop();
      if (next !== child) (copy ??= [...list])[index] = next;
    });
    return copy ?? list;
  };
  const node = (value: unknown): unknown => {
    if (!value || typeof value !== 'object') return value;
    const json = value as JSONContent;
    let { attrs } = json;
    forEachNormalizedAttribute(schema, json.type, attrs, 'unsupported', (attribute, value, normalizer) => {
      attrs = { ...attrs, [attribute]: normalizer.replacement(value) as JSONAttribute };
      reportReplacedValue(report, normalizer.code, json.type, attribute, path, value);
    });
    const content = Array.isArray(json.content) ? children(json.content) : json.content;
    if (attrs === json.attrs && content === json.content) return value;
    return { ...json, ...(attrs !== json.attrs && { attrs }), ...(content !== json.content && { content }) };
  };
  return (Array.isArray(content) ? children(content) : node(content)) as T;
}

/**
 * Replaces list marker values this version does not know with null, the
 * default marker. The input is never mutated, and it is returned as is when
 * nothing changes. Apps can run this before handing stored JSON to consumers
 * that validate it, such as y-prosemirror's prosemirrorJSONToYDoc.
 */
export function normalizeContent<T extends JSONContent | readonly JSONContent[]>(
  content: T,
  schema: Schema,
  options: NormalizeContentOptions = {},
): T {
  const report = contentReport();
  const normalized = normalizeInto(content, schema, report);
  deliverDiagnostics(report, options.onDiagnostic);
  return normalized;
}
