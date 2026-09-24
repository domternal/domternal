/** Types of the parts of semantics.mjs that TypeScript specs use. */
export interface SemanticBlock {
  readonly type: string;
  readonly text: string;
  readonly [key: string]: unknown;
}
export interface ContentSpecification {
  readonly documents: readonly { readonly blocks: readonly { readonly id: string; readonly type: string; readonly [key: string]: unknown }[] }[];
  readonly scenarios: readonly { readonly id: string; readonly blocks: readonly string[]; readonly [key: string]: unknown }[];
}
export function blocksFromEditorJSON(doc: unknown): SemanticBlock[];
export function blocksFromHTML(html: string): SemanticBlock[];
export function compareBlocks(spec: ContentSpecification, scenarioId: string, actualBlocks: readonly SemanticBlock[], options?: { formatting?: 'preserve' | 'adapt' }): string[];
