/**
 * Tests for LineHeight extension
 */
import { describe, it, expect, afterEach } from 'vitest';
import { LineHeight } from './LineHeight.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Heading } from '../nodes/Heading.js';
import { Editor } from '../Editor.js';

describe('LineHeight', () => {
  describe('configuration', () => {
    it('has correct name', () => {
      expect(LineHeight.name).toBe('lineHeight');
    });

    it('has default options', () => {
      expect(LineHeight.options).toEqual({
        types: ['paragraph', 'heading'],
        lineHeights: [],
        defaultLineHeight: null,
      });
    });

    it('can configure with custom types', () => {
      const CustomLineHeight = LineHeight.configure({
        types: ['paragraph'],
      });
      expect(CustomLineHeight.options.types).toEqual(['paragraph']);
    });

    it('can configure with allowed line heights', () => {
      const CustomLineHeight = LineHeight.configure({
        lineHeights: ['1', '1.5', '2'],
      });
      expect(CustomLineHeight.options.lineHeights).toEqual(['1', '1.5', '2']);
    });

    it('can configure with default line height', () => {
      const CustomLineHeight = LineHeight.configure({
        defaultLineHeight: '1.5',
      });
      expect(CustomLineHeight.options.defaultLineHeight).toBe('1.5');
    });
  });

  describe('addGlobalAttributes', () => {
    it('provides lineHeight attribute for configured types', () => {
      const globalAttrs = LineHeight.config.addGlobalAttributes?.call(LineHeight);

      expect(globalAttrs).toHaveLength(1);
      expect(globalAttrs?.[0]?.types).toContain('paragraph');
      expect(globalAttrs?.[0]?.types).toContain('heading');
      expect(globalAttrs?.[0]?.attributes).toHaveProperty('lineHeight');
    });

    it('lineHeight attribute has correct defaults', () => {
      const globalAttrs = LineHeight.config.addGlobalAttributes?.call(LineHeight);
      const lineHeightAttr = globalAttrs?.[0]?.attributes['lineHeight'];

      expect(lineHeightAttr?.default).toBe(null);
      expect(lineHeightAttr?.parseHTML).toBeDefined();
      expect(lineHeightAttr?.renderHTML).toBeDefined();
    });

    it('parseHTML extracts line-height from style', () => {
      const globalAttrs = LineHeight.config.addGlobalAttributes?.call(LineHeight);
      const parseHTML = globalAttrs?.[0]?.attributes['lineHeight']?.parseHTML;

      const element = document.createElement('p');
      element.style.lineHeight = '1.5';

      expect(parseHTML?.(element)).toBe('1.5');
    });

    it('renderHTML outputs line-height style', () => {
      const globalAttrs = LineHeight.config.addGlobalAttributes?.call(LineHeight);
      const renderHTML = globalAttrs?.[0]?.attributes['lineHeight']?.renderHTML;

      const result = renderHTML?.({ lineHeight: '2' });
      expect(result).toEqual({ style: 'line-height: 2' });
    });

    it('renderHTML returns null for null lineHeight', () => {
      const globalAttrs = LineHeight.config.addGlobalAttributes?.call(LineHeight);
      const renderHTML = globalAttrs?.[0]?.attributes['lineHeight']?.renderHTML;

      const result = renderHTML?.({ lineHeight: null });
      expect(result).toBe(null);
    });

    it('renderHTML returns null for default lineHeight', () => {
      const CustomLineHeight = LineHeight.configure({
        defaultLineHeight: '1.5',
      });

      const globalAttrs = CustomLineHeight.config.addGlobalAttributes?.call(CustomLineHeight);
      const renderHTML = globalAttrs?.[0]?.attributes['lineHeight']?.renderHTML;

      const result = renderHTML?.({ lineHeight: '1.5' });
      expect(result).toBe(null);
    });
  });

  describe('addCommands', () => {
    it('provides setLineHeight command', () => {
      const commands = LineHeight.config.addCommands?.call(LineHeight);

      expect(commands).toHaveProperty('setLineHeight');
      expect(typeof commands?.['setLineHeight']).toBe('function');
    });

    it('provides unsetLineHeight command', () => {
      const commands = LineHeight.config.addCommands?.call(LineHeight);

      expect(commands).toHaveProperty('unsetLineHeight');
      expect(typeof commands?.['unsetLineHeight']).toBe('function');
    });
  });

  describe('line height validation', () => {
    it('rejects invalid line height when lineHeights list is provided', () => {
      const CustomLineHeight = LineHeight.configure({
        lineHeights: ['1', '1.5', '2'],
      });

      const commands = CustomLineHeight.config.addCommands?.call(CustomLineHeight);
      const setLineHeight = commands?.['setLineHeight'] as (lh: string) => unknown;

      const mockContext = {
        commands: {
          updateAttributes: () => true,
        },
      };

      const handler = setLineHeight('3');
      const result = (handler as (ctx: typeof mockContext) => boolean)(mockContext);

      expect(result).toBe(false);
    });

    it('accepts valid line height when lineHeights list is provided', () => {
      const CustomLineHeight = LineHeight.configure({
        lineHeights: ['1', '1.5', '2'],
      });

      const commands = CustomLineHeight.config.addCommands?.call(CustomLineHeight);
      const setLineHeight = commands?.['setLineHeight'] as (lh: string) => unknown;

      const mockContext = {
        commands: {
          updateAttributes: () => true,
        },
      };

      const handler = setLineHeight('1.5');
      const result = (handler as (ctx: typeof mockContext) => boolean)(mockContext);

      expect(result).toBe(true);
    });
  });

  describe('integration', () => {
    let editor: Editor | undefined;

    afterEach(() => {
      if (editor && !editor.isDestroyed) {
        editor.destroy();
      }
    });

    it('works with Editor', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Heading, LineHeight],
        content: '<p style="line-height: 1.5">Line height text</p>',
      });

      expect(editor.getText()).toContain('Line height text');
    });

    it('parses line height from HTML', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, LineHeight],
        content: '<p style="line-height: 2">Text</p>',
      });

      const doc = editor.state.doc;
      const paragraph = doc.child(0);
      expect(paragraph.attrs['lineHeight']).toBe('2');
    });
  });
});
