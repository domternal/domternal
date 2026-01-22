/**
 * Test factory for creating Editor instances
 *
 * Provides convenient defaults for testing:
 * - Uses testSchema by default
 * - Creates detached div element (no DOM mounting needed)
 * - Sensible default options
 */
import type { Schema } from 'prosemirror-model';
import type { EditorOptions } from '../../src/types/index.js';
import { testSchema, emptyDoc, simpleDoc, boldDoc } from './testSchema.js';

// Editor import will be added when Editor class is implemented
// import { Editor } from '../../src/Editor.js';

/**
 * Options for createTestEditor factory
 */
export interface CreateTestEditorOptions
  extends Omit<EditorOptions, 'schema' | 'extensions'> {
  /**
   * ProseMirror schema to use
   * @default testSchema
   */
  schema?: Schema;
}

/**
 * Creates an Editor instance with test-friendly defaults
 *
 * @example
 * ```ts
 * // Basic usage - uses testSchema and empty content
 * const editor = createTestEditor();
 *
 * // With specific content
 * const editor = createTestEditor({
 *   content: '<p>Hello world</p>',
 * });
 *
 * // With custom schema
 * const editor = createTestEditor({
 *   schema: myCustomSchema,
 * });
 * ```
 */
export function createTestEditor(
  options: CreateTestEditorOptions = {}
): unknown {
  // TODO: Implement when Editor class is available
  // const { schema = testSchema, ...editorOptions } = options;
  //
  // return new Editor({
  //   schema,
  //   ...editorOptions,
  // });

  throw new Error(
    'createTestEditor: Editor class not yet implemented. ' +
      'This helper will be functional after Phase E.'
  );
}

/**
 * Creates an Editor with empty content
 */
export function createEmptyEditor(
  options: Omit<CreateTestEditorOptions, 'content'> = {}
): unknown {
  return createTestEditor({
    ...options,
    content: emptyDoc,
  });
}

/**
 * Creates an Editor with simple text content
 */
export function createEditorWithContent(
  options: Omit<CreateTestEditorOptions, 'content'> = {}
): unknown {
  return createTestEditor({
    ...options,
    content: simpleDoc,
  });
}

// Re-export test data for convenience
export { testSchema, emptyDoc, simpleDoc, boldDoc } from './testSchema.js';
