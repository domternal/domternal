/**
 * Normalizes JSON content before it reaches Node.fromJSON.
 *
 * List marker, heading level and link href attributes keep their strict
 * validators, so direct schema.nodeFromJSON and Node.check still reject an
 * invalid value. The editor's JSON entry points replace such a value, or
 * remove the link that carries it, instead of failing, and report it as a
 * diagnostic: an unknown list marker becomes null, a heading level the
 * configuration lacks, or a value that is not a level, becomes the nearest
 * configured level, and a link whose href the URL policy refuses is removed
 * while its text stays.
 */
import type { Schema } from '@domternal/pm/model';
import type { Transaction } from '@domternal/pm/state';
import type { ContentDiagnostic, JSONAttribute, JSONContent, JSONMark } from '../types/Content.js';
import type { ContentDiagnosticProps } from '../types/EditorEvents.js';
import { diagnosticCode, forEachNormalizedAttribute, normalizedAttributeTypes } from '../utils/normalizedAttributes.js';

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

/**
 * @internal Records a replaced value, or a removed mark when `markType` is
 * given, copying `path` because callers reuse it.
 */
export function reportReplacedValue(
  report: ContentReport,
  code: ContentDiagnostic['code'],
  nodeType: string,
  attribute: string,
  path: readonly number[],
  value: unknown,
  markType?: string,
): void {
  if (report.total++ >= REPORT_LIMIT) return;
  report.diagnostics.push(Object.freeze({
    code,
    nodeType,
    ...(markType !== undefined && { markType }),
    attribute,
    path: [...path],
    ...((typeof value === 'string' && value.length <= 64) || (typeof value === 'number' && Number.isFinite(value)) ? { value } : {}),
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
 * @internal Returns `content` with unsupported attribute values replaced and
 * marks with an unsupported value removed, copying only the objects on the
 * way to a change. Malformed nodes and marks pass through for Node.fromJSON
 * to reject.
 */
export function normalizeInto<T>(content: T, schema: Schema, report: ContentReport): T {
  if (normalizedAttributeTypes(schema).size === 0) return content;
  const path: number[] = [];
  const marksOf = (list: readonly unknown[], nodeType: string): readonly unknown[] => {
    let kept: unknown[] | undefined;
    list.forEach((item, index) => {
      let next: unknown = item;
      if (item && typeof item === 'object') {
        const mark = item as JSONMark;
        const result = { attrs: mark.attrs, removed: false };
        forEachNormalizedAttribute(schema, mark.type, mark.attrs, 'unsupported', (attribute, value, normalizer) => {
          if (result.removed) return;
          reportReplacedValue(report, diagnosticCode(normalizer, value), nodeType, attribute, path, value, mark.type);
          if (normalizer.removesMark) result.removed = true;
          else result.attrs = { ...result.attrs, [attribute]: normalizer.replacement(value) as JSONAttribute };
        });
        next = result.removed ? undefined : result.attrs === mark.attrs ? item : { ...mark, attrs: result.attrs };
      }
      if (next !== item) kept ??= list.slice(0, index);
      if (kept && next !== undefined) kept.push(next);
    });
    return kept ?? list;
  };
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
      reportReplacedValue(report, diagnosticCode(normalizer, value), json.type, attribute, path, value);
    });
    const marks = Array.isArray(json.marks) ? marksOf(json.marks, json.type) : json.marks;
    const content = Array.isArray(json.content) ? children(json.content) : json.content;
    if (attrs === json.attrs && content === json.content && marks === json.marks) return value;
    const { marks: _marks, ...rest } = json;
    return {
      ...rest,
      ...(attrs !== json.attrs && { attrs }),
      ...(content !== json.content && { content }),
      // A node whose every mark was removed keeps no empty list.
      ...(marks !== undefined && (marks !== json.marks ? marks.length > 0 : true) && { marks }),
    };
  };
  return (Array.isArray(content) ? children(content) : node(content)) as T;
}

/**
 * Replaces list marker values this version does not know with null, the
 * default marker, and heading levels the configuration lacks, or values that
 * are not levels, with the nearest configured level, and removes links whose
 * href the Link's URL policy refuses, keeping their text. The input is never
 * mutated, and it is returned as is when nothing changes. Apps can run this
 * before handing stored JSON to consumers that validate it, such as
 * y-prosemirror's prosemirrorJSONToYDoc.
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
