import { describe, expect, it, vi } from 'vitest';
import { Extension } from './Extension.js';
import { Mark } from './Mark.js';
import { Node } from './Node.js';

const symbolOption = Symbol('label');

interface Options {
  label: string;
  placeholder: string;
  nested: { label: string; other?: string };
  optional?: string | undefined;
  [symbolOption]?: string;
  1?: string;
}

describe.each([
  { type: 'extension', Factory: Extension },
  { type: 'node', Factory: Node },
  { type: 'mark', Factory: Mark },
])('$type option provenance', ({ Factory }) => {
  function createBase(): Extension<Options> {
    return Factory.create<Options>({
      name: 'localized',
      addOptions() {
        return {
          label: 'Default label',
          placeholder: 'Write something',
          nested: { label: 'Nested label', other: 'Other' },
        };
      },
    });
  }

  it('distinguishes original defaults from explicitly configured equal values', () => {
    const base = createBase();
    const configured = base.configure({ label: 'Default label' });

    expect(base.isOptionExplicit('label')).toBe(false);
    expect(configured.options.label).toBe(base.options.label);
    expect(configured.isOptionExplicit('label')).toBe(true);
    expect(configured.isOptionExplicit('placeholder')).toBe(false);
    expect(base.configure({}).isOptionExplicit('label')).toBe(false);
  });

  it('retains each shallow override through chained configuration and cloning', () => {
    const base = createBase();
    const configured = base.configure({ label: 'Default label' })
      .configure({ placeholder: '', optional: undefined });
    const clone = configured.clone().configure({ nested: { label: 'Custom' } }).clone();

    for (const key of ['label', 'placeholder', 'optional', 'nested'] as const) {
      expect(clone.isOptionExplicit(key)).toBe(true);
    }
    expect(clone.options.nested).toEqual({ label: 'Custom' });
    expect(Object.hasOwn(clone.options, 'optional')).toBe(true);
    expect(configured.isOptionExplicit('nested')).toBe(false);
    expect(base.isOptionExplicit('label')).toBe(false);
    expect(base.options.nested).toEqual({ label: 'Nested label', other: 'Other' });
    expect(clone).toBeInstanceOf(Factory);
    expect(clone.editor).toBeNull();
  });

  it('tracks only enumerable own configuration keys, including symbols and numeric keys', () => {
    const options = Object.create({ label: 'Inherited label' }) as Partial<Options>;
    Object.defineProperty(options, 'placeholder', { value: 'Hidden placeholder' });
    options[symbolOption] = 'Symbol label';
    options[1] = 'Numeric label';

    const configured = createBase().configure(options).clone();

    expect(configured.isOptionExplicit('label')).toBe(false);
    expect(configured.isOptionExplicit('placeholder')).toBe(false);
    expect(configured.options.label).toBe('Default label');
    expect(configured.isOptionExplicit(symbolOption)).toBe(true);
    expect(configured.isOptionExplicit(1)).toBe(true);
  });

  it('preserves ownership through extensions that do not replace addOptions', () => {
    const base = createBase();
    const inherited = base.extend({ name: 'inherited' }).clone();
    const configured = base.configure({ label: 'Default label' })
      .extend({ name: 'configured' }).clone();

    expect(inherited.isOptionExplicit('label')).toBe(false);
    expect(configured.isOptionExplicit('label')).toBe(true);
    expect(configured.isOptionExplicit('placeholder')).toBe(false);
    expect(configured).toBeInstanceOf(Factory);
  });

  it('preserves custom addOptions ownership including equal values and parent copies', () => {
    const base = createBase();
    const first = base.extend({
      addOptions() {
        return { ...(this.parent?.() as Options), label: 'Default label' };
      },
    });
    const second = first.extend({
      addOptions() {
        return { ...(this.parent?.() as Options), optional: 'Custom default' };
      },
    }).configure({ nested: { label: 'Another label' } }).clone();

    expect(second.options).toEqual({
      label: 'Default label',
      placeholder: 'Write something',
      nested: { label: 'Another label' },
      optional: 'Custom default',
    });
    for (const key of ['label', 'placeholder', 'nested', 'optional'] as const) {
      expect(second.isOptionExplicit(key)).toBe(true);
    }
    expect(second.parent).toBeUndefined();
    expect(first.parent).toBeUndefined();
    expect(base.isOptionExplicit('label')).toBe(false);
  });

  it('does not leak provenance between independently configured clones', () => {
    const source = createBase();
    const first = source.clone().configure({ label: 'First editor' });
    const second = source.clone().configure({ placeholder: 'Second editor' });

    expect(first.isOptionExplicit('label')).toBe(true);
    expect(first.isOptionExplicit('placeholder')).toBe(false);
    expect(second.isOptionExplicit('label')).toBe(false);
    expect(second.isOptionExplicit('placeholder')).toBe(true);
    expect(source.clone().isOptionExplicit('label')).toBe(false);
  });

  it('does not report an option removed by a replacement options factory', () => {
    const configured = createBase().configure({ optional: 'Previous value' });
    const replaced = configured.extend<Options>({
      addOptions() {
        return { label: 'Custom', placeholder: 'Custom', nested: { label: 'Custom' } };
      },
    }).clone();

    expect(replaced.isOptionExplicit('label')).toBe(true);
    expect(replaced.isOptionExplicit('optional')).toBe(false);
  });

  it('does not reevaluate options factories to infer provenance', () => {
    const addOptions = vi.fn(() => ({ label: 'Original' }));
    const base = Factory.create({ name: 'counted', addOptions });
    const customOptions = vi.fn(function (this: Extension<{ label: string }>) {
      return { ...(this.parent?.() as { label: string }), label: 'Original' };
    });
    const extended = base.extend({ addOptions: customOptions });

    expect(addOptions).toHaveBeenCalledTimes(2);
    expect(customOptions).toHaveBeenCalledTimes(1);
    expect(extended.isOptionExplicit('label')).toBe(true);
    expect(addOptions).toHaveBeenCalledTimes(2);
    expect(customOptions).toHaveBeenCalledTimes(1);
  });
});

describe('mark config-only options', () => {
  it('keeps isFormatting separate from option provenance', () => {
    const mark = Mark.create({ name: 'format', addOptions: () => ({ label: 'Format' }) });
    const configured = mark.configure({ isFormatting: false }).clone();

    expect(configured).toBeInstanceOf(Mark);
    expect((configured as Mark).isFormatting).toBe(false);
    expect(configured.isOptionExplicit('label')).toBe(false);
    expect(configured.options).toEqual({ label: 'Format' });
  });
});
