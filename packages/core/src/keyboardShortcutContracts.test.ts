import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from './Editor.js';
import { Extension } from './Extension.js';
import { Document } from './nodes/Document.js';
import { Paragraph } from './nodes/Paragraph.js';
import { Text } from './nodes/Text.js';

let editor: Editor | undefined;
afterEach(() => { editor?.destroy(); });

describe('executable shortcut spelling', () => {
  it.each([
    ['Control-d', 'd', false, true],
    ['Control-D', 'd', false, false],
    ['Control-D', 'D', true, true],
    ['Control-Shift-d', 'D', true, true],
  ] as const)('keeps the installed keymap meaning of %s for key=%s shift=%s', (binding, key, shiftKey, handled) => {
    const command = vi.fn(() => true);
    const shortcuts = Extension.create({
      name: 'shortcutContract',
      addKeyboardShortcuts: () => ({ [binding]: command }),
    });
    editor = new Editor({ extensions: [Document, Paragraph, Text, shortcuts] });
    const event = new KeyboardEvent('keydown', { key, keyCode: 68, ctrlKey: true, shiftKey });
    const result = editor.view.someProp('handleKeyDown', handler => handler(editor!.view, event));
    expect(Boolean(result)).toBe(handled);
    expect(command).toHaveBeenCalledTimes(handled ? 1 : 0);
  });

  it('does not register a display-only toolbar shortcut as a binding', () => {
    const display = Extension.create({
      name: 'displayShortcut',
      addToolbarItems: () => [{
        type: 'button', name: 'insert', label: 'Insert', icon: '',
        command: 'insertText', commandArgs: ['unexpected'], shortcut: 'Control-d',
      }],
    });
    editor = new Editor({ extensions: [Document, Paragraph, Text, display] });
    const event = new KeyboardEvent('keydown', { key: 'd', keyCode: 68, ctrlKey: true });
    editor.view.someProp('handleKeyDown', handler => handler(editor!.view, event));
    expect(editor.state.doc.textContent).toBe('');
  });
});
