import { afterEach, describe, expect, it, vi } from 'vitest';
import { undoDepth, redoDepth } from '@domternal/pm/history';
import { Editor } from './Editor.js';
import { Document } from './nodes/Document.js';
import { Paragraph } from './nodes/Paragraph.js';
import { Text } from './nodes/Text.js';
import { Bold } from './marks/Bold.js';
import { History } from './extensions/History.js';
import { Extension } from './Extension.js';
import { ToolbarController } from './ToolbarController.js';
import { FloatingMenuController } from './FloatingMenuController.js';
import { coreMessages } from './messages/core.js';
import { localizedLabel } from './utils/localizeMessage.js';
import type { EditorOptions } from './types/EditorOptions.js';

const editors: Editor[] = [];
function create(options: Partial<EditorOptions> = {}): Editor {
  const editor = new Editor({
    extensions: [Document, Paragraph, Text, Bold, History],
    content: '<p>Hello</p>',
    ...options,
  });
  editors.push(editor);
  return editor;
}
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

describe('editor UI localization', () => {
  it('keeps the document, view, selection, history and plugin identities across changes', () => {
    const onUpdate = vi.fn();
    const onTransaction = vi.fn();
    const editor = create({ onUpdate, onTransaction });
    editor.view.dispatch(editor.state.tr.insertText('!', 6));
    const view = editor.view;
    const state = editor.state;
    const commands = editor.extensionManager.commands;
    const plugins = editor.extensionManager.plugins;
    const nodeViews = editor.extensionManager.nodeViews;
    const undo = undoDepth(state);
    const redo = redoDepth(state);
    onUpdate.mockClear();
    onTransaction.mockClear();
    editor.i18n.set({ locale: 'de', messages: { 'core.toolbar.bold': 'Fett' } });
    expect(editor.view).toBe(view);
    expect(editor.state).toBe(state);
    expect(editor.state.doc.textContent).toBe('Hello!');
    expect(editor.extensionManager.commands).toBe(commands);
    expect(editor.extensionManager.plugins).toBe(plugins);
    expect(editor.extensionManager.nodeViews).toBe(nodeViews);
    expect(undoDepth(editor.state)).toBe(undo);
    expect(redoDepth(editor.state)).toBe(redo);
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onTransaction).not.toHaveBeenCalled();
  });

  it('invalidates presentation before subscribers and keeps editor instances isolated', () => {
    const first = create();
    const second = create();
    const original = first.toolbarItems;
    const other = second.toolbarItems;
    const labels: string[] = [];
    first.i18n.subscribe(() => {
      const item = first.toolbarItems.find((entry) => entry.name === 'bold');
      if (item && item.type !== 'separator') labels.push(item.label);
    });
    first.i18n.set({ locale: 'de', messages: { 'core.toolbar.bold': 'Fett' } });
    expect(labels).toEqual(['Fett']);
    expect(first.toolbarItems).not.toBe(original);
    expect(second.toolbarItems).toBe(other);
    expect(second.toolbarItems.find((item) => item.name === 'bold')).toMatchObject({
      label: 'Bold', labelLanguage: 'en',
    });
    const translated = first.toolbarItems;
    first.i18n.set({ locale: 'de', messages: { 'core.toolbar.bold': 'Fett' } });
    expect(first.toolbarItems).toBe(translated);
    expect(labels).toEqual(['Fett']);
  });

  it('refreshes an accessible UI name without changing document language or explicit names', () => {
    const translated = create();
    const explicit = create({ ariaLabel: 'Rich text editor' });
    for (const editor of [translated, explicit]) {
      editor.view.dom.setAttribute('lang', 'en');
      editor.i18n.set({ locale: 'de', messages: { 'core.editor.label': 'Texteditor' } });
      expect(editor.view.dom.getAttribute('lang')).toBe('en');
    }
    expect(translated.view.dom.getAttribute('aria-label')).toBe('Texteditor');
    expect(explicit.view.dom.getAttribute('aria-label')).toBe('Rich text editor');
  });

  it('initializes the service before extension hooks and accepts updates before view construction', () => {
    const before = vi.fn();
    const custom = Extension.create({
      name: 'localizedHook',
      onBeforeCreate() { before(this.editor?.i18n?.t(coreMessages.bold)); },
    });
    const editor = create({
      extensions: [Document, Paragraph, Text, custom],
      i18n: { messages: { 'core.toolbar.bold': 'Strong' } },
      onBeforeCreate: ({ editor: instance }) => {
        (instance as Editor).i18n.set({ messages: { 'core.toolbar.bold': 'Custom bold' } });
      },
    });
    expect(before).toHaveBeenCalledWith('Custom bold');
    expect(editor.i18n.t(coreMessages.bold)).toBe('Custom bold');
  });

  it('updates toolbar and floating controllers without losing their active item', () => {
    const custom = Extension.create({
      name: 'localizedMenu',
      addToolbarItems() {
        return [{
          type: 'dropdown', name: 'formatting', icon: 'textB',
          ...localizedLabel(this.editor?.i18n, coreMessages.bold), items: [],
        }];
      },
      addFloatingMenuItems() {
        return [{
          name: 'bold', command: 'toggleBold',
          ...localizedLabel(this.editor?.i18n, coreMessages.bold),
        }];
      },
    });
    const editor = create({ extensions: [Document, Paragraph, Text, Bold, custom] });
    const toolbarChanged = vi.fn();
    const floatingChanged = vi.fn();
    const toolbar = new ToolbarController(editor as unknown as ConstructorParameters<typeof ToolbarController>[0], toolbarChanged);
    const floating = new FloatingMenuController(editor, floatingChanged);
    toolbar.subscribe();
    floating.subscribe();
    toolbar.toggleDropdown('formatting');
    floating.enterMenu();
    toolbarChanged.mockClear();
    floatingChanged.mockClear();
    editor.i18n.set({ locale: 'de', messages: { 'core.toolbar.bold': 'Fett' } });
    expect(toolbar.openDropdown).toBe('formatting');
    expect(floating.focusedItem()).toMatchObject({ name: 'bold', label: 'Fett' });
    expect(toolbarChanged).toHaveBeenCalled();
    expect(floatingChanged).toHaveBeenCalled();
    toolbar.destroy();
    floating.destroy();
    toolbarChanged.mockClear();
    floatingChanged.mockClear();
    editor.i18n.refresh();
    expect(toolbarChanged).not.toHaveBeenCalled();
    expect(floatingChanged).not.toHaveBeenCalled();
  });
});
