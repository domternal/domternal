/**
 * Test helpers for @domternal/core
 */

// Schema and test documents
export {
  testSchema,
  emptyDoc,
  simpleDoc,
  boldDoc,
  testHTML,
} from './testSchema.js';

// Editor factory
export {
  createTestEditor,
  createEmptyEditor,
  createEditorWithContent,
  type CreateTestEditorOptions,
} from './createTestEditor.js';
