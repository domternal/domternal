import { Editor, Extension, Node, StarterKit, showFloatingMenu } from '@domternal/core';
import type { FloatingMenuItem, JSONContent } from '@domternal/core';
import { SlashCommand } from '@domternal/extension-block-controls';
import { Mention } from '@domternal/extension-mention';
import { MathInline, MathBlock } from '@domternal/extension-math';
import { TextSelection } from '@domternal/pm/state';
import { DomternalFloatingMenu, DomternalToolbar } from '@domternal/vanilla';
import '@domternal/theme/css';

const style = document.createElement('style');
style.textContent = 'body { margin: 48px; } main { max-width: 760px; } ' +
  '#editor { position: relative; min-height: 280px; padding: 24px; }';
document.head.appendChild(style);

function element(id: string): HTMLElement {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing fixture element: ${id}`);
  return value;
}

const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  parseHTML: () => [{ tag: 'aside[data-callout]' }],
  renderHTML: () => ['aside', { 'data-callout': '' }, 0],
});

const customItems: FloatingMenuItem[] = [
  { name: 'custom', label: 'Custom action', icon: 'tutorialStar', command: 'insertText', commandArgs: ['custom'], hideWhenInside: ['callout'] },
  { name: 'override', label: 'Overridden heading', icon: 'textHOne', command: 'insertText', commandArgs: ['heading'] },
  { name: 'fallback', label: 'Default bullet', icon: 'listBullets', command: 'insertText', commandArgs: ['bullet'], hideWhenInside: ['bulletList'] },
  { name: 'ordered', label: 'Default ordered', icon: 'listNumbers', command: 'insertText', commandArgs: ['ordered'], hideWhenInside: ['orderedList'] },
  { name: 'task', label: 'Default task', icon: 'listChecks', command: 'insertText', commandArgs: ['task'], hideWhenInside: ['taskList'] },
  { name: 'empty', label: 'Intentionally empty icon', icon: 'textB', command: 'insertText', commandArgs: ['empty'] },
  { name: 'missing', label: 'Missing icon stays readable', icon: 'unregisteredTutorialIcon', command: 'insertText', commandArgs: ['missing'] },
];

let shortcutCount = 0;
const TutorialItems = Extension.create({
  name: 'tutorialMenuItems',
  addFloatingMenuItems: () => customItems,
  addKeyboardShortcuts() {
    return {
      'Mod-Shift-d': () => {
        element('shortcut-result').textContent = String(++shortcutCount);
        return true;
      },
    };
  },
  addToolbarItems: () => [{
    type: 'button', name: 'displayOnly', label: 'Display only shortcut', icon: 'textB',
    command: 'insertText', commandArgs: ['button'], shortcut: 'F9',
  }],
});

const editor = new Editor({
  element: element('editor'),
  extensions: [
    StarterKit.configure({ trailingNode: false, linkPopover: false }),
    Callout, Mention, MathInline, MathBlock, TutorialItems,
    SlashCommand.configure({
      items: customItems,
      icons: {
        tutorialStar: '<svg viewBox="0 0 24 24" data-tutorial-icon="custom"><circle cx="12" cy="12" r="8"/></svg>',
        textHOne: '<svg viewBox="0 0 24 24" data-tutorial-icon="override"><path d="M4 4h16v16H4z"/></svg>',
        textB: '',
      },
    }),
  ],
  content: '<p></p>',
});

new DomternalToolbar(element('toolbar'), { editor });
new DomternalFloatingMenu(element('floating'), { editor, requireExplicitTrigger: true });

export interface TutorialMenusHarness {
  editor: Editor;
  seed: (content: string | JSONContent, from?: number, to?: number) => void;
  openFloating: () => void;
}

declare global {
  interface Window { __TUTORIAL_MENUS__: TutorialMenusHarness }
}

window.__TUTORIAL_MENUS__ = {
  editor,
  openFloating: () => { showFloatingMenu(editor.view); },
  seed(content, from, to = from): void {
    editor.setContent(content, false);
    editor.commands.focus('start');
    if (from !== undefined) {
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)));
    }
  },
};
