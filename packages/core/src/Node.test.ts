import { describe, it, expect } from 'vitest';
import { Node } from './Node.js';

describe('Node', () => {
  describe('create()', () => {
    it('creates node with name', () => {
      const node = Node.create({ name: 'paragraph' });

      expect(node.name).toBe('paragraph');
      expect(node.type).toBe('node');
    });

    it('creates node with default options from addOptions', () => {
      const node = Node.create({
        name: 'heading',
        addOptions() {
          return { levels: [1, 2, 3], HTMLAttributes: {} };
        },
      });

      expect(node.options).toEqual({ levels: [1, 2, 3], HTMLAttributes: {} });
    });

    it('creates node with empty options if addOptions not defined', () => {
      const node = Node.create({ name: 'paragraph' });

      expect(node.options).toEqual({});
    });

    it('creates node with storage from addStorage', () => {
      const node = Node.create({
        name: 'counter',
        addStorage() {
          return { count: 0 };
        },
      });

      expect(node.storage).toEqual({ count: 0 });
    });

    it('stores the original config', () => {
      const config = {
        name: 'paragraph',
        group: 'block',
        content: 'inline*',
        priority: 900,
      };
      const node = Node.create(config);

      expect(node.config.name).toBe('paragraph');
      expect(node.config.group).toBe('block');
      expect(node.config.content).toBe('inline*');
      expect(node.config.priority).toBe(900);
    });

    it('allows access to this.name in addOptions', () => {
      const node = Node.create({
        name: 'myNode',
        addOptions() {
          return { nodeName: this.name };
        },
      });

      expect(node.options.nodeName).toBe('myNode');
    });

    it('initializes editor as null', () => {
      const node = Node.create({ name: 'paragraph' });

      expect(node.editor).toBeNull();
    });
  });

  describe('configure()', () => {
    it('returns new instance with merged options', () => {
      const node = Node.create({
        name: 'heading',
        addOptions() {
          return { levels: [1, 2, 3], defaultLevel: 1 };
        },
      });

      const configured = node.configure({ defaultLevel: 2 });

      expect(configured.options).toEqual({ levels: [1, 2, 3], defaultLevel: 2 });
    });

    it('does not modify original node', () => {
      const node = Node.create({
        name: 'heading',
        addOptions() {
          return { level: 1 };
        },
      });

      node.configure({ level: 2 });

      expect(node.options.level).toBe(1);
    });

    it('returns new Node instance', () => {
      const node = Node.create({ name: 'paragraph' });
      const configured = node.configure({});

      expect(configured).toBeInstanceOf(Node);
      expect(configured).not.toBe(node);
    });

    it('preserves node name', () => {
      const node = Node.create({ name: 'paragraph' });
      const configured = node.configure({});

      expect(configured.name).toBe('paragraph');
    });

    it('preserves node type', () => {
      const node = Node.create({ name: 'paragraph' });
      const configured = node.configure({});

      expect(configured.type).toBe('node');
    });

    it('preserves schema properties', () => {
      const node = Node.create({
        name: 'paragraph',
        group: 'block',
        content: 'inline*',
        addOptions() {
          return { value: 1 };
        },
      });

      const configured = node.configure({ value: 2 });

      expect(configured.config.group).toBe('block');
      expect(configured.config.content).toBe('inline*');
    });
  });

  describe('extend()', () => {
    it('returns new instance with extended config', () => {
      const base = Node.create({
        name: 'paragraph',
        group: 'block',
      });

      const extended = base.extend({
        name: 'customParagraph',
        content: 'inline*',
      });

      expect(extended.name).toBe('customParagraph');
      expect(extended.config.content).toBe('inline*');
    });

    it('does not modify original node', () => {
      const base = Node.create({ name: 'paragraph' });

      base.extend({ name: 'customParagraph' });

      expect(base.name).toBe('paragraph');
    });

    it('returns new Node instance', () => {
      const base = Node.create({ name: 'paragraph' });
      const extended = base.extend({ name: 'customParagraph' });

      expect(extended).toBeInstanceOf(Node);
      expect(extended).not.toBe(base);
    });

    it('inherits config from base when not overridden', () => {
      const base = Node.create({
        name: 'paragraph',
        group: 'block',
        content: 'inline*',
        priority: 900,
      });

      const extended = base.extend({
        name: 'customParagraph',
      });

      expect(extended.config.group).toBe('block');
      expect(extended.config.content).toBe('inline*');
      expect(extended.config.priority).toBe(900);
    });

    it('overrides config when specified', () => {
      const base = Node.create({
        name: 'paragraph',
        group: 'block',
      });

      const extended = base.extend({
        name: 'customParagraph',
        group: 'block custom',
      });

      expect(extended.config.group).toBe('block custom');
    });

    it('sets type to node', () => {
      const base = Node.create({ name: 'paragraph' });
      const extended = base.extend({ name: 'customParagraph' });

      expect(extended.type).toBe('node');
    });
  });

  describe('nodeType getter', () => {
    it('returns null when editor is not set', () => {
      const node = Node.create({ name: 'paragraph' });

      expect(node.nodeType).toBeNull();
    });

    it('returns NodeType from schema when editor is set', () => {
      const node = Node.create({ name: 'paragraph' });

      // Mock editor with schema
      const mockNodeType = { name: 'paragraph' };
      node.editor = {
        state: {},
        view: {},
        schema: {
          nodes: {
            paragraph: mockNodeType,
          },
        },
      } as unknown as typeof node.editor;

      expect(node.nodeType).toBe(mockNodeType);
    });
  });

  describe('createNodeSpec()', () => {
    it('creates empty spec for minimal node', () => {
      const node = Node.create({ name: 'paragraph' });
      const spec = node.createNodeSpec();

      expect(spec).toEqual({});
    });

    it('includes group in spec', () => {
      const node = Node.create({
        name: 'paragraph',
        group: 'block',
      });
      const spec = node.createNodeSpec();

      expect(spec.group).toBe('block');
    });

    it('includes content in spec', () => {
      const node = Node.create({
        name: 'paragraph',
        content: 'inline*',
      });
      const spec = node.createNodeSpec();

      expect(spec.content).toBe('inline*');
    });

    it('includes inline flag in spec', () => {
      const node = Node.create({
        name: 'hardBreak',
        inline: true,
      });
      const spec = node.createNodeSpec();

      expect(spec.inline).toBe(true);
    });

    it('includes atom flag in spec', () => {
      const node = Node.create({
        name: 'image',
        atom: true,
      });
      const spec = node.createNodeSpec();

      expect(spec.atom).toBe(true);
    });

    it('includes selectable flag in spec', () => {
      const node = Node.create({
        name: 'hardBreak',
        selectable: false,
      });
      const spec = node.createNodeSpec();

      expect(spec.selectable).toBe(false);
    });

    it('includes draggable flag in spec', () => {
      const node = Node.create({
        name: 'image',
        draggable: true,
      });
      const spec = node.createNodeSpec();

      expect(spec.draggable).toBe(true);
    });

    it('includes code flag in spec', () => {
      const node = Node.create({
        name: 'codeBlock',
        code: true,
      });
      const spec = node.createNodeSpec();

      expect(spec.code).toBe(true);
    });

    it('includes whitespace in spec', () => {
      const node = Node.create({
        name: 'codeBlock',
        whitespace: 'pre',
      });
      const spec = node.createNodeSpec();

      expect(spec.whitespace).toBe('pre');
    });

    it('includes isolating flag in spec', () => {
      const node = Node.create({
        name: 'tableCell',
        isolating: true,
      });
      const spec = node.createNodeSpec();

      expect(spec.isolating).toBe(true);
    });

    it('includes defining flag in spec', () => {
      const node = Node.create({
        name: 'heading',
        defining: true,
      });
      const spec = node.createNodeSpec();

      expect(spec.defining).toBe(true);
    });

    it('includes marks in spec', () => {
      const node = Node.create({
        name: 'codeBlock',
        marks: '',
      });
      const spec = node.createNodeSpec();

      expect(spec.marks).toBe('');
    });

    it('includes leafText as function in spec', () => {
      const node = Node.create({
        name: 'hardBreak',
        leafText: '\n',
      });
      const spec = node.createNodeSpec();

      expect(typeof spec.leafText).toBe('function');
      expect(spec.leafText!({} as never)).toBe('\n');
    });

    it('includes leafText function directly in spec', () => {
      const leafTextFn = (): string => '---';
      const node = Node.create({
        name: 'horizontalRule',
        leafText: leafTextFn,
      });
      const spec = node.createNodeSpec();

      expect(spec.leafText).toBe(leafTextFn);
    });

    describe('attributes', () => {
      it('converts addAttributes to attrs', () => {
        const node = Node.create({
          name: 'heading',
          addAttributes() {
            return {
              level: { default: 1 },
            };
          },
        });
        const spec = node.createNodeSpec();

        expect(spec.attrs).toEqual({
          level: { default: 1 },
        });
      });

      it('includes validate function in attrs', () => {
        const validateFn = (value: unknown): boolean =>
          typeof value === 'number' && value >= 1 && value <= 6;
        const node = Node.create({
          name: 'heading',
          addAttributes() {
            return {
              level: { default: 1, validate: validateFn },
            };
          },
        });
        const spec = node.createNodeSpec();

        expect((spec.attrs!['level'] as { validate?: unknown }).validate).toBe(
          validateFn
        );
      });

      it('handles multiple attributes', () => {
        const node = Node.create({
          name: 'image',
          addAttributes() {
            return {
              src: { default: null },
              alt: { default: '' },
              title: { default: null },
            };
          },
        });
        const spec = node.createNodeSpec();

        expect(spec.attrs).toEqual({
          src: { default: null },
          alt: { default: '' },
          title: { default: null },
        });
      });
    });

    describe('parseHTML', () => {
      it('converts parseHTML to parseDOM', () => {
        const node = Node.create({
          name: 'paragraph',
          parseHTML() {
            return [{ tag: 'p' }];
          },
        });
        const spec = node.createNodeSpec();

        expect(spec.parseDOM).toHaveLength(1);
        expect((spec.parseDOM![0] as { tag: string }).tag).toBe('p');
      });

      it('handles multiple parse rules', () => {
        const node = Node.create({
          name: 'heading',
          parseHTML() {
            return [
              { tag: 'h1' },
              { tag: 'h2' },
              { tag: 'h3' },
            ];
          },
        });
        const spec = node.createNodeSpec();

        expect(spec.parseDOM).toHaveLength(3);
        expect((spec.parseDOM![0] as { tag: string }).tag).toBe('h1');
        expect((spec.parseDOM![1] as { tag: string }).tag).toBe('h2');
        expect((spec.parseDOM![2] as { tag: string }).tag).toBe('h3');
      });

      it('includes priority in parse rule', () => {
        const node = Node.create({
          name: 'paragraph',
          parseHTML() {
            return [{ tag: 'p', priority: 100 }];
          },
        });
        const spec = node.createNodeSpec();

        expect((spec.parseDOM![0] as { priority: number }).priority).toBe(100);
      });

      it('includes getAttrs from rule', () => {
        const node = Node.create({
          name: 'heading',
          parseHTML() {
            return [
              {
                tag: 'h1',
                getAttrs: () => ({ level: 1 }),
              },
            ];
          },
        });
        const spec = node.createNodeSpec();

        const mockElement = document.createElement('h1');
        const parseRule = spec.parseDOM![0] as { getAttrs: (el: HTMLElement) => unknown };
        const attrs = parseRule.getAttrs(mockElement);

        expect(attrs).toEqual({ level: 1 });
      });

      it('returns false when getAttrs returns null', () => {
        const node = Node.create({
          name: 'paragraph',
          parseHTML() {
            return [
              {
                tag: 'p',
                getAttrs: () => null,
              },
            ];
          },
        });
        const spec = node.createNodeSpec();

        const mockElement = document.createElement('p');
        const parseRule = spec.parseDOM![0] as { getAttrs: (el: HTMLElement) => unknown };
        const attrs = parseRule.getAttrs(mockElement);

        expect(attrs).toBe(false);
      });

      it('merges attribute parseHTML with rule getAttrs', () => {
        const node = Node.create({
          name: 'heading',
          addAttributes() {
            return {
              level: {
                default: 1,
                parseHTML: (element: HTMLElement) =>
                  parseInt(element.tagName.charAt(1), 10),
              },
            };
          },
          parseHTML() {
            return [{ tag: 'h1' }, { tag: 'h2' }];
          },
        });
        const spec = node.createNodeSpec();

        const h1 = document.createElement('h1');
        const h2 = document.createElement('h2');

        const rule0 = spec.parseDOM![0] as { getAttrs: (el: HTMLElement) => unknown };
        const rule1 = spec.parseDOM![1] as { getAttrs: (el: HTMLElement) => unknown };
        expect(rule0.getAttrs(h1)).toEqual({ level: 1 });
        expect(rule1.getAttrs(h2)).toEqual({ level: 2 });
      });
    });

    describe('renderHTML', () => {
      it('converts renderHTML to toDOM', () => {
        const node = Node.create({
          name: 'paragraph',
          renderHTML({ HTMLAttributes }) {
            return ['p', HTMLAttributes, 0];
          },
        });
        const spec = node.createNodeSpec();

        expect(spec.toDOM).toBeDefined();

        const mockNode = { attrs: {} };
        const result = spec.toDOM!(mockNode as never);

        expect(result).toEqual(['p', {}, 0]);
      });

      it('includes rendered attributes in HTMLAttributes', () => {
        const node = Node.create({
          name: 'heading',
          addAttributes() {
            return {
              level: { default: 1 },
            };
          },
          renderHTML({ node: pmNode, HTMLAttributes }) {
            return [`h${String(pmNode.attrs['level'])}`, HTMLAttributes, 0];
          },
        });
        const spec = node.createNodeSpec();

        const mockNode = { attrs: { level: 2 } };
        const result = spec.toDOM!(mockNode as never);

        expect(result).toEqual(['h2', { level: 2 }, 0]);
      });

      it('uses attribute renderHTML when defined', () => {
        const node = Node.create({
          name: 'heading',
          addAttributes() {
            return {
              level: {
                default: 1,
                renderHTML: (attributes) => ({
                  'data-level': attributes['level'] as number,
                }),
              },
            };
          },
          renderHTML({ HTMLAttributes }) {
            return ['h1', HTMLAttributes, 0];
          },
        });
        const spec = node.createNodeSpec();

        const mockNode = { attrs: { level: 2 } };
        const result = spec.toDOM!(mockNode as never);

        expect(result).toEqual(['h1', { 'data-level': 2 }, 0]);
      });

      it('skips attributes with rendered: false', () => {
        const node = Node.create({
          name: 'heading',
          addAttributes() {
            return {
              level: { default: 1 },
              internalId: { default: null, rendered: false },
            };
          },
          renderHTML({ HTMLAttributes }) {
            return ['h1', HTMLAttributes, 0];
          },
        });
        const spec = node.createNodeSpec();

        const mockNode = { attrs: { level: 1, internalId: 'abc123' } };
        const result = spec.toDOM!(mockNode as never);

        expect(result).toEqual(['h1', { level: 1 }, 0]);
      });

      it('skips null/undefined attribute values', () => {
        const node = Node.create({
          name: 'image',
          addAttributes() {
            return {
              src: { default: null },
              alt: { default: '' },
            };
          },
          renderHTML({ HTMLAttributes }) {
            return ['img', HTMLAttributes];
          },
        });
        const spec = node.createNodeSpec();

        const mockNode = { attrs: { src: null, alt: 'test' } };
        const result = spec.toDOM!(mockNode as never);

        expect(result).toEqual(['img', { alt: 'test' }]);
      });
    });
  });

  describe('type safety', () => {
    it('correctly types options', () => {
      interface MyOptions {
        levels: number[];
        defaultLevel: number;
      }

      const node = Node.create<MyOptions>({
        name: 'heading',
        addOptions() {
          return { levels: [1, 2, 3], defaultLevel: 1 };
        },
      });

      expect(Array.isArray(node.options.levels)).toBe(true);
      expect(typeof node.options.defaultLevel).toBe('number');
    });

    it('correctly types storage', () => {
      interface MyStorage {
        count: number;
        history: string[];
      }

      const node = Node.create<unknown, MyStorage>({
        name: 'counter',
        addStorage() {
          return { count: 0, history: [] };
        },
      });

      node.storage.count = 5;
      node.storage.history.push('action');

      expect(node.storage.count).toBe(5);
      expect(node.storage.history).toEqual(['action']);
    });
  });
});
