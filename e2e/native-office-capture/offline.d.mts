/** Types of the parts of offline.mjs that TypeScript specs use. */
import type { ContentSpecification } from './semantics.mjs';

export interface PolicyOracle {
  readonly status: 'cleaned' | 'rejected';
  readonly source: 'word' | 'google-docs' | 'libreoffice' | 'html';
  readonly warnings: readonly string[];
  /** The fixture editor's outcome in one schema, or one per schema the fixture is pinned in. */
  readonly editor: EditorOutcome | readonly EditorOutcome[];
}
export interface EditorOutcome { readonly schema: 'default' | 'capability-full'; readonly notice: 'quiet' | 'visible'; readonly warnings: readonly string[] }
export interface SemanticExpected {
  readonly specification: string;
  readonly scenario: string;
  readonly partial?: { readonly first: string; readonly last: string };
  readonly blocks: readonly { readonly id: string; readonly type: string; readonly [key: string]: unknown }[];
  readonly preserve: PolicyOracle;
  readonly adapt: PolicyOracle;
}
export class CaptureEvidenceError extends Error { readonly code: string }
export function noticeCodes(diagnostics: readonly { readonly code: string; readonly severity: string }[]): string[];
export function readSemanticExpected(expected: unknown): SemanticExpected;
export function editorOutcomes(oracle: PolicyOracle): readonly EditorOutcome[];
export function semanticSpecification(expected: SemanticExpected): ContentSpecification;
export function verifyCaptureFixture(directory: string): Promise<{
  readonly integrity: { readonly qualification: false; readonly fixtureId: string; readonly redactions?: readonly unknown[];
    readonly derivation?: { readonly kind: 'english-text-variant'; readonly sourceSha256: string; readonly captureSha256: string; readonly manifestSha256: string } };
  readonly replay: { readonly kind: string; readonly outcomes: readonly { readonly formatting: string; readonly warnings?: readonly string[] }[] };
}>;
