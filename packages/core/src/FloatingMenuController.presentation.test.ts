import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { Editor } from './Editor.js';
import { Extension } from './Extension.js';
import { Document } from './nodes/Document.js';
import { Paragraph } from './nodes/Paragraph.js';
import { Text } from './nodes/Text.js';
import { FloatingMenuController } from './FloatingMenuController.js';

const cleanup: (() => void)[] = [];

interface PresentationFixture {
  editor: Editor;
  root: HTMLDivElement;
  target: HTMLButtonElement;
  controller: FloatingMenuController;
  changed: Mock<() => void>;
  execute: Mock<() => void>;
  disable: () => void;
}

function setup(defer = true): PresentationFixture {
  let disabled = false;
  const execute = vi.fn<() => void>();
  const controls = Extension.create({
    name: 'presentationControls',
    addFloatingMenuItems() {
      const locale = this.editor?.i18n?.getSnapshot().locale ?? 'en';
      return [
        { name: 'first', label: `First ${locale}`, description: `Description ${locale}`, command: execute, isDisabled: () => disabled },
        { name: 'second', label: `Second ${locale}`, command: execute },
      ];
    },
  });
  const editor = new Editor({ extensions: [Document, Paragraph, Text, controls], content: '<p>Author text</p>' });
  const root = document.createElement('div');
  const target = document.createElement('button');
  root.appendChild(target);
  document.body.appendChild(root);
  const changed = vi.fn<() => void>();
  const controller = new FloatingMenuController(editor, changed);
  if (defer) controller.subscribe(() => root);
  else controller.subscribe();
  cleanup.push(() => { controller.destroy(); editor.destroy(); root.remove(); });
  return { editor, root, target, controller, changed, execute, disable: () => { disabled = true; } };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
  for (const destroy of cleanup.splice(0).reverse()) destroy();
  vi.useRealTimers();
});

describe('floating menu presentation lifecycle', () => {
  it('keeps presentation stable through disabled-state and keyboard updates until the native click finishes', () => {
    const { editor, target, controller, changed, execute, disable } = setup();
    const groups = controller.groups;
    const state = editor.state;
    target.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    editor.i18n.set({ locale: 'fr' });
    editor.i18n.set({ locale: 'de' });
    expect(editor.state).toBe(state);
    expect(editor.floatingMenuItems[0]?.label).toBe('First de');
    expect(controller.groups).toBe(groups);
    disable();
    editor.view.dispatch(editor.state.tr.setMeta('disabledProbe', true));
    expect(controller.isDisabled(controller.flatItems[0]!)).toBe(true);
    expect(changed).toHaveBeenCalled();
    controller.setFocusedIndex(1);
    expect(controller.focusedIndex).toBe(1);
    expect(controller.groups).toBe(groups);
    const clickedLabels: string[] = [];
    target.addEventListener('click', () => {
      clickedLabels.push(controller.flatItems[1]!.label);
      controller.execute(controller.flatItems[1]!);
    });
    target.dispatchEvent(new Event('pointerup', { bubbles: true }));
    expect(controller.groups).toBe(groups);
    target.click();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(clickedLabels).toEqual(['Second en']);
    vi.runOnlyPendingTimers();
    expect(controller.flatItems.map(item => item.label)).toEqual(['First de', 'Second de']);
  });

  it('applies locale changes immediately for keyboard use and preserves the focused item', () => {
    const { editor, controller } = setup();
    controller.setFocusedIndex(1);
    editor.i18n.set({ locale: 'fr' });
    expect(controller.focusedItem()?.label).toBe('Second fr');
    controller.prev();
    expect(controller.focusedItem()?.label).toBe('First fr');
  });

  it('retains immediate locale semantics for headless subscriptions without a presentation root', () => {
    const { editor, target, controller } = setup(false);
    target.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    editor.i18n.set({ locale: 'de' });
    expect(controller.flatItems[0]?.label).toBe('First de');
  });

  it.each(['pointerup', 'pointercancel'])('publishes the latest pending locale after an outside %s without a click', event => {
    const { editor, target, controller } = setup();
    target.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    editor.i18n.set({ locale: 'fr' });
    editor.i18n.set({ locale: 'de' });
    document.body.dispatchEvent(new Event(event, { bubbles: true }));
    expect(controller.flatItems[0]?.label).toBe('First en');
    vi.runOnlyPendingTimers();
    expect(controller.flatItems[0]?.label).toBe('First de');
  });

  it('retains a composing input and publishes presentation after composition finishes', () => {
    const { editor, root, controller } = setup();
    const input = document.createElement('input');
    input.value = 'Raw draft';
    root.appendChild(input);
    input.focus();
    input.dispatchEvent(new Event('compositionstart', { bubbles: true }));
    editor.i18n.set({ locale: 'de' });
    expect(controller.flatItems[0]?.label).toBe('First en');
    input.dispatchEvent(new Event('compositionend', { bubbles: true }));
    vi.runOnlyPendingTimers();
    expect(controller.flatItems[0]?.label).toBe('First de');
    expect(input.value).toBe('Raw draft');
    expect(document.activeElement).toBe(input);
  });

  it('cancels a pending presentation update when the controller is destroyed', () => {
    const { editor, target, controller, changed } = setup();
    target.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    editor.i18n.set({ locale: 'fr' });
    target.dispatchEvent(new Event('pointerup', { bubbles: true }));
    controller.destroy();
    changed.mockClear();
    vi.runOnlyPendingTimers();
    editor.i18n.set({ locale: 'de' });
    expect(changed).not.toHaveBeenCalled();
    expect(controller.groups).toEqual([]);
  });
});
