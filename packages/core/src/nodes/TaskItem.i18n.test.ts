import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '../Editor.js';
import { Document } from './Document.js';
import { Text } from './Text.js';
import { Paragraph } from './Paragraph.js';
import { TaskItem } from './TaskItem.js';
import { TaskList } from './TaskList.js';

const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

describe('task item localization', () => {
  it('patches only the live checkbox name and retains document serialization and node identity', () => {
    const editor = new Editor({
      extensions: [Document, Text, Paragraph, TaskList, TaskItem],
      content:
        '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Keep this task</p></li></ul>',
    });
    editors.push(editor);
    const checkbox = editor.view.dom.querySelector<HTMLInputElement>('input');
    const paragraph = editor.view.dom.querySelector('p');
    const state = editor.state;
    const html = editor.getHTML();
    const onTransaction = vi.fn();
    editor.on('transaction', onTransaction);
    editor.i18n.set({
      locale: 'hr',
      messages: { 'core.taskItem.status': '<b>Status zadatka</b>' },
    });
    expect(editor.view.dom.querySelector('input')).toBe(checkbox);
    expect(editor.view.dom.querySelector('p')).toBe(paragraph);
    expect(checkbox?.getAttribute('aria-label')).toBe('<b>Status zadatka</b>');
    expect(checkbox?.lang).toBe('hr');
    expect(checkbox?.checked).toBe(true);
    expect(paragraph?.getAttribute('lang')).toBeNull();
    expect(editor.state).toBe(state);
    expect(editor.getHTML()).toBe(html);
    expect(onTransaction).not.toHaveBeenCalled();
    editor.i18n.set({ locale: 'de' });
    expect(checkbox?.getAttribute('aria-label')).toBe('Task status');
    expect(checkbox?.lang).toBe('en');
    editor.commands.setContent('<p>Task removed</p>');
    editor.i18n.set({
      locale: 'hr',
      messages: { 'core.taskItem.status': 'Changed after removal' },
    });
    expect(checkbox?.getAttribute('aria-label')).toBe('Task status');
  });
});
