import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlockColor, Document, Editor, Extension, Heading, Paragraph, Text, localizeMessage } from '@domternal/core';
import type { AnyExtension, FloatingMenuItem } from '@domternal/core';
import { BlockHandle } from './BlockHandle.js';
import { BlockContextMenu } from './BlockContextMenu.js';
import { SlashCommand, filterSlashItems, slashCommandPluginKey } from './SlashCommand.js';
import { blockControlsMessages } from './messages.js';
import { createSlashSuggestionRenderer } from './createSlashSuggestionRenderer.js';

const editors: Editor[] = [];
const hosts: HTMLElement[] = [];
function createEditor(extensions: AnyExtension[], content = '<p>Hello</p>'): Editor {
  const host = document.createElement('div');
  host.className = 'dm-editor';
  document.body.appendChild(host);
  hosts.push(host);
  const editor = new Editor({ element: host, extensions: [Document, Paragraph, Text, Heading, ...extensions], content });
  editors.push(editor);
  return editor;
}
function hostOf(editor: Editor): HTMLElement {
  const host = editor.view.dom.closest<HTMLElement>('.dm-editor');
  if (!host) throw new Error('Expected an editor host.');
  return host;
}
function openContextMenu(editor: Editor): HTMLElement {
  const host = hostOf(editor);
  host.dispatchEvent(new CustomEvent('dm:block-context-menu-open', {
    detail: { blockPos: 0, anchorElement: editor.view.dom },
  }));
  return required(host, '.dm-block-context-menu');
}
function required(root: ParentNode, selector: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`Expected ${selector}.`);
  return element;
}
afterEach(() => {
  editors.splice(0).forEach(editor => { editor.destroy(); });
  hosts.splice(0).forEach(host => { host.remove(); });
  vi.restoreAllMocks();
});

describe('block controls UI localization', () => {
  it.each(['blockControls.handle.drag', 'blockControls.context.label', 'blockControls.context.delete'] as const)(
    'settles reentrant %s labels in existing controls', triggerId => {
      const editor = createEditor([BlockHandle, BlockContextMenu]);
      const host = hostOf(editor);
      const menu = openContextMenu(editor);
      const button = required(menu, '[aria-label="Delete"]');
      const drag = required(host, '.dm-block-handle-drag');
      button.focus();
      const state = editor.state;
      let changed = false;
      editor.i18n.set({ locale: 'hr', resolve: id => {
        if (id !== triggerId || changed) return undefined;
        changed = true;
        editor.i18n.set({ locale: 'de', messages: {
          'blockControls.context.label': 'Blockoptionen', 'blockControls.context.delete': 'Löschen',
          'blockControls.handle.drag': 'Block ziehen',
        } });
        return 'Stale Croatian wording';
      } });
      expect(changed).toBe(true);
      expect(menu.getAttribute('aria-label')).toBe('Blockoptionen');
      expect(menu.lang).toBe('de');
      expect(button.getAttribute('aria-label')).toBe('Löschen');
      expect(button.lang).toBe('de');
      expect(drag.getAttribute('aria-label')).toBe('Block ziehen');
      expect(drag.lang).toBe('de');
      expect(document.activeElement).toBe(button);
      expect(editor.state).toBe(state);
    },
  );

  it('patches an open context menu and handles without changing focus, pointer targets or editor state', () => {
    const editor = createEditor([BlockHandle, BlockContextMenu, BlockColor]);
    const host = hostOf(editor);
    const menu = openContextMenu(editor);
    const button = required(menu, '[aria-label="Delete"]');
    const heading = required(menu, '[aria-label="Heading 1"]');
    const swatch = required(menu, '.dm-block-color-swatch--bg[data-color="null"]');
    const drag = required(host, '.dm-block-handle-drag');
    button.focus();
    button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    const state = editor.state;
    const transaction = vi.fn();
    editor.on('transaction', transaction);
    editor.i18n.set({ locale: 'hr', messages: {
      'blockControls.context.label': 'Opcije bloka',
      'blockControls.context.delete': '<b>Izbriši</b>',
      'blockControls.context.turnInto': 'Pretvori u',
      'blockControls.turnInto.heading': ({ level }) => `Naslov ${String(level)}`,
      'blockControls.color.clearBackground': 'Bez pozadine',
      'blockControls.handle.drag': 'Povuci blok',
      'blockControls.handle.add': 'Dodaj blok',
    } });
    expect(menu.hasAttribute('data-show')).toBe(true);
    expect(menu.getAttribute('aria-label')).toBe('Opcije bloka');
    expect(menu.lang).toBe('hr');
    expect(menu.contains(button)).toBe(true);
    expect(button.textContent).toBe('<b>Izbriši</b>');
    expect(button.lang).toBe('hr');
    expect(menu.querySelector('b')).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(heading.getAttribute('aria-label')).toBe('Naslov 1');
    expect(swatch.getAttribute('aria-label')).toBe('Bez pozadine');
    expect(swatch.getAttribute('data-color')).toBe('null');
    expect(drag.getAttribute('aria-label')).toBe('Povuci blok');
    expect(host.querySelector('.dm-block-handle-plus')?.getAttribute('aria-label')).toBe('Dodaj blok');
    expect(editor.state).toBe(state);
    expect(transaction).not.toHaveBeenCalled();
    button.click();
    expect(editor.state.doc.textContent).toBe('');
  });

  it.each(['configure', 'extend'] as const)('keeps explicitly owned English target labels via %s', mode => {
    const targets = [{ label: 'Heading 1', icon: 'textHOne', nodeType: 'heading', attrs: { level: 1 } }];
    const extension = mode === 'configure'
      ? BlockContextMenu.configure({ turnIntoTargets: targets })
      : BlockContextMenu.extend({ addOptions() { return { turnIntoTargets: targets }; } });
    const editor = createEditor([extension]);
    editor.i18n.set({ locale: 'hr', messages: {
      'blockControls.context.label': 'Opcije bloka',
      'blockControls.turnInto.heading': ({ level }) => `Naslov ${String(level)}`,
    } });
    const menu = openContextMenu(editor);
    expect(menu.lang).toBe('hr');
    const target = menu.querySelector('[aria-label="Heading 1"]');
    expect(target).not.toBeNull();
    expect(target?.getAttribute('lang')).toBe('');
    expect(menu.querySelector('[aria-label="Naslov 1"]')).toBeNull();
  });

  it('re-reads contributed labels and disabled reasons by stable item ID without replacing the button', () => {
    const run = vi.fn();
    const contributor = Extension.create({
      name: 'localizedContribution',
      addBlockMenuItems() {
        const copy = localizeMessage(this.editor?.i18n, blockControlsMessages.duplicate);
        return [{
          id: 'custom-action', label: copy.text, labelLanguage: copy.language, icon: 'copy', group: 'primary',
          isEnabled: () => ({ disabled: true, reason: copy.text }), run,
        }];
      },
    });
    const editor = createEditor([contributor, BlockContextMenu]);
    const menu = openContextMenu(editor);
    const button = required(menu, '[data-block-menu-item="custom-action"]');
    button.focus();
    editor.i18n.set({ locale: 'hr', messages: { 'blockControls.context.duplicate': 'Dupliciraj' } });
    expect(menu.querySelector('[data-block-menu-item="custom-action"]')).toBe(button);
    expect(button.textContent).toBe('Dupliciraj');
    expect(button.title).toBe('Dupliciraj');
    expect(button.lang).toBe('hr');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(button);
    button.click();
    expect(run).not.toHaveBeenCalled();
  });

  it('isolates editors and removes handle/menu subscriptions during destroy', () => {
    const first = createEditor([BlockHandle, BlockContextMenu]);
    const second = createEditor([BlockHandle, BlockContextMenu]);
    const menu = openContextMenu(first);
    const button = required(menu, '[aria-label="Delete"]');
    const drag = required(hostOf(first), '.dm-block-handle-drag');
    first.i18n.set({ locale: 'hr', messages: { 'blockControls.context.delete': 'Izbriši', 'blockControls.handle.drag': 'Povuci' } });
    expect(openContextMenu(second).querySelector('[aria-label="Delete"]')).not.toBeNull();
    const menuResolve = vi.spyOn(first.i18n, 'resolve');
    first.destroy();
    menuResolve.mockClear();
    first.i18n.set({ locale: 'de' });
    expect(menuResolve).not.toHaveBeenCalled();
    expect(menu.isConnected).toBe(false);
    expect(drag.isConnected).toBe(false);
    expect(button.textContent).toBe('Izbriši');
  });
});

describe('slash UI localization', () => {
  it('keeps unknown custom item and group languages outside the translated menu language', () => {
    let language: string | undefined = 'en';
    const contributor = Extension.create({
      name: 'customSlashLanguage',
      addFloatingMenuItems() {
        return [{
          name: 'custom-insert', label: 'Custom action', description: 'Custom description',
          group: 'Custom', groupLabel: 'Custom group', command: vi.fn<() => void>(),
          ...(language ? { labelLanguage: language, descriptionLanguage: language, groupLabelLanguage: language } : {}),
        }];
      },
    });
    const editor = createEditor([contributor, SlashCommand], '<p></p>');
    editor.view.dispatch(editor.state.tr.insertText('/'));
    const root = required(hostOf(editor), '.dm-slash-command-menu');
    const button = required(root, '[aria-label="Custom action"]');
    const group = required(root, '[aria-label="Custom group"]');
    expect(button.lang).toBe('en');
    expect(group.lang).toBe('en');
    const state = editor.state;
    language = undefined;
    editor.i18n.set({ locale: 'hr', messages: { 'core.floatingMenu.label': 'Umetni blok' } });
    expect(root.lang).toBe('hr');
    expect(required(root, '[aria-label="Custom action"]')).toBe(button);
    expect(button.getAttribute('lang')).toBe('');
    expect(group.getAttribute('lang')).toBe('');
    expect(required(button, '.dm-slash-command-item-label').getAttribute('lang')).toBe('');
    expect(required(button, '.dm-slash-command-item-description').getAttribute('lang')).toBe('');
    expect(editor.state).toBe(state);
  });

  function createSlashEditor(command = vi.fn()): Editor {
    const contributor = Extension.create({
      name: 'localizedSlashContribution',
      addFloatingMenuItems() {
        const label = localizeMessage(this.editor?.i18n, blockControlsMessages.delete);
        const description = localizeMessage(this.editor?.i18n, blockControlsMessages.dragHandle);
        const group = localizeMessage(this.editor?.i18n, blockControlsMessages.contextMenu);
        return [{
          name: 'custom-insert', label: label.text, labelLanguage: label.language,
          description: description.text, descriptionLanguage: description.language,
          group: 'Custom', groupLabel: group.text, groupLabelLanguage: group.language,
          keywords: ['stable-alias'], command,
        }];
      },
    });
    return createEditor([contributor, SlashCommand], '<p></p>');
  }

  it.each(['core.floatingMenu.label', 'blockControls.slash.noMatches'] as const)(
    'settles reentrant %s copy in an open slash result', triggerId => {
      const editor = createSlashEditor();
      editor.view.dispatch(editor.state.tr.insertText('/'));
      editor.view.dispatch(editor.state.tr.insertText('zzzz'));
      const root = required(hostOf(editor), '.dm-slash-command-menu');
      const state = editor.state;
      let changed = false;
      editor.i18n.set({ locale: 'hr', resolve: id => {
        if (id !== triggerId || changed) return undefined;
        changed = true;
        editor.i18n.set({ locale: 'de', messages: {
          'core.floatingMenu.label': 'Block einfügen', 'blockControls.slash.noMatches': 'Keine Ergebnisse',
        } });
        return 'Stale Croatian wording';
      } });
      expect(changed).toBe(true);
      expect(root.getAttribute('aria-label')).toBe('Block einfügen');
      expect(root.lang).toBe('de');
      expect(root.querySelector('.dm-slash-command-empty')?.textContent).toBe('Keine Ergebnisse');
      expect(editor.state).toBe(state);
    },
  );

  it('patches the open slash popup in place and retains the selected action across a pending click', () => {
    const command = vi.fn();
    const editor = createSlashEditor(command);
    editor.view.dispatch(editor.state.tr.insertText('/'));
    const root = required(hostOf(editor), '.dm-slash-command-menu');
    const button = Array.from(root.querySelectorAll<HTMLButtonElement>('.dm-slash-command-item')).find(item => item.getAttribute('aria-label') === 'Delete');
    if (!button) throw new Error('Expected a contributed slash action.');
    button.dispatchEvent(new MouseEvent('mouseenter'));
    button.focus();
    button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    const selectedId = root.getAttribute('aria-activedescendant');
    const state = editor.state;
    const pluginState = slashCommandPluginKey.getState(state);
    const transaction = vi.fn();
    editor.on('transaction', transaction);
    editor.i18n.set({ locale: 'hr', messages: {
      'core.floatingMenu.label': 'Umetni blok',
      'blockControls.context.delete': '<b>Dodaj</b>',
      'blockControls.handle.drag': 'Opis stavke',
      'blockControls.context.label': 'Moja grupa',
    } });
    expect(root.getAttribute('aria-label')).toBe('Umetni blok');
    expect(root.contains(button)).toBe(true);
    expect(button.getAttribute('aria-label')).toBe('<b>Dodaj</b>');
    expect(button.lang).toBe('hr');
    expect(button.querySelector('.dm-slash-command-item-description')?.textContent).toBe('Opis stavke');
    expect(root.querySelector('b')).toBeNull();
    expect(root.querySelector('[role="group"][aria-label="Moja grupa"]')?.getAttribute('lang')).toBe('hr');
    expect(root.getAttribute('aria-activedescendant')).toBe(selectedId);
    expect(document.activeElement).toBe(button);
    expect(editor.state).toBe(state);
    expect(slashCommandPluginKey.getState(editor.state)).toBe(pluginState);
    expect(transaction).not.toHaveBeenCalled();
    button.click();
    expect(command).toHaveBeenCalledOnce();
    expect(editor.state.doc.textContent).toBe('');
  });

  it('re-filters translated labels without changing the query and translates an empty result', () => {
    const editor = createSlashEditor();
    editor.view.dispatch(editor.state.tr.insertText('/'));
    editor.view.dispatch(editor.state.tr.insertText('resume'));
    const root = required(hostOf(editor), '.dm-slash-command-menu');
    expect(root.querySelector('.dm-slash-command-empty')?.textContent).toBe('No matches');
    const state = editor.state;
    editor.i18n.set({ locale: 'fr', messages: { 'blockControls.context.delete': 'Résumé' } });
    expect(root.querySelector('[aria-label="Résumé"]')).not.toBeNull();
    expect(editor.state).toBe(state);
    expect(slashCommandPluginKey.getState(state)?.query).toBe('resume');
    editor.i18n.set({ locale: 'hr', messages: { 'blockControls.slash.noMatches': 'Nema rezultata' } });
    expect(root.querySelector('.dm-slash-command-empty')?.textContent).toBe('Nema rezultata');
    expect(root.querySelector('.dm-slash-command-empty')?.getAttribute('lang')).toBe('hr');
    expect(root.hasAttribute('aria-activedescendant')).toBe(false);
    expect(editor.state).toBe(state);
  });

  it('refreshes a custom renderer without recreating it and stops updates after destruction', () => {
    const onStart = vi.fn();
    const onUpdate = vi.fn();
    const onExit = vi.fn();
    const render = vi.fn(() => ({ onStart, onUpdate, onExit, onKeyDown: () => false }));
    const editor = createEditor([SlashCommand.configure({ render })], '<p></p>');
    editor.view.dispatch(editor.state.tr.insertText('/'));
    onUpdate.mockClear();
    editor.i18n.set({ locale: 'hr' });
    expect(render).toHaveBeenCalledOnce();
    expect(onStart).toHaveBeenCalledOnce();
    expect(onUpdate).toHaveBeenCalledOnce();
    editor.destroy();
    expect(onExit).toHaveBeenCalledOnce();
    editor.i18n.set({ locale: 'de' });
    expect(onUpdate).toHaveBeenCalledOnce();
  });

  it('retains surviving buttons when localized filtering changes order and ignores a removed pending target', () => {
    const editor = createEditor([], '<p></p>');
    const renderer = createSlashSuggestionRenderer();
    const command = vi.fn();
    const first: FloatingMenuItem = { name: 'first', label: 'First', command: 'noop', group: 'Stable' };
    const second: FloatingMenuItem = { name: 'second', label: 'Second', command: 'noop', group: 'Stable' };
    const props = {
      editor, query: 's', range: { from: 0, to: 1 }, items: [first, second], command,
      clientRect: () => new DOMRect(), element: editor.view.dom,
    };
    renderer.onStart(props);
    const root = required(hostOf(editor), '.dm-slash-command-menu');
    const removed = required(root, '[aria-label="First"]');
    const retained = required(root, '[aria-label="Second"]');
    retained.dispatchEvent(new MouseEvent('mouseenter'));
    retained.focus();
    retained.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    const selectedId = root.getAttribute('aria-activedescendant');
    renderer.onUpdate({ ...props, items: [{ ...second, label: 'Deuxième', labelLanguage: 'fr' }] });
    expect(root.querySelector('[aria-label="Deuxième"]')).toBe(retained);
    expect(root.getAttribute('aria-activedescendant')).toBe(selectedId);
    expect(document.activeElement).toBe(retained);
    removed.click();
    expect(command).not.toHaveBeenCalled();
    retained.click();
    expect(command).toHaveBeenCalledWith(expect.objectContaining({ name: 'second', label: 'Deuxième' }));
    renderer.onExit();
  });

  it('uses locale case folding and accent-insensitive label and keyword matching', () => {
    const items: FloatingMenuItem[] = [
      { name: 'summary', label: 'Résumé', command: 'noop' },
      { name: 'light', label: 'IŞIK', keywords: ['ışık'], command: 'noop' },
      { name: 'keyword', label: 'Other', keywords: ['Crème'], command: 'noop' },
    ];
    expect(filterSlashItems(items, 'resume', 'fr').map(item => item.name)).toEqual(['summary']);
    expect(filterSlashItems(items, 'ışık', 'tr').map(item => item.name)).toEqual(['light']);
    expect(filterSlashItems(items, 'creme', 'fr').map(item => item.name)).toEqual(['keyword']);
  });
});
