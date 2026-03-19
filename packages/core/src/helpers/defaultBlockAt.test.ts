import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '../Editor.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Heading } from '../nodes/Heading.js';
import { defaultBlockAt } from './defaultBlockAt.js';

describe('defaultBlockAt', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) {
      editor.view.dom.remove();
      editor.destroy();
    }
  });

  it('returns paragraph type for document content match', () => {
    editor = new Editor({
      extensions: [Document, Text, Paragraph, Heading],
      content: '<p>Hello</p>',
    });
    const { doc } = editor.state;
    const match = doc.type.contentMatch;
    const result = defaultBlockAt(match);
    expect(result).toBeDefined();
    expect(result!.isTextblock).toBe(true);
  });

  it('returns null when no textblock types are available', () => {
    // Create a mock content match with no edges
    const mockMatch = {
      edgeCount: 0,
      edge: () => ({ type: { isTextblock: false, hasRequiredAttrs: () => false } }),
    };
    const result = defaultBlockAt(mockMatch as any);
    expect(result).toBeNull();
  });

  it('skips types with required attrs', () => {
    // Mock: first type has required attrs, second is a valid textblock
    let callCount = 0;
    const mockMatch = {
      edgeCount: 2,
      edge: (i: number) => {
        callCount++;
        if (i === 0) {
          return { type: { isTextblock: true, hasRequiredAttrs: () => true } };
        }
        return { type: { isTextblock: true, hasRequiredAttrs: () => false, name: 'paragraph' } };
      },
    };
    const result = defaultBlockAt(mockMatch as any);
    expect(result).toBeDefined();
    expect((result as any).name).toBe('paragraph');
    expect(callCount).toBe(2);
  });
});
