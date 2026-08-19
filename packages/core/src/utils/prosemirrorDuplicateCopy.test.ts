/**
 * The negative control for the whole single-copy feature.
 *
 * Every other test around this one simulates a duplicate by putting a stand-in
 * object into the registry. That proves the reporting path and nothing else: it
 * never shows that the thing being reported is real, that two copies of a
 * module actually define different classes, or that ProseMirror actually fails
 * when they meet. If the premise were wrong, or the frozen export chosen per
 * module were the wrong one to compare, those tests would all still pass.
 *
 * So this file makes REAL second copies, two different ways, because the two
 * halves of the problem live in different module systems:
 *
 * - a published dependency is loaded by Node, which keys its module registry by
 *   URL, so importing the same file with a query string evaluates it again;
 * - our own source is loaded by Vite, whose registry `vi.resetModules()` clears,
 *   so the next import re-evaluates it.
 *
 * Both produce exactly what a nested install produces at runtime: the same code
 * evaluated twice, defining two sets of classes that share a name and nothing
 * else.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Fragment } from '@domternal/pm/model';
import type * as CoreModule from '../index.js';
import { Document, Paragraph, Text } from '../index.js';
import { Editor } from '../Editor.js';
import { ExtensionConfigurationError } from '../ExtensionConfigurationError.js';
import {
  registerProseMirrorCopy,
  resetProseMirrorCopyRegistry,
  warnOnDuplicateProseMirrorCopy,
} from './prosemirrorSingleton.js';

/**
 * A genuinely second copy of `prosemirror-model`.
 *
 * Resolved through `@domternal/pm`, because that is the package that depends on
 * it: under pnpm it is not reachable from here by name at all, which is itself
 * the layout that makes duplicates possible. The ESM entry is imported as a
 * file URL so the package's export conditions are bypassed, and the query makes
 * Node treat it as a module it has not seen.
 */
async function secondProseMirrorModel(): Promise<{ Fragment: typeof Fragment }> {
  const require = createRequire(import.meta.resolve('@domternal/pm/model'));
  const esm = require.resolve('prosemirror-model').replace(/\.cjs$/, '.js');
  return (await import(/* @vite-ignore */ `${pathToFileURL(esm).href}?dm-duplicate`)) as {
    Fragment: typeof Fragment;
  };
}

/**
 * A genuinely second copy of this package's own source graph.
 *
 * The reset runs again afterwards so the modules every other test in this file
 * holds stay the ones the rest of the run sees; without it the throwaway copy
 * would leak into the next dynamic import anywhere.
 */
async function secondCore(): Promise<typeof CoreModule> {
  vi.resetModules();
  const copy = await import('../index.js');
  vi.resetModules();
  return copy;
}

describe('a real second copy of prosemirror-model', () => {
  let element: HTMLElement;
  const editors: Editor[] = [];

  beforeEach(() => {
    resetProseMirrorCopyRegistry();
    element = document.createElement('div');
    document.body.appendChild(element);
  });

  afterEach(() => {
    for (const editor of editors.splice(0)) editor.destroy();
    element.remove();
    resetProseMirrorCopyRegistry();
    vi.restoreAllMocks();
  });

  it('defines a Fragment class that is not ours', async () => {
    const second = await secondProseMirrorModel();
    // Same name, same version, same file on disk. Different class object, which
    // is the only thing ProseMirror ever looks at.
    expect(second.Fragment).not.toBe(Fragment);
    expect(second.Fragment.name).toBe(Fragment.name);
  });

  it('reproduces the exact ProseMirror failure the guard exists to prevent', async () => {
    const second = await secondProseMirrorModel();
    /* The error a customer sees, produced here from two real copies rather
       than quoted from a comment. `Fragment.from` recognises a foreign fragment
       well enough to guess the cause and not well enough to accept it, which is
       the entire problem in one call. */
    expect(() => Fragment.from(second.Fragment.empty as never)).toThrow(
      /multiple versions of prosemirror-model were loaded/
    );
  });

  it('is reported by the registry, naming both packages', async () => {
    const second = await secondProseMirrorModel();
    expect(registerProseMirrorCopy('prosemirror-model', Fragment, '@domternal/core')).toBeNull();

    const conflict = registerProseMirrorCopy('prosemirror-model', second.Fragment, 'some-library');
    expect(conflict).not.toBeNull();
    expect(conflict?.firstConsumer).toBe('@domternal/core');
    expect(conflict?.secondConsumer).toBe('some-library');
    expect(conflict?.message).toContain('Two different copies of "prosemirror-model"');
  });

  it('makes a real editor warn, and still lets it run', async () => {
    const second = await secondProseMirrorModel();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // Whoever registers first is whoever the page settled on; here it is the
    // other library, exactly as in a nested install that loads before us.
    warnOnDuplicateProseMirrorCopy('prosemirror-model', second.Fragment, 'some-library');

    const editor = new Editor({ element, extensions: [Document, Paragraph, Text] });
    editors.push(editor);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('Two different copies of "prosemirror-model"');
    /* A warning, not a refusal: two copies only break once an object crosses
       between them, and this editor never lets one. Refusing here would break
       an app deliberately running isolated editors in separate bundles. */
    editor.commands.setContent('<p>still works</p>');
    expect(editor.getHTML()).toContain('still works');
  });
});

describe('a real second copy of @domternal/core', () => {
  let element: HTMLElement;
  const editors: Editor[] = [];

  beforeEach(() => {
    resetProseMirrorCopyRegistry();
    element = document.createElement('div');
    document.body.appendChild(element);
  });

  afterEach(() => {
    for (const editor of editors.splice(0)) editor.destroy();
    element.remove();
    resetProseMirrorCopyRegistry();
    vi.restoreAllMocks();
  });

  it('builds extensions this editor refuses, naming the extension and the fix', async () => {
    const second = await secondCore();
    /* The failure the registry alone cannot see. Only ONE copy builds the
       editor; the other merely supplies an extension, so no two registrations
       ever disagree, and what follows instead is a plugin-key collision or an
       `instanceof` that is false for a node the schema itself produced. */
    expect(second.Paragraph).not.toBe(Paragraph);

    let message = '';
    try {
      editors.push(
        new Editor({ element, extensions: [Document, second.Paragraph as never, Text] })
      );
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }

    expect(message).toContain('The extension "paragraph" was built by a different copy');
    expect(message).toContain('@domternal/core');
    // Actionable, like every other message in this feature.
    for (const manager of ['pnpm', 'npm', 'yarn', 'Vite', 'webpack']) {
      expect(message).toContain(manager);
    }
    expect(message).toContain('https://domternal.dev/v1/guides/single-prosemirror-copy/');
  });

  it('fails loudly, as a configuration error rather than a swallowed hook error', async () => {
    const second = await secondCore();
    let error: unknown;
    try {
      editors.push(
        new Editor({ element, extensions: [Document, second.Paragraph as never, Text] })
      );
    } catch (caught) {
      error = caught;
    }
    /* Core isolates ordinary extension errors into an 'error' event so one bad
       extension cannot take the editor down. This one must escape that, or the
       app carries on with an editor whose schema is missing a node. */
    expect(error).toBeInstanceOf(ExtensionConfigurationError);
  });

  it('catches one nested inside a bundle, not only one passed by hand', async () => {
    const second = await secondCore();
    /* A bundle's members reach the editor through `addExtensions()`, one level
       below the array the app wrote. An extension smuggled in that way is
       exactly as foreign, so the check has to sit where the tree is walked
       rather than where the option is read. */
    const Bundle = second.Extension.create({
      name: 'foreignBundle',
      addExtensions: () => [second.Paragraph],
    });

    expect(() => {
      editors.push(
        new Editor({ element, extensions: [Document, Paragraph, Text, Bundle as never] })
      );
    }).toThrow(/was built by a different copy/);
  });

  it('accepts every extension from this copy', () => {
    const editor = new Editor({ element, extensions: [Document, Paragraph, Text] });
    editors.push(editor);
    editor.commands.setContent('<p>fine</p>');
    expect(editor.getHTML()).toContain('fine');
  });

  it('does not accuse a plain object of coming from another core', () => {
    /* An unbranded object has always been accepted or rejected on its own
       merits, and turning that into a duplicate-core accusation would be both
       wrong and a breaking change. It may still fail for its own reasons; what
       it must not do is fail with THIS message. */
    let message = '';
    try {
      editors.push(
        new Editor({ element, extensions: [Document, Paragraph, Text, { name: 'plain' } as never] })
      );
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }
    expect(message).not.toContain('was built by a different copy');
  });

  it('registers its own copy of the core, so two editors from two copies are reported', () => {
    editors.push(new Editor({ element, extensions: [Document, Paragraph, Text] }));

    // Re-registering the same frozen export is the healthy case and stays silent.
    expect(
      registerProseMirrorCopy('@domternal/core', ExtensionConfigurationError, 'probe')
    ).toBeNull();

    // A different class under the same name is the second copy, and is reported.
    class ForeignExtensionConfigurationError extends Error {}
    const conflict = registerProseMirrorCopy(
      '@domternal/core',
      ForeignExtensionConfigurationError,
      'a second core'
    );
    expect(conflict?.firstConsumer).toBe('@domternal/core');
    expect(conflict?.message).toContain('Two different copies of "@domternal/core"');
  });
});
