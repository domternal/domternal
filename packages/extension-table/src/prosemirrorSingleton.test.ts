import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Editor, Document, Text, Paragraph, registerProseMirrorCopy } from '@domternal/core';
import { CellSelection } from '@domternal/pm/tables';
import { Table } from './Table.js';
import { TableRow } from './TableRow.js';
import { TableCell } from './TableCell.js';
import { TableHeader } from './TableHeader.js';

/**
 * `prosemirror-tables` is identity-compared more visibly than most: every
 * table command tests the selection with `instanceof CellSelection`, so a
 * second copy leaves the whole table toolbar inert on a selection the table
 * itself produced, with no error anywhere. Core cannot register it because
 * core does not import the package, so this extension does.
 */
const REGISTRY_KEY = Symbol.for('domternal.prosemirror.copies');
const foreignCopy = { pretendClass: 'CellSelection' };

function noop(): void {
  return undefined;
}

function makeEditor(): Editor {
  return new Editor({
    extensions: [Document, Text, Paragraph, Table, TableRow, TableCell, TableHeader],
    content: '<p>hi</p>',
  });
}

describe('extension-table ProseMirror single-copy registration', () => {
  let editor: Editor | undefined;

  beforeEach(() => {
    (globalThis as Record<symbol, unknown>)[REGISTRY_KEY] = undefined;
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    (globalThis as Record<symbol, unknown>)[REGISTRY_KEY] = undefined;
    vi.restoreAllMocks();
  });

  it('registers the CellSelection the frozen contract names', () => {
    editor = makeEditor();
    // Silent only if the extension registered exactly this export.
    expect(registerProseMirrorCopy('prosemirror-tables', CellSelection, 'probe')).toBeNull();
  });

  it('warns when prosemirror-tables is already registered from another copy', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(noop);
    registerProseMirrorCopy('prosemirror-tables', foreignCopy, 'some-other-editor');
    editor = makeEditor();
    const message = warn.mock.calls.map((call) => String(call[0])).join('\n');
    expect(message).toContain('"prosemirror-tables"');
    expect(message).toContain('@domternal/extension-table');
    expect(message).toContain('some-other-editor');
  });

  it('still builds the editor, because a duplicate here breaks commands, not construction', () => {
    vi.spyOn(console, 'warn').mockImplementation(noop);
    registerProseMirrorCopy('prosemirror-tables', foreignCopy, 'some-other-editor');
    expect(() => {
      editor = makeEditor();
    }).not.toThrow();
  });

  it('does not implicate prosemirror-model, which core registers separately', () => {
    editor = makeEditor();
    const store = (globalThis as Record<symbol, unknown>)[REGISTRY_KEY] as Map<
      string,
      { consumer: string }
    >;
    expect(store.get('prosemirror-tables')?.consumer).toBe('@domternal/extension-table');
    expect(store.get('prosemirror-model')?.consumer).toBe('@domternal/core');
  });
});
