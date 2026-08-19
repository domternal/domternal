import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Fragment } from '@domternal/pm/model';
import { Plugin } from '@domternal/pm/state';
import { EditorView } from '@domternal/pm/view';
import { Transform } from '@domternal/pm/transform';
import { Editor } from '../Editor.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { ExtensionConfigurationError } from '../ExtensionConfigurationError.js';
import {
  registerProseMirrorCopy,
  assertSingleProseMirrorCopy,
  warnOnDuplicateProseMirrorCopy,
  resetProseMirrorCopyRegistry,
} from './prosemirrorSingleton.js';

/* Stand-ins for the class each module contributes. Only identity matters, so
   two distinct objects model two distinct physical copies exactly. */
const copyA = { pretendClass: 'FragmentA' };
/** Silences the console without tripping the empty-function rule. */
const REGISTRY_KEY = Symbol.for('domternal.prosemirror.copies');
const REPORTED_KEY = Symbol.for('domternal.prosemirror.copies.reported');

function noop(): void {
  return undefined;
}
const copyB = { pretendClass: 'FragmentB' };

describe('prosemirrorSingleton', () => {
  beforeEach(() => {
    resetProseMirrorCopyRegistry();
  });

  afterEach(() => {
    resetProseMirrorCopyRegistry();
    vi.restoreAllMocks();
  });

  describe('registerProseMirrorCopy', () => {
    it('reports nothing for the first copy of a module', () => {
      expect(registerProseMirrorCopy('prosemirror-model', copyA, '@domternal/core')).toBeNull();
    });

    it('reports nothing when the same copy registers again', () => {
      registerProseMirrorCopy('prosemirror-model', copyA, '@domternal/core');
      expect(
        registerProseMirrorCopy('prosemirror-model', copyA, '@domternal/extension-table')
      ).toBeNull();
    });

    it('reports a conflict when a second copy of the same module arrives', () => {
      registerProseMirrorCopy('prosemirror-model', copyA, '@domternal/core');
      const conflict = registerProseMirrorCopy('prosemirror-model', copyB, 'y-prosemirror');
      expect(conflict).not.toBeNull();
      expect(conflict?.module).toBe('prosemirror-model');
      expect(conflict?.firstConsumer).toBe('@domternal/core');
      expect(conflict?.secondConsumer).toBe('y-prosemirror');
    });

    it('keeps modules independent, so one duplicate does not implicate the others', () => {
      registerProseMirrorCopy('prosemirror-model', copyA, '@domternal/core');
      registerProseMirrorCopy('prosemirror-state', copyA, '@domternal/core');
      expect(registerProseMirrorCopy('prosemirror-model', copyB, 'other')).not.toBeNull();
      expect(registerProseMirrorCopy('prosemirror-state', copyA, 'other')).toBeNull();
    });

    it('never lets a latecomer take over, so firstConsumer stays the settled copy', () => {
      registerProseMirrorCopy('prosemirror-model', copyA, '@domternal/core');
      registerProseMirrorCopy('prosemirror-model', copyB, 'second');
      const third = registerProseMirrorCopy('prosemirror-model', copyB, 'third');
      // Reported against core, not against `second`: the first registration is
      // the one the page actually settled on.
      expect(third?.firstConsumer).toBe('@domternal/core');
      expect(third?.secondConsumer).toBe('third');
      // And the original copy still registers clean.
      expect(registerProseMirrorCopy('prosemirror-model', copyA, 'fourth')).toBeNull();
    });

    it('names both packages and every package manager in the message', () => {
      registerProseMirrorCopy('prosemirror-model', copyA, '@domternal/core');
      const message =
        registerProseMirrorCopy(
          'prosemirror-model',
          copyB,
          '@domternal-pro/extension-collaboration'
        )?.message ?? '';
      expect(message).toContain('prosemirror-model');
      expect(message).toContain('@domternal/core');
      expect(message).toContain('@domternal-pro/extension-collaboration');
      for (const manager of ['pnpm', 'npm', 'yarn', 'Vite', 'webpack']) {
        expect(message).toContain(manager);
      }
      expect(message).toContain('https://domternal.dev/v1/guides/single-prosemirror-copy/');
    });

    it('interpolates the module name into the bundler fix line', () => {
      registerProseMirrorCopy('y-prosemirror', copyA, 'a');
      const message = registerProseMirrorCopy('y-prosemirror', copyB, 'b')?.message ?? '';
      expect(message).toContain("resolve.dedupe: ['y-prosemirror']");
      expect(message).not.toContain('<module>');
    });

    it('tells the reader to depend on the module before configuring the bundler', () => {
      /* Both bundler fixes resolve from the project root. Under pnpm a module
         that arrives transitively is not linked there, so the config alone does
         nothing, and on Vite 8 it does nothing SILENTLY: no warning, no error,
         and the duplicate survives. The dependency step is what makes the rest
         true, so it belongs in the message and not only in the guide.

         The count matters too: each bundler line names the module twice, and
         `String.replace` with a string pattern fills only the first, which would
         leave a literal `<module>` in the snippet a reader is meant to paste. */
      registerProseMirrorCopy('y-prosemirror', copyA, 'a');
      const message = registerProseMirrorCopy('y-prosemirror', copyB, 'b')?.message ?? '';
      const lines = message.split('\n');
      const vite = lines.find((line) => line.includes('Vite:')) ?? '';
      const webpack = lines.find((line) => line.includes('webpack:')) ?? '';
      expect(vite).toContain("depend on 'y-prosemirror' in the app");
      expect(webpack).toContain("depend on 'y-prosemirror' in the app");
      // The Vite line names it twice, in the dependency step and in the
      // snippet, which is exactly where a single-shot replace goes wrong.
      expect(vite.match(/y-prosemirror/g)?.length).toBe(2);
      expect(message).not.toContain('<module>');
    });

    it('shares one registry across module instances via the global symbol', () => {
      registerProseMirrorCopy('prosemirror-model', copyA, '@domternal/core');
      const store = (globalThis as Record<symbol, Map<string, { consumer: string }> | undefined>)[
        Symbol.for('domternal.prosemirror.copies')
      ];
      // A second copy of this very module would find the same map, which is the
      // only reason it can see the first copy at all.
      expect(store?.get('prosemirror-model')?.consumer).toBe('@domternal/core');
    });
  });

  describe('assertSingleProseMirrorCopy', () => {
    it('stays silent for the first copy', () => {
      expect(() => {
        assertSingleProseMirrorCopy('prosemirror-model', copyA, '@domternal/core');
      }).not.toThrow();
    });

    it('stays silent when the copy matches', () => {
      assertSingleProseMirrorCopy('prosemirror-model', copyA, '@domternal/core');
      expect(() => {
        assertSingleProseMirrorCopy('prosemirror-model', copyA, 'pro');
      }).not.toThrow();
    });

    it('throws ExtensionConfigurationError on a conflict', () => {
      assertSingleProseMirrorCopy('prosemirror-model', copyA, '@domternal/core');
      expect(() => {
        assertSingleProseMirrorCopy('prosemirror-model', copyB, 'pro');
      }).toThrow(ExtensionConfigurationError);
    });

    it('throws with the full fix message, not a bare label', () => {
      assertSingleProseMirrorCopy('prosemirror-model', copyA, '@domternal/core');
      expect(() => {
        assertSingleProseMirrorCopy('prosemirror-model', copyB, 'pro');
      }).toThrow(/Force a single copy/);
    });

    it('keeps throwing for every later editor, not only the first', () => {
      assertSingleProseMirrorCopy('prosemirror-model', copyA, '@domternal/core');
      expect(() => {
        assertSingleProseMirrorCopy('prosemirror-model', copyB, 'pro');
      }).toThrow();
      expect(() => {
        assertSingleProseMirrorCopy('prosemirror-model', copyB, 'pro');
      }).toThrow();
    });
  });

  describe('warnOnDuplicateProseMirrorCopy', () => {
    it('does not warn for the first copy', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(noop);
      warnOnDuplicateProseMirrorCopy('prosemirror-model', copyA, '@domternal/core');
      expect(warn).not.toHaveBeenCalled();
    });

    it('warns once on a conflict and returns it', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(noop);
      warnOnDuplicateProseMirrorCopy('prosemirror-model', copyA, '@domternal/core');
      const conflict = warnOnDuplicateProseMirrorCopy('prosemirror-model', copyB, 'other');
      expect(conflict?.module).toBe('prosemirror-model');
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('stays at one warning however many editors are built', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(noop);
      warnOnDuplicateProseMirrorCopy('prosemirror-model', copyA, '@domternal/core');
      for (let i = 0; i < 5; i += 1) {
        warnOnDuplicateProseMirrorCopy('prosemirror-model', copyB, 'other');
      }
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('still returns the conflict after the warning is spent', () => {
      vi.spyOn(console, 'warn').mockImplementation(noop);
      warnOnDuplicateProseMirrorCopy('prosemirror-model', copyA, '@domternal/core');
      warnOnDuplicateProseMirrorCopy('prosemirror-model', copyB, 'other');
      // A caller that wants to escalate must still see it on the second call.
      expect(warnOnDuplicateProseMirrorCopy('prosemirror-model', copyB, 'other')).not.toBeNull();
    });

    it('warns separately per module', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(noop);
      warnOnDuplicateProseMirrorCopy('prosemirror-model', copyA, 'a');
      warnOnDuplicateProseMirrorCopy('prosemirror-state', copyA, 'a');
      warnOnDuplicateProseMirrorCopy('prosemirror-model', copyB, 'b');
      warnOnDuplicateProseMirrorCopy('prosemirror-state', copyB, 'b');
      expect(warn).toHaveBeenCalledTimes(2);
    });

    it('returns null when the copy matches', () => {
      warnOnDuplicateProseMirrorCopy('prosemirror-model', copyA, 'a');
      expect(warnOnDuplicateProseMirrorCopy('prosemirror-model', copyA, 'b')).toBeNull();
    });
  });

  describe('resetProseMirrorCopyRegistry', () => {
    it('forgets both the registry and the warned-once set', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(noop);
      warnOnDuplicateProseMirrorCopy('prosemirror-model', copyA, 'a');
      warnOnDuplicateProseMirrorCopy('prosemirror-model', copyB, 'b');
      resetProseMirrorCopyRegistry();
      // Registry forgotten: the same pair conflicts and warns again.
      expect(warnOnDuplicateProseMirrorCopy('prosemirror-model', copyA, 'a')).toBeNull();
      warnOnDuplicateProseMirrorCopy('prosemirror-model', copyB, 'b');
      expect(warn).toHaveBeenCalledTimes(2);
    });
  });

  describe('Editor wiring', () => {
    let editor: Editor | undefined;

    afterEach(() => {
      editor?.destroy();
      editor = undefined;
    });

    it('registers every identity-sensitive module core imports', () => {
      editor = new Editor({ extensions: [Document, Text, Paragraph], content: '<p>hi</p>' });
      /* Re-registering the very same exports must stay silent, which is only
         true if the constructor registered exactly these. The pairing is the
         frozen one: Fragment, Plugin, EditorView, Transform. prosemirror-tables
         is absent on purpose, because core does not import it; extension-table
         registers CellSelection itself. */
      expect(registerProseMirrorCopy('prosemirror-model', Fragment, 'probe')).toBeNull();
      expect(registerProseMirrorCopy('prosemirror-state', Plugin, 'probe')).toBeNull();
      expect(registerProseMirrorCopy('prosemirror-view', EditorView, 'probe')).toBeNull();
      expect(registerProseMirrorCopy('prosemirror-transform', Transform, 'probe')).toBeNull();
    });

    it('warns for a split prosemirror-transform too, not only the first three', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(noop);
      registerProseMirrorCopy('prosemirror-transform', copyB, 'some-other-library');
      editor = new Editor({ extensions: [Document, Text, Paragraph], content: '<p>hi</p>' });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toContain('"prosemirror-transform"');
    });

    it('warns once per split module, so several splits are all reported', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(noop);
      registerProseMirrorCopy('prosemirror-model', copyB, 'lib-a');
      registerProseMirrorCopy('prosemirror-state', copyB, 'lib-b');
      editor = new Editor({ extensions: [Document, Text, Paragraph], content: '<p>hi</p>' });
      expect(warn).toHaveBeenCalledTimes(2);
    });

    it('warns rather than throws when a foreign copy is already registered', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(noop);
      registerProseMirrorCopy('prosemirror-model', copyB, 'some-other-library');
      expect(() => {
        editor = new Editor({ extensions: [Document, Text, Paragraph], content: '<p>hi</p>' });
      }).not.toThrow();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toContain('some-other-library');
      expect(warn.mock.calls[0]?.[0]).toContain('@domternal/core');
    });

    it('warns once no matter how many editors the page builds', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(noop);
      registerProseMirrorCopy('prosemirror-model', copyB, 'some-other-library');
      const editors = [0, 1, 2].map(
        () => new Editor({ extensions: [Document, Text, Paragraph], content: '<p>hi</p>' })
      );
      expect(warn).toHaveBeenCalledTimes(1);
      for (const built of editors) built.destroy();
    });

    it('stays silent on the normal single-copy path', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(noop);
      editor = new Editor({ extensions: [Document, Text, Paragraph], content: '<p>hi</p>' });
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe('the frozen cross-package contract', () => {
    /* `@domternal-pro/core` ships its own copy of this registry rather than
       importing this one, because the pro extensions declare an open-ended peer
       range on the free core and a customer can hold a core that predates the
       export. The two are still ONE registry, and they only meet through this
       symbol and this entry shape. Changing either here silently halves the
       coverage instead of failing a build, so it is pinned. */
    it('stores on globalThis under Symbol.for("domternal.prosemirror.copies")', () => {
      registerProseMirrorCopy('prosemirror-model', copyA, 'a');
      expect((globalThis as Record<symbol, unknown>)[REGISTRY_KEY]).toBeInstanceOf(Map);
    });

    it('keys entries by the module name and stores { copy, consumer }', () => {
      registerProseMirrorCopy('prosemirror-model', copyA, 'a');
      const store = (globalThis as Record<symbol, unknown>)[REGISTRY_KEY] as Map<string, object>;
      expect(Object.keys(store.get('prosemirror-model') ?? {}).sort()).toEqual([
        'consumer',
        'copy',
      ]);
    });

    it('reads an entry the other implementation wrote', () => {
      const foreign = new Map([
        ['prosemirror-model', { copy: copyA, consumer: '@domternal-pro/extension-collaboration' }],
      ]);
      (globalThis as Record<symbol, unknown>)[REGISTRY_KEY] = foreign;
      expect(
        registerProseMirrorCopy('prosemirror-model', copyB, '@domternal/core')?.firstConsumer
      ).toBe('@domternal-pro/extension-collaboration');
    });

    it('writes an entry the other implementation can read', () => {
      registerProseMirrorCopy('y-prosemirror', copyA, '@domternal/core');
      const store = (globalThis as Record<symbol, unknown>)[REGISTRY_KEY] as Map<
        string,
        { copy: unknown; consumer: string }
      >;
      // Byte-for-byte what the pro implementation expects to find.
      expect(store.get('y-prosemirror')).toEqual({ copy: copyA, consumer: '@domternal/core' });
    });

    it('keeps the message format both implementations produce', () => {
      registerProseMirrorCopy('prosemirror-model', copyA, 'first');
      const message = registerProseMirrorCopy('prosemirror-model', copyB, 'second')?.message ?? '';
      const lines = message.split('\n');
      // Two packages disagreeing should read the same however they were
      // detected, so a reader who hits it twice recognises it the second time.
      expect(lines[0]).toBe('Two different copies of "prosemirror-model" are loaded on this page.');
      expect(lines[1]).toBe('"first" registered one, "second" arrived with another.');
      expect(lines).toContain('Force a single copy:');
      expect(lines.at(-1)).toBe('https://domternal.dev/v1/guides/single-prosemirror-copy/');
    });
  });

  describe('a foreign value squatting on the symbol', () => {
    /* `Symbol.for` is a shared global namespace: another library, or a future
       version of this one with a different shape, can already own the slot.
       Every case below used to throw from inside `new Editor(...)`, which would
       have broken the editor over a diagnostic. */
    it('survives a non-Map registry and still detects the next conflict', () => {
      (globalThis as Record<symbol, unknown>)[REGISTRY_KEY] = 'not a map';
      expect(registerProseMirrorCopy('prosemirror-model', copyA, 'a')).toBeNull();
      expect(registerProseMirrorCopy('prosemirror-model', copyB, 'b')).not.toBeNull();
    });

    it('survives null and undefined in the slot', () => {
      (globalThis as Record<symbol, unknown>)[REGISTRY_KEY] = null;
      expect(() => registerProseMirrorCopy('prosemirror-model', copyA, 'a')).not.toThrow();
      (globalThis as Record<symbol, unknown>)[REGISTRY_KEY] = undefined;
      expect(() => registerProseMirrorCopy('prosemirror-model', copyA, 'a')).not.toThrow();
    });

    it('survives a non-Set reported slot without losing the warning', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(noop);
      (globalThis as Record<symbol, unknown>)[REPORTED_KEY] = 42;
      warnOnDuplicateProseMirrorCopy('prosemirror-model', copyA, 'a');
      warnOnDuplicateProseMirrorCopy('prosemirror-model', copyB, 'b');
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('lets an editor construct even with the slot poisoned', () => {
      (globalThis as Record<symbol, unknown>)[REGISTRY_KEY] = { not: 'a map' };
      const built = new Editor({ extensions: [Document, Text, Paragraph], content: '<p>hi</p>' });
      expect(built.schema).toBeDefined();
      built.destroy();
    });
  });
});
