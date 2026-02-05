import { describe, it, expect } from 'vitest';
import { Extension } from './Extension.js';

describe('Extension', () => {
  describe('name validation', () => {
    it('accepts valid camelCase names', () => {
      expect(() => Extension.create({ name: 'test' })).not.toThrow();
      expect(() => Extension.create({ name: 'myExtension' })).not.toThrow();
      expect(() => Extension.create({ name: 'bold' })).not.toThrow();
      expect(() => Extension.create({ name: 'heading2' })).not.toThrow();
    });

    it('rejects names starting with uppercase', () => {
      expect(() => Extension.create({ name: 'Test' })).toThrow(/invalid/i);
      expect(() => Extension.create({ name: 'MyExtension' })).toThrow(/invalid/i);
    });

    it('rejects names with special characters', () => {
      expect(() => Extension.create({ name: 'my-extension' })).toThrow(/invalid/i);
      expect(() => Extension.create({ name: 'my_extension' })).toThrow(/invalid/i);
      expect(() => Extension.create({ name: 'my.extension' })).toThrow(/invalid/i);
    });

    it('rejects names starting with numbers', () => {
      expect(() => Extension.create({ name: '123test' })).toThrow(/invalid/i);
      expect(() => Extension.create({ name: '1extension' })).toThrow(/invalid/i);
    });

    it('rejects empty names', () => {
      expect(() => Extension.create({ name: '' })).toThrow(/invalid/i);
    });
  });

  describe('create()', () => {
    it('creates extension with name', () => {
      const ext = Extension.create({ name: 'test' });

      expect(ext.name).toBe('test');
      expect(ext.type).toBe('extension');
    });

    it('creates extension with default options from addOptions', () => {
      const ext = Extension.create({
        name: 'test',
        addOptions() {
          return { foo: 'bar', count: 42 };
        },
      });

      expect(ext.options).toEqual({ foo: 'bar', count: 42 });
    });

    it('creates extension with empty options if addOptions not defined', () => {
      const ext = Extension.create({ name: 'test' });

      expect(ext.options).toEqual({});
    });

    it('creates extension with storage from addStorage', () => {
      const ext = Extension.create({
        name: 'test',
        addStorage() {
          return { characters: 0, words: 0 };
        },
      });

      expect(ext.storage).toEqual({ characters: 0, words: 0 });
    });

    it('creates extension with empty storage if addStorage not defined', () => {
      const ext = Extension.create({ name: 'test' });

      expect(ext.storage).toEqual({});
    });

    it('stores the original config', () => {
      const config = {
        name: 'test',
        priority: 500,
        addOptions: () => ({ enabled: true }),
      };
      const ext = Extension.create(config);

      expect(ext.config.name).toBe('test');
      expect(ext.config.priority).toBe(500);
    });

    it('allows access to this.name in addOptions', () => {
      const ext = Extension.create<{ extensionName: string }>({
        name: 'myExtension',
        addOptions() {
          return { extensionName: this.name };
        },
      });

      expect(ext.options.extensionName).toBe('myExtension');
    });

    it('allows access to this.name in addStorage', () => {
      const ext = Extension.create<unknown, { name: string; count: number }>({
        name: 'counter',
        addStorage() {
          return { name: this.name, count: 0 };
        },
      });

      expect(ext.storage.name).toBe('counter');
    });

    it('initializes editor as null (set later by ExtensionManager)', () => {
      const ext = Extension.create({ name: 'test' });

      expect(ext.editor).toBeNull();
    });
  });

  describe('configure()', () => {
    it('returns new instance with merged options', () => {
      const ext = Extension.create({
        name: 'test',
        addOptions() {
          return { a: 1, b: 2, c: 3 };
        },
      });

      const configured = ext.configure({ b: 20 });

      expect(configured.options).toEqual({ a: 1, b: 20, c: 3 });
    });

    it('does not modify original extension', () => {
      const ext = Extension.create({
        name: 'test',
        addOptions() {
          return { value: 'original' };
        },
      });

      ext.configure({ value: 'modified' });

      expect(ext.options.value).toBe('original');
    });

    it('returns new Extension instance', () => {
      const ext = Extension.create({ name: 'test' });
      const configured = ext.configure({});

      expect(configured).toBeInstanceOf(Extension);
      expect(configured).not.toBe(ext);
    });

    it('preserves extension name', () => {
      const ext = Extension.create({ name: 'myExtension' });
      const configured = ext.configure({});

      expect(configured.name).toBe('myExtension');
    });

    it('preserves extension type', () => {
      const ext = Extension.create({ name: 'test' });
      const configured = ext.configure({});

      expect(configured.type).toBe('extension');
    });

    it('preserves other config properties', () => {
      const ext = Extension.create({
        name: 'test',
        priority: 500,
        dependencies: ['other'],
        addOptions() {
          return { value: 1 };
        },
      });

      const configured = ext.configure({ value: 2 });

      expect(configured.config.priority).toBe(500);
      expect(configured.config.dependencies).toEqual(['other']);
    });
  });

  describe('extend()', () => {
    it('returns new instance with extended config', () => {
      const base = Extension.create({
        name: 'base',
        addOptions() {
          return { baseOption: true };
        },
      });

      const extended = base.extend({
        name: 'extended',
        addOptions() {
          return { extendedOption: true };
        },
      });

      expect(extended.name).toBe('extended');
      expect(extended.options).toEqual({ extendedOption: true });
    });

    it('does not modify original extension', () => {
      const base = Extension.create({ name: 'base' });

      base.extend({ name: 'extended' });

      expect(base.name).toBe('base');
    });

    it('returns new Extension instance', () => {
      const base = Extension.create({ name: 'base' });
      const extended = base.extend({ name: 'extended' });

      expect(extended).toBeInstanceOf(Extension);
      expect(extended).not.toBe(base);
    });

    it('inherits config from base when not overridden', () => {
      const base = Extension.create({
        name: 'base',
        priority: 500,
        dependencies: ['dep1'],
      });

      const extended = base.extend({
        name: 'extended',
      });

      expect(extended.config.priority).toBe(500);
      expect(extended.config.dependencies).toEqual(['dep1']);
    });

    it('overrides config when specified', () => {
      const base = Extension.create({
        name: 'base',
        priority: 500,
      });

      const extended = base.extend({
        name: 'extended',
        priority: 900,
      });

      expect(extended.config.priority).toBe(900);
    });

    it('sets type to extension', () => {
      const base = Extension.create({ name: 'base' });
      const extended = base.extend({ name: 'extended' });

      expect(extended.type).toBe('extension');
    });

    it('provides this.parent to call parent config method', () => {
      const base = Extension.create({
        name: 'base',
        addOptions() {
          return { a: 1 };
        },
      });

      const extended = base.extend<Record<string, unknown>>({
        name: 'extended',
        addOptions() {
          return { ...(this.parent?.() as Record<string, unknown>), b: 2 };
        },
      });

      expect(extended.options).toEqual({ a: 1, b: 2 });
    });

    it('this.parent is undefined when no parent method exists', () => {
      const base = Extension.create({
        name: 'base',
      });

      const extended = base.extend<{ fromParent: unknown; own: boolean }>({
        name: 'extended',
        addOptions() {
          const parentResult = this.parent?.();
          return { fromParent: parentResult, own: true };
        },
      });

      expect(extended.options).toEqual({ fromParent: undefined, own: true });
    });

    it('supports chained extends with nested this.parent', () => {
      const base = Extension.create({
        name: 'base',
        addOptions() {
          return { a: 1 };
        },
      });

      const mid = base.extend<Record<string, unknown>>({
        name: 'mid',
        addOptions() {
          return { ...(this.parent?.() as Record<string, unknown>), b: 2 };
        },
      });

      const top = mid.extend<Record<string, unknown>>({
        name: 'top',
        addOptions() {
          return { ...(this.parent?.() as Record<string, unknown>), c: 3 };
        },
      });

      expect(top.options).toEqual({ a: 1, b: 2, c: 3 });
    });
  });

  describe('storage mutation', () => {
    it('storage is mutable', () => {
      const ext = Extension.create({
        name: 'counter',
        addStorage() {
          return { count: 0 };
        },
      });

      ext.storage.count = 10;

      expect(ext.storage.count).toBe(10);
    });

    it('options are readonly (TypeScript enforced)', () => {
      const ext = Extension.create({
        name: 'test',
        addOptions() {
          return { value: 'initial' };
        },
      });

      // This should not compile in TypeScript, but we verify the value exists
      expect(ext.options.value).toBe('initial');
    });
  });

  describe('type safety', () => {
    it('correctly types options', () => {
      interface MyOptions {
        enabled: boolean;
        maxLength: number;
      }

      const ext = Extension.create<MyOptions>({
        name: 'typed',
        addOptions() {
          return { enabled: true, maxLength: 100 };
        },
      });

      // TypeScript should know these types
      expect(typeof ext.options.enabled).toBe('boolean');
      expect(typeof ext.options.maxLength).toBe('number');
    });

    it('correctly types storage', () => {
      interface MyStorage {
        count: number;
        history: string[];
      }

      const ext = Extension.create<unknown, MyStorage>({
        name: 'typed',
        addStorage() {
          return { count: 0, history: [] };
        },
      });

      ext.storage.count = 5;
      ext.storage.history.push('action');

      expect(ext.storage.count).toBe(5);
      expect(ext.storage.history).toEqual(['action']);
    });
  });
});
