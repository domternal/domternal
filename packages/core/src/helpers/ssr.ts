/**
 * SSR Helpers
 *
 * Utilities for server-side rendering and content conversion.
 * - generateHTML: Convert JSON content to HTML string
 * - generateJSON: Convert HTML string to JSON content
 * - generateText: Extract plain text from JSON content
 *
 * Note: SSR environment requires 'linkedom' package (optional peer dependency).
 */
import {
  Node as PMNode,
  DOMSerializer,
  DOMParser as PMDOMParser,
} from 'prosemirror-model';
import type { Schema } from 'prosemirror-model';
import type { AnyExtension, JSONContent } from '../types/index.js';
import { ExtensionManager } from '../ExtensionManager.js';

// Declare global require for Node.js environment
declare const require: (id: string) => unknown;

/**
 * Build a ProseMirror schema from extensions.
 * Used internally by SSR helpers.
 */
function buildSchemaFromExtensions(extensions: AnyExtension[]): Schema {
  // Create a minimal editor-like object for ExtensionManager
  const mockEditor = {
    state: null,
    view: null,
    schema: null,
    commands: {},
  };

  const manager = new ExtensionManager(
    { extensions },
    mockEditor as never
  );
  return manager.schema;
}

/**
 * Get a DOM document for parsing/serialization.
 * Uses native document in browser, linkedom in Node.js.
 */
function getDocument(): Document {
  // Browser environment
  if (typeof window !== 'undefined') {
    return window.document;
  }

  // Server environment - try linkedom
  try {
    // Dynamic require to avoid bundling linkedom in browser builds
    const linkedom = require('linkedom') as { parseHTML: (html: string) => { document: Document } };
    const { document } = linkedom.parseHTML('<!DOCTYPE html><html><body></body></html>');
    return document;
  } catch {
    throw new Error(
      'SSR requires "linkedom" package. Install it with: pnpm add linkedom'
    );
  }
}

export interface GenerateHTMLOptions {
  /**
   * Custom document implementation. If not provided, uses native document
   * in browser or linkedom in Node.js.
   */
  document?: Document;
}

/**
 * Generate HTML string from JSON content.
 *
 * @param content - The JSON content to convert
 * @param extensions - Extensions that define the schema
 * @param options - Optional configuration
 * @returns HTML string
 *
 * @example
 * ```ts
 * const html = generateHTML(
 *   { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }] },
 *   [Document, Paragraph, Text]
 * );
 * // Returns: '<p>Hello</p>'
 * ```
 */
export function generateHTML(
  content: JSONContent,
  extensions: AnyExtension[],
  options: GenerateHTMLOptions = {}
): string {
  const schema = buildSchemaFromExtensions(extensions);
  const doc = PMNode.fromJSON(schema, content);
  const targetDocument = options.document ?? getDocument();

  const serializer = DOMSerializer.fromSchema(schema);
  const fragment = serializer.serializeFragment(doc.content, {
    document: targetDocument,
  });

  const container = targetDocument.createElement('div');
  container.appendChild(fragment);

  return container.innerHTML;
}

export interface GenerateJSONOptions {
  /**
   * Custom document implementation. If not provided, uses native document
   * in browser or linkedom in Node.js.
   */
  document?: Document;
}

/**
 * Generate JSON content from HTML string.
 *
 * @param html - The HTML string to convert
 * @param extensions - Extensions that define the schema
 * @param options - Optional configuration
 * @returns JSON content object
 *
 * @example
 * ```ts
 * const json = generateJSON(
 *   '<p>Hello</p>',
 *   [Document, Paragraph, Text]
 * );
 * // Returns: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }] }
 * ```
 */
export function generateJSON(
  html: string,
  extensions: AnyExtension[],
  options: GenerateJSONOptions = {}
): JSONContent {
  const schema = buildSchemaFromExtensions(extensions);
  const targetDocument = options.document ?? getDocument();

  // Parse HTML into DOM
  const container = targetDocument.createElement('div');
  container.innerHTML = html;

  // Use ProseMirror's DOMParser
  const parser = PMDOMParser.fromSchema(schema);
  const doc = parser.parse(container);

  return doc.toJSON() as JSONContent;
}

export interface GenerateTextOptions {
  /**
   * Separator between block elements.
   * @default '\n\n'
   */
  blockSeparator?: string;
}

/**
 * Generate plain text from JSON content.
 *
 * @param content - The JSON content to extract text from
 * @param extensions - Extensions that define the schema
 * @param options - Optional configuration
 * @returns Plain text string
 *
 * @example
 * ```ts
 * const text = generateText(
 *   { type: 'doc', content: [
 *     { type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] },
 *     { type: 'paragraph', content: [{ type: 'text', text: 'World' }] }
 *   ]},
 *   [Document, Paragraph, Text]
 * );
 * // Returns: 'Hello\n\nWorld'
 * ```
 */
export function generateText(
  content: JSONContent,
  extensions: AnyExtension[],
  options: GenerateTextOptions = {}
): string {
  const { blockSeparator = '\n\n' } = options;
  const schema = buildSchemaFromExtensions(extensions);
  const doc = PMNode.fromJSON(schema, content);

  return doc.textBetween(0, doc.content.size, blockSeparator);
}
