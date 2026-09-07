import { afterEach, describe, expect, it } from 'vitest';
import { PluginKey } from '@domternal/pm/state';
import { Editor } from './Editor.js';
import { Document } from './nodes/Document.js';
import { Paragraph } from './nodes/Paragraph.js';
import { Text } from './nodes/Text.js';
import { createBubbleMenuPlugin } from './extensions/BubbleMenu.js';
import { createFloatingMenuPlugin } from './FloatingMenuPlugin.js';

let editor: Editor | undefined;
const elements: HTMLElement[] = [];

function makeElement(className: string): HTMLElement {
  const element = document.createElement('div');
  element.className = className;
  document.body.appendChild(element);
  elements.push(element);
  return element;
}

afterEach(() => {
  editor?.destroy();
  editor = undefined;
  elements.splice(0).forEach(element => { element.remove(); });
});

describe.each(['bubble', 'floating'] as const)('%s menu adoption', (kind) => {
  it('moves the menu and its dismiss listener to the new editor host', () => {
    editor = new Editor({
      extensions: [Document, Paragraph, Text],
      content: '<p>Hello</p>',
    });
    const first = makeElement('dm-editor');
    const second = makeElement('dm-editor');
    const menu = makeElement(`dm-${kind}-menu`);
    const options = { editor, element: menu, pluginKey: new PluginKey(`adoption-${kind}`) };
    editor.registerPlugin(kind === 'bubble'
      ? createBubbleMenuPlugin(options)
      : createFloatingMenuPlugin(options));

    editor.adoptDom(first);
    expect(menu.parentElement).toBe(first);
    menu.setAttribute('data-show', '');
    first.dispatchEvent(new Event('dm:dismiss-overlays'));
    expect(menu.hasAttribute('data-show')).toBe(false);

    editor.adoptDom(second);
    expect(menu.parentElement).toBe(second);
    menu.setAttribute('data-show', '');
    first.dispatchEvent(new Event('dm:dismiss-overlays'));
    expect(menu.hasAttribute('data-show')).toBe(true);
    second.dispatchEvent(new Event('dm:dismiss-overlays'));
    expect(menu.hasAttribute('data-show')).toBe(false);

    editor.destroy();
    menu.setAttribute('data-show', '');
    second.dispatchEvent(new Event('dm:dismiss-overlays'));
    expect(menu.hasAttribute('data-show')).toBe(true);
  });
});
