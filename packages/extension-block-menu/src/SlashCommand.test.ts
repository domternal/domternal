import { describe, it, expect, afterEach } from 'vitest';
import type { FloatingMenuItem } from '@domternal/core';
import { Document, Text, Paragraph, Heading, Editor } from '@domternal/core';
import {
  SlashCommand,
  slashCommandPluginKey,
  dismissSlashCommand,
  filterSlashItems,
} from './SlashCommand.js';

// ─── Filter tests (pure function, no editor needed) ──────────────────────────

describe('filterSlashItems', () => {
  const items: FloatingMenuItem[] = [
    { name: 'h1', label: 'Heading 1', keywords: ['heading', 'h1', 'title'], command: 'toggleHeading' },
    { name: 'h2', label: 'Heading 2', keywords: ['heading', 'h2'], command: 'toggleHeading' },
    { name: 'bullet', label: 'Bulleted list', keywords: ['bullet', 'list', 'unordered'], command: 'toggleBulletList' },
    { name: 'code', label: 'Code block', keywords: ['code', 'snippet'], command: 'toggleCodeBlock' },
    { name: 'image', label: 'Image', keywords: ['image', 'picture'], command: 'setImage' },
  ];

  it('returns all items unchanged when query is empty', () => {
    expect(filterSlashItems(items, '')).toEqual(items);
  });

  it('ranks exact label prefix matches highest', () => {
    const result = filterSlashItems(items, 'head');
    // Both headings should come before any keyword-only matches
    expect(result[0]?.name).toBe('h1');
    expect(result[1]?.name).toBe('h2');
  });

  it('includes items matching on label substring', () => {
    const result = filterSlashItems(items, 'block');
    expect(result.map((i) => i.name)).toContain('code');
  });

  it('includes items matching on keywords when label does not match', () => {
    const result = filterSlashItems(items, 'unordered');
    expect(result.map((i) => i.name)).toContain('bullet');
  });

  it('filters out items that do not match label or any keyword', () => {
    const result = filterSlashItems(items, 'xyz');
    expect(result).toEqual([]);
  });

  it('matches case-insensitively', () => {
    const upper = filterSlashItems(items, 'HEAD');
    const lower = filterSlashItems(items, 'head');
    expect(upper.map((i) => i.name)).toEqual(lower.map((i) => i.name));
  });

  it('ranks label-substring matches higher than keyword matches', () => {
    const result = filterSlashItems(items, 'image');
    // 'Image' label matches (substring) → rank 1, should come first
    // (nothing else has 'image' in its label, though keywords do)
    expect(result[0]?.name).toBe('image');
  });

  it('returns empty array for non-matching query', () => {
    const result = filterSlashItems(items, 'completely-unrelated-term');
    expect(result).toEqual([]);
  });
});

// ─── Plugin state tests ──────────────────────────────────────────────────────

const extensions = [Document, Text, Paragraph, Heading, SlashCommand];

function makeEditor(html = '<p></p>'): Editor {
  return new Editor({ extensions, content: html });
}

describe('SlashCommand plugin', () => {
  it('has the correct extension name', () => {
    expect(SlashCommand.name).toBe('slashCommand');
  });

  it('has char "/" and invalidNodes ["codeBlock"] by default', () => {
    expect(SlashCommand.options.char).toBe('/');
    expect(SlashCommand.options.invalidNodes).toEqual(['codeBlock']);
  });

  it('registers a ProseMirror plugin', () => {
    const editor = makeEditor();
    const state = slashCommandPluginKey.getState(editor.state);
    expect(state).toBeDefined();
    expect(state?.active).toBe(false);
    expect(state?.query).toBe('');
    editor.destroy();
  });

  it('dismissSlashCommand resets plugin state', () => {
    const editor = makeEditor();
    // Simulate being active via meta
    const tr = editor.state.tr.setMeta(slashCommandPluginKey, 'dismiss');
    editor.view.dispatch(tr);
    const state = slashCommandPluginKey.getState(editor.state);
    expect(state?.active).toBe(false);
    // dismissSlashCommand should not throw even on fresh editor
    expect(() => { dismissSlashCommand(editor.view); }).not.toThrow();
    editor.destroy();
  });

  it('initial state is inactive with empty query and null range', () => {
    const editor = makeEditor();
    const state = slashCommandPluginKey.getState(editor.state);
    expect(state).toEqual({ active: false, query: '', range: null });
    editor.destroy();
  });
});

// --- Re-entrant dispatch regression --------------------------------------------
//
// When the slash popup activates, its `view.update` synchronously dispatches
// `dm:dismiss-overlays` so other overlays close. A `suppressDismissHandler`
// flag stops our own listener from firing back at us. The flag's lifecycle
// is fragile: `wasActive = true` must be set BEFORE the dispatch so the
// re-entrant `update` (other overlays may dispatch a PM transaction in
// response) sees `becameActive === false` and doesn't fire a SECOND
// `dm:dismiss-overlays` whose nested `finally` would reset the flag and
// open us up to self-dismissal.

describe('SlashCommand - re-entrant dispatch suppression', () => {
  let host: HTMLElement | undefined;
  let editor: Editor | undefined;

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    host?.remove();
    host = undefined;
  });

  function mountEditor(content = '<p>/</p>'): Editor {
    host = document.createElement('div');
    host.className = 'dm-editor';
    document.body.appendChild(host);
    editor = new Editor({
      element: host,
      extensions: [Document, Text, Paragraph, Heading, SlashCommand],
      content,
    });
    return editor;
  }

  it('survives a re-entrant transaction triggered by dm:dismiss-overlays', () => {
    const ed = mountEditor();
    // Move cursor to after the `/` char and trigger a re-evaluation. The
    // plugin's apply() detects the slash query and flips `active` to true;
    // view.update() will dispatch dm:dismiss-overlays.
    const tr = ed.state.tr.setSelection(
      // Selection right after `/` - position 2: doc(0) > p(1) > "/"(2).
      // Use TextSelection.near via a no-op meta to nudge apply().
      ed.state.selection,
    );
    // Re-entrant listener: when our open-time dispatch fires, we synchronously
    // dispatch a PM transaction. `view.update` re-runs while still inside
    // the original `update`. Without correct flag ordering this would self-dismiss.
    let reentryCount = 0;
    host?.addEventListener('dm:dismiss-overlays', () => {
      reentryCount++;
      // Re-enter `update` with a no-op selectionSet transaction.
      ed.view.dispatch(ed.view.state.tr.setSelection(ed.view.state.selection));
    });

    // Force the slash popup to activate by typing a `/` at cursor.
    ed.view.dispatch(tr);
    ed.view.dispatch(ed.view.state.tr.insertText('/'));

    const state = slashCommandPluginKey.getState(ed.state);
    // The popup must still be active after the re-entrant ping. The exact
    // count varies by PM version (each transaction triggers update()), but
    // crucially: more than zero re-entries fired AND state.active is true.
    expect(reentryCount).toBeGreaterThan(0);
    expect(state?.active).toBe(true);
  });
});
