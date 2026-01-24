/**
 * Tests for Mark class
 */

import { describe, it, expect } from 'vitest';
import { Mark } from './Mark.js';

describe('Mark', () => {
  describe('create()', () => {
    it('creates a mark with a name', () => {
      const mark = Mark.create({ name: 'bold' });

      expect(mark.name).toBe('bold');
    });

    it('sets type to "mark"', () => {
      const mark = Mark.create({ name: 'bold' });

      expect(mark.type).toBe('mark');
    });

    it('creates mark with default options', () => {
      interface BoldOptions {
        HTMLAttributes: Record<string, unknown>;
      }

      const mark = Mark.create<BoldOptions>({
        name: 'bold',
        addOptions() {
          return {
            HTMLAttributes: { class: 'bold' },
          };
        },
      });

      expect(mark.options.HTMLAttributes).toEqual({ class: 'bold' });
    });

    it('creates mark with default storage', () => {
      interface BoldStorage {
        count: number;
      }

      const mark = Mark.create<unknown, BoldStorage>({
        name: 'bold',
        addStorage() {
          return { count: 0 };
        },
      });

      expect(mark.storage.count).toBe(0);
    });

    it('creates mark with empty options if addOptions not provided', () => {
      const mark = Mark.create({ name: 'bold' });

      expect(mark.options).toEqual({});
    });

    it('creates mark with empty storage if addStorage not provided', () => {
      const mark = Mark.create({ name: 'bold' });

      expect(mark.storage).toEqual({});
    });
  });

  describe('configure()', () => {
    it('creates new mark with merged options', () => {
      interface BoldOptions {
        weight: string;
        color: string;
      }

      const original = Mark.create<BoldOptions>({
        name: 'bold',
        addOptions() {
          return { weight: 'bold', color: 'black' };
        },
      });

      const configured = original.configure({ weight: '700' });

      expect(configured.options.weight).toBe('700');
      expect(configured.options.color).toBe('black');
    });

    it('does not modify original mark', () => {
      interface BoldOptions {
        weight: string;
      }

      const original = Mark.create<BoldOptions>({
        name: 'bold',
        addOptions() {
          return { weight: 'bold' };
        },
      });

      original.configure({ weight: '700' });

      expect(original.options.weight).toBe('bold');
    });

    it('returns a Mark instance', () => {
      const mark = Mark.create({ name: 'bold' });
      const configured = mark.configure({});

      expect(configured).toBeInstanceOf(Mark);
    });

    it('preserves mark type after configure', () => {
      const mark = Mark.create({ name: 'bold' });
      const configured = mark.configure({});

      expect(configured.type).toBe('mark');
    });
  });

  describe('extend()', () => {
    it('creates new mark with extended config', () => {
      const base = Mark.create({ name: 'bold' });
      const extended = base.extend({ name: 'customBold' });

      expect(extended.name).toBe('customBold');
    });

    it('does not modify original mark', () => {
      const original = Mark.create({ name: 'bold' });
      original.extend({ name: 'customBold' });

      expect(original.name).toBe('bold');
    });

    it('returns a Mark instance', () => {
      const mark = Mark.create({ name: 'bold' });
      const extended = mark.extend({ name: 'customBold' });

      expect(extended).toBeInstanceOf(Mark);
    });

    it('preserves original config when extending', () => {
      interface BoldOptions {
        weight: string;
      }

      const original = Mark.create<BoldOptions>({
        name: 'bold',
        addOptions() {
          return { weight: 'bold' };
        },
      });

      const extended = original.extend({ name: 'customBold' });

      expect(extended.options.weight).toBe('bold');
    });

    it('can extend with new options type', () => {
      interface BaseOptions {
        weight: string;
      }

      interface ExtendedOptions extends BaseOptions {
        color: string;
      }

      const base = Mark.create<BaseOptions>({
        name: 'bold',
        addOptions() {
          return { weight: 'bold' };
        },
      });

      const extended = base.extend<ExtendedOptions>({
        addOptions() {
          return { weight: 'bold', color: 'red' };
        },
      });

      expect(extended.options.color).toBe('red');
    });

    it('preserves type as mark after extend', () => {
      const base = Mark.create({ name: 'bold' });
      const extended = base.extend({ name: 'customBold' });

      expect(extended.type).toBe('mark');
    });
  });

  describe('markType getter', () => {
    it('returns null when editor is not set', () => {
      const mark = Mark.create({ name: 'bold' });

      expect(mark.markType).toBeNull();
    });

    it('returns MarkType from schema when editor is set', () => {
      const mark = Mark.create({ name: 'bold' });

      // Mock editor with schema
      const mockMarkType = { name: 'bold' };
      mark.editor = {
        schema: {
          marks: {
            bold: mockMarkType,
          },
        },
      } as never;

      expect(mark.markType).toBe(mockMarkType);
    });

    it('returns null when mark not in schema', () => {
      const mark = Mark.create({ name: 'bold' });

      // Mock editor with schema that doesn't have this mark
      mark.editor = {
        schema: {
          marks: {},
        },
      } as never;

      expect(mark.markType).toBeNull();
    });
  });

  describe('createMarkSpec()', () => {
    describe('schema properties', () => {
      it('includes inclusive in spec', () => {
        const mark = Mark.create({
          name: 'bold',
          inclusive: false,
        });
        const spec = mark.createMarkSpec();

        expect(spec.inclusive).toBe(false);
      });

      it('includes excludes in spec', () => {
        const mark = Mark.create({
          name: 'bold',
          excludes: 'italic',
        });
        const spec = mark.createMarkSpec();

        expect(spec.excludes).toBe('italic');
      });

      it('includes group in spec', () => {
        const mark = Mark.create({
          name: 'bold',
          group: 'formatting',
        });
        const spec = mark.createMarkSpec();

        expect(spec.group).toBe('formatting');
      });

      it('includes spanning in spec', () => {
        const mark = Mark.create({
          name: 'code',
          spanning: false,
        });
        const spec = mark.createMarkSpec();

        expect(spec.spanning).toBe(false);
      });

      it('excludes undefined properties from spec', () => {
        const mark = Mark.create({ name: 'bold' });
        const spec = mark.createMarkSpec();

        expect(spec.inclusive).toBeUndefined();
        expect(spec.excludes).toBeUndefined();
        expect(spec.group).toBeUndefined();
        expect(spec.spanning).toBeUndefined();
      });
    });

    describe('attributes', () => {
      it('converts addAttributes to spec.attrs', () => {
        const mark = Mark.create({
          name: 'link',
          addAttributes() {
            return {
              href: { default: null },
            };
          },
        });
        const spec = mark.createMarkSpec();

        expect(spec.attrs).toEqual({
          href: { default: null },
        });
      });

      it('includes validate function in attrs', () => {
        const validateFn = (value: unknown): boolean =>
          typeof value === 'string' && value.startsWith('http');
        const mark = Mark.create({
          name: 'link',
          addAttributes() {
            return {
              href: { default: null, validate: validateFn },
            };
          },
        });
        const spec = mark.createMarkSpec();

        expect((spec.attrs!['href'] as { validate?: unknown }).validate).toBe(
          validateFn
        );
      });

      it('handles multiple attributes', () => {
        const mark = Mark.create({
          name: 'link',
          addAttributes() {
            return {
              href: { default: null },
              target: { default: '_blank' },
              rel: { default: 'noopener' },
            };
          },
        });
        const spec = mark.createMarkSpec();

        expect(spec.attrs).toEqual({
          href: { default: null },
          target: { default: '_blank' },
          rel: { default: 'noopener' },
        });
      });
    });

    describe('parseHTML', () => {
      it('converts parseHTML to parseDOM', () => {
        const mark = Mark.create({
          name: 'bold',
          parseHTML() {
            return [{ tag: 'strong' }];
          },
        });
        const spec = mark.createMarkSpec();

        expect(spec.parseDOM).toHaveLength(1);
        expect((spec.parseDOM![0] as { tag: string }).tag).toBe('strong');
      });

      it('handles multiple parse rules', () => {
        const mark = Mark.create({
          name: 'bold',
          parseHTML() {
            return [{ tag: 'strong' }, { tag: 'b' }];
          },
        });
        const spec = mark.createMarkSpec();

        expect(spec.parseDOM).toHaveLength(2);
        expect((spec.parseDOM![0] as { tag: string }).tag).toBe('strong');
        expect((spec.parseDOM![1] as { tag: string }).tag).toBe('b');
      });

      it('handles style parse rules', () => {
        const mark = Mark.create({
          name: 'bold',
          parseHTML() {
            return [{ style: 'font-weight=bold' }];
          },
        });
        const spec = mark.createMarkSpec();

        expect((spec.parseDOM![0] as { style: string }).style).toBe(
          'font-weight=bold'
        );
      });

      it('includes priority in parse rule', () => {
        const mark = Mark.create({
          name: 'bold',
          parseHTML() {
            return [{ tag: 'strong', priority: 100 }];
          },
        });
        const spec = mark.createMarkSpec();

        expect((spec.parseDOM![0] as { priority: number }).priority).toBe(100);
      });

      it('includes getAttrs from rule', () => {
        const mark = Mark.create({
          name: 'link',
          parseHTML() {
            return [
              {
                tag: 'a',
                getAttrs: (el) =>
                  typeof el === 'string'
                    ? null
                    : { href: el.getAttribute('href') },
              },
            ];
          },
        });
        const spec = mark.createMarkSpec();

        const mockElement = document.createElement('a');
        mockElement.setAttribute('href', 'https://example.com');
        const parseRule = spec.parseDOM![0] as {
          getAttrs: (el: HTMLElement) => unknown;
        };
        const attrs = parseRule.getAttrs(mockElement);

        expect(attrs).toEqual({ href: 'https://example.com' });
      });

      it('returns false when getAttrs returns false', () => {
        const mark = Mark.create({
          name: 'bold',
          parseHTML() {
            return [
              {
                tag: 'span',
                getAttrs: () => false,
              },
            ];
          },
        });
        const spec = mark.createMarkSpec();

        const mockElement = document.createElement('span');
        const parseRule = spec.parseDOM![0] as {
          getAttrs: (el: HTMLElement) => unknown;
        };
        const attrs = parseRule.getAttrs(mockElement);

        expect(attrs).toBe(false);
      });

      it('returns null when getAttrs returns null', () => {
        const mark = Mark.create({
          name: 'bold',
          parseHTML() {
            return [
              {
                tag: 'span',
                getAttrs: () => null,
              },
            ];
          },
        });
        const spec = mark.createMarkSpec();

        const mockElement = document.createElement('span');
        const parseRule = spec.parseDOM![0] as {
          getAttrs: (el: HTMLElement) => unknown;
        };
        const attrs = parseRule.getAttrs(mockElement);

        expect(attrs).toBeNull();
      });

      it('handles style rules with string input', () => {
        const mark = Mark.create({
          name: 'bold',
          parseHTML() {
            return [
              {
                style: 'font-weight',
                getAttrs: (value) =>
                  typeof value === 'string' && /bold|[5-9]\d{2}/.test(value)
                    ? {}
                    : false,
              },
            ];
          },
        });
        const spec = mark.createMarkSpec();

        const parseRule = spec.parseDOM![0] as {
          getAttrs: (el: HTMLElement | string) => unknown;
        };

        expect(parseRule.getAttrs('bold')).toEqual({});
        expect(parseRule.getAttrs('700')).toEqual({});
        expect(parseRule.getAttrs('normal')).toBe(false);
      });
    });

    describe('renderHTML', () => {
      it('converts renderHTML to toDOM', () => {
        const mark = Mark.create({
          name: 'bold',
          renderHTML({ HTMLAttributes }) {
            return ['strong', HTMLAttributes, 0];
          },
        });
        const spec = mark.createMarkSpec();

        const mockMark = { attrs: {} };
        const result = spec.toDOM!(mockMark as never);

        expect(result).toEqual(['strong', {}, 0]);
      });

      it('passes mark attributes to renderHTML', () => {
        const mark = Mark.create({
          name: 'link',
          addAttributes() {
            return {
              href: { default: null },
            };
          },
          renderHTML({ HTMLAttributes }) {
            return ['a', HTMLAttributes, 0];
          },
        });
        const spec = mark.createMarkSpec();

        const mockMark = { attrs: { href: 'https://example.com' } };
        const result = spec.toDOM!(mockMark as never);

        expect(result).toEqual(['a', { href: 'https://example.com' }, 0]);
      });

      it('uses attribute renderHTML when defined', () => {
        const mark = Mark.create({
          name: 'link',
          addAttributes() {
            return {
              href: {
                default: null,
                renderHTML: (attributes) => ({
                  href: attributes['href'] as string,
                  rel: 'noopener',
                }),
              },
            };
          },
          renderHTML({ HTMLAttributes }) {
            return ['a', HTMLAttributes, 0];
          },
        });
        const spec = mark.createMarkSpec();

        const mockMark = { attrs: { href: 'https://example.com' } };
        const result = spec.toDOM!(mockMark as never);

        expect(result).toEqual([
          'a',
          { href: 'https://example.com', rel: 'noopener' },
          0,
        ]);
      });

      it('skips attributes with rendered: false', () => {
        const mark = Mark.create({
          name: 'link',
          addAttributes() {
            return {
              href: { default: null },
              internal: { default: false, rendered: false },
            };
          },
          renderHTML({ HTMLAttributes }) {
            return ['a', HTMLAttributes, 0];
          },
        });
        const spec = mark.createMarkSpec();

        const mockMark = { attrs: { href: 'https://example.com', internal: true } };
        const result = spec.toDOM!(mockMark as never);

        expect(result).toEqual(['a', { href: 'https://example.com' }, 0]);
      });

      it('skips null/undefined attribute values', () => {
        const mark = Mark.create({
          name: 'link',
          addAttributes() {
            return {
              href: { default: null },
              title: { default: null },
            };
          },
          renderHTML({ HTMLAttributes }) {
            return ['a', HTMLAttributes, 0];
          },
        });
        const spec = mark.createMarkSpec();

        const mockMark = { attrs: { href: 'https://example.com', title: null } };
        const result = spec.toDOM!(mockMark as never);

        expect(result).toEqual(['a', { href: 'https://example.com' }, 0]);
      });
    });
  });
});
