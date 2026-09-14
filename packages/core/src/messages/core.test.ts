import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '../Editor.js';
import { StarterKit } from '../extensions/StarterKit.js';
import { FontFamily } from '../extensions/FontFamily.js';
import { TextStyle } from '../marks/TextStyle.js';
import type { ToolbarDropdown } from '../types/Toolbar.js';

const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

function create(): Editor {
  const editor = new Editor({
    extensions: [StarterKit, TextStyle, FontFamily.configure({ fontFamilies: ['Custom Font'] })],
    content: '<p>Keep this document</p>',
  });
  editors.push(editor);
  return editor;
}

describe('core action messages', () => {
  it('refreshes nested actions and grouping without changing identifiers or document state', () => {
    const editor = create();
    const state = editor.state;
    const originalToolbarNames = editor.toolbarItems.map((item) => item.name);
    const originalFloatingNames = editor.floatingMenuItems.map((item) => item.name);
    const onTransaction = vi.fn();
    editor.on('transaction', onTransaction);
    editor.i18n.set({
      locale: 'hr',
      messages: {
        'core.toolbar.italic': 'Kurziv',
        'core.toolbar.heading': 'Naslov',
        'core.heading.level': ({ level }) => `Naslov ${String(level)}`,
        'core.group.format': 'Oblikovanje',
        'core.group.basic': 'Osnovno',
        'core.floating.headingBigDescription': 'Veliki naslov odjeljka',
      },
    });
    expect(editor.toolbarItems.map((item) => item.name)).toEqual(originalToolbarNames);
    expect(editor.floatingMenuItems.map((item) => item.name)).toEqual(originalFloatingNames);
    expect(editor.toolbarItems.find((item) => item.name === 'italic')).toMatchObject({
      label: 'Kurziv',
      labelLanguage: 'hr',
      group: 'format',
      groupLabel: 'Oblikovanje',
      groupLabelLanguage: 'hr',
      command: 'toggleItalic',
    });
    const heading = editor.toolbarItems.find((item) => item.name === 'heading') as ToolbarDropdown;
    expect(heading.label).toBe('Naslov');
    expect(heading.items.find((item) => item.name === 'heading1')).toMatchObject({
      label: 'Naslov 1',
      labelLanguage: 'hr',
      command: 'toggleHeading',
      commandArgs: [{ level: 1 }],
    });
    expect(heading.items.find((item) => item.name === 'paragraph')).toMatchObject({
      label: 'Normal text',
      labelLanguage: 'en',
    });
    expect(editor.floatingMenuItems.find((item) => item.name === 'heading-1')).toMatchObject({
      label: 'Naslov 1',
      group: 'Basic',
      groupLabel: 'Osnovno',
      groupLabelLanguage: 'hr',
      description: 'Veliki naslov odjeljka',
      descriptionLanguage: 'hr',
    });
    expect(editor.state).toBe(state);
    expect(onTransaction).not.toHaveBeenCalled();
  });

  it('preserves technical search aliases and user font names across same locale changes', () => {
    const editor = create();
    editor.i18n.set({
      locale: 'hr',
      messages: { 'core.floating.quote': 'Citat', 'core.toolbar.fontFamily': 'Font' },
      searchAliases: { 'core.floating.quote': ['navod'], 'core.heading.level': ['naslov'] },
    });
    const quote = editor.floatingMenuItems.find((item) => item.name === 'blockquote');
    expect(quote).toMatchObject({ label: 'Citat', labelLanguage: 'hr' });
    expect(quote?.keywords).toEqual(
      expect.arrayContaining(['navod', 'quote', 'blockquote', 'citation'])
    );
    expect(editor.floatingMenuItems.find((item) => item.name === 'heading-1')?.keywords).toEqual(
      expect.arrayContaining(['naslov', 'heading', 'title', 'h1'])
    );
    const font = editor.toolbarItems.find((item) => item.name === 'fontFamily') as ToolbarDropdown;
    expect(font.label).toBe('Font');
    expect(font.items[0]?.label).toBe('Custom Font');
    editor.i18n.set({ locale: 'hr', messages: { 'core.floating.quote': 'Navod' } });
    const refreshed = editor.floatingMenuItems.find((item) => item.name === 'blockquote');
    expect(refreshed?.label).toBe('Navod');
    expect(refreshed?.keywords).not.toContain('navod');
    expect(refreshed?.keywords).toContain('quote');
  });
});
