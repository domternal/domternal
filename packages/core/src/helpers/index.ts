/**
 * Helper utilities for @domternal/core
 */

export { createDocument, type CreateDocumentOptions } from './createDocument.js';
export {
  isNodeEmpty,
  isDocumentEmpty,
  type IsNodeEmptyOptions,
} from './isNodeEmpty.js';
export { callOrReturn } from './callOrReturn.js';
export {
  markInputRule,
  markInputRulePatterns,
  type MarkInputRuleOptions,
} from './markInputRule.js';
export {
  wrappingInputRule,
  notInsideList,
  type WrappingInputRuleOptions,
} from './wrappingInputRule.js';
export {
  textblockTypeInputRule,
  type TextblockTypeInputRuleOptions,
} from './textblockTypeInputRule.js';
export {
  textInputRule,
  type TextInputRuleOptions,
} from './textInputRule.js';
export {
  nodeInputRule,
  type NodeInputRuleOptions,
} from './nodeInputRule.js';
export {
  isValidUrl,
  type IsValidUrlOptions,
} from './isValidUrl.js';
export {
  generateHTML,
  generateJSON,
  generateText,
  type GenerateHTMLOptions,
  type GenerateJSONOptions,
  type GenerateTextOptions,
} from './ssr.js';
export { getMarkRange, type MarkRange } from './getMarkRange.js';
export {
  findParentNode,
  type FindParentNodeResult,
} from './findParentNode.js';
export { findChildren, type FindChildResult } from './findChildren.js';
export { defaultBlockAt } from './defaultBlockAt.js';
