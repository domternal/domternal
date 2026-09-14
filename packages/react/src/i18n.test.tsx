import { act, StrictMode, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Editor, Extension, Document, Paragraph, Text, type I18nOptions } from '@domternal/core';
import { Domternal } from './Domternal.js';
import { DomternalEditor } from './DomternalEditor.js';
import { EditorContent } from './EditorContent.js';
import { useEditor } from './useEditor.js';
import { DomternalToolbar } from './toolbar/DomternalToolbar.js';
import { DomternalBubbleMenu } from './bubble-menu/DomternalBubbleMenu.js';
import { DomternalFloatingMenu } from './DomternalFloatingMenu.js';

let container: HTMLDivElement;
let root: Root;
let editors: Editor[];
let frames: Map<number, FrameRequestCallback>;
let frameId: number;
const onCreate = (editor: Editor): void => { editors.push(editor); };

async function update(action: () => void): Promise<void> {
  await act(async () => { action(); await Promise.resolve(); });
  for (let i = 0; i < 5 && frames.size; i++) {
    await act(async () => {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach(callback => { callback(performance.now()); });
      await Promise.resolve();
    });
  }
}

function liveEditor(): Editor {
  const editor = [...editors].reverse().find(value => !value.isDestroyed);
  if (!editor) throw new Error('Expected a live editor.');
  return editor;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  editors = [];
  frames = new Map();
  frameId = 0;
  vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(callback => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id); });
});

afterEach(async () => {
  await update(() => { root.unmount(); });
  editors.forEach(editor => { editor.destroy(); });
  container.remove();
  vi.restoreAllMocks();
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
});

type Path = 'hook' | 'standalone' | 'compound' | 'all-in-one';
function Host({ path, settings, immediate }: { path: Path; settings?: I18nOptions | undefined; immediate: boolean }): ReactNode {
  if (path === 'compound') return <Domternal i18n={settings} immediatelyRender={immediate} content="<p>Hello</p>" onCreate={onCreate}><Domternal.Content /></Domternal>;
  if (path === 'all-in-one') return <DomternalEditor i18n={settings} immediatelyRender={immediate} content="<p>Hello</p>" onCreate={onCreate} />;
  return <HookHost settings={settings} immediate={immediate} standalone={path === 'standalone'} />;
}
function HookHost({ settings, immediate, standalone }: { settings?: I18nOptions | undefined; immediate: boolean; standalone: boolean }): ReactNode {
  const { editor, editorRef } = useEditor({ i18n: settings, immediatelyRender: immediate, content: '<p>Hello</p>', onCreate });
  return standalone ? <EditorContent editor={editor} /> : <div ref={editorRef} />;
}

const LocalizedControls = Extension.create({
  name: 'localizedTestControls',
  addToolbarItems() {
    const locale = this.editor?.i18n?.getSnapshot().locale ?? 'en';
    return [{ type: 'dropdown', name: 'localized', label: `Menu ${locale}`, labelLanguage: locale,
      icon: 'textB', group: 'stable-toolbar-group', groupLabel: `Toolbar group ${locale}`, groupLabelLanguage: locale, dynamicLabel: true, dynamicLabelFallback: `<b>${locale}</b>`,
      items: [{ type: 'button', name: 'localized-child', icon: 'textB', label: `<b>${locale}</b>`,
        labelLanguage: locale, command: 'testAction', emitEvent: 'testActionOpen' }] }];
  },
  addFloatingMenuItems() {
    const locale = this.editor?.i18n?.getSnapshot().locale ?? 'en';
    return [{ name: 'localized-block', label: `<b>${locale}</b>`, labelLanguage: locale,
      description: `Description ${locale}`, descriptionLanguage: locale,
      group: 'stable-group', groupLabel: `Group ${locale}`, groupLabelLanguage: locale, command: () => undefined }];
  },
});
const bubbleItems = ['localized'];

describe('React i18n integration', () => {
  it.each((['hook', 'standalone', 'compound', 'all-in-one'] as const).flatMap(path => [false, true].map(immediate => ({ path, immediate }))))(
    'replaces and removes settings without recreating $path, immediate=$immediate', async ({ path, immediate }) => {
      const render = (settings?: I18nOptions): void => { root.render(<StrictMode><Host path={path} immediate={immediate} settings={settings} /></StrictMode>); };
      await update(() => { render({ locale: 'fr', timeZone: 'UTC' }); });
      const editor = liveEditor();
      const created = editors.length;
      const state = editor.state;
      const transaction = vi.fn();
      editor.on('transaction', transaction);
      const snapshot = editor.i18n.getSnapshot();
      await update(() => { render({ locale: 'fr', timeZone: 'UTC' }); });
      expect(editor.i18n.getSnapshot()).toBe(snapshot);
      await update(() => { render({ locale: 'de' }); });
      expect(editor.i18n.getSnapshot().locale).toBe('de');
      await update(() => { render(); });
      expect(editor.i18n.getSnapshot().locale).toBe('en');
      editor.i18n.set({ locale: 'hr' });
      await update(() => { render(); });
      expect(editor.i18n.getSnapshot().locale).toBe('hr');
      expect(liveEditor()).toBe(editor);
      expect(editors).toHaveLength(created);
      expect(editor.state).toBe(state);
      expect(transaction).not.toHaveBeenCalled();
      await update(() => { root.render(null); });
      expect(editors.every(value => value.isDestroyed)).toBe(true);
      expect(frames.size).toBe(0);
    },
  );

  it('leaves imperative settings intact when the prop has always been absent', async () => {
    await update(() => { root.render(<Host path="hook" immediate={false} />); });
    const editor = liveEditor();
    editor.i18n.set({ locale: 'hr' });
    await update(() => { root.render(<Host path="hook" immediate={false} />); });
    expect(liveEditor()).toBe(editor);
    expect(editor.i18n.getSnapshot().locale).toBe('hr');
  });

  it('refreshes open menus in place, renders literal labels, and releases subscriptions', async () => {
    const editor = new Editor({ extensions: [Document, Paragraph, Text, LocalizedControls], content: '<p>Hello</p>' });
    editors.push(editor);
    const subscribe = editor.i18n.subscribe.bind(editor.i18n);
    let subscriptions = 0;
    vi.spyOn(editor.i18n, 'subscribe').mockImplementation(listener => {
      subscriptions++;
      const unsubscribe = subscribe(listener);
      return () => { subscriptions--; unsubscribe(); };
    });
    await update(() => { root.render(<><DomternalToolbar editor={editor} /><DomternalBubbleMenu editor={editor} items={bubbleItems} /><DomternalFloatingMenu editor={editor} /></>); });
    const trigger = container.querySelector<HTMLButtonElement>('.dm-toolbar [data-dropdown="localized"]');
    const bubble = container.querySelector<HTMLButtonElement>('.dm-bubble-menu [data-dropdown="localized"]');
    if (!trigger || !bubble) throw new Error('Expected both menu triggers.');
    await update(() => { trigger.click(); bubble.click(); });
    const panel = container.querySelector('.dm-toolbar .dm-toolbar-dropdown-panel');
    const bubblePanel = container.querySelector('.dm-bubble-menu .dm-toolbar-dropdown-panel');
    await update(() => {
      container.querySelector('.dm-floating-menu')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    trigger.focus();
    const state = editor.state;
    const plugins = editor.state.plugins;
    const activeSubscriptions = subscriptions;
    await update(() => { editor.i18n.set({ locale: 'fr', messages: {
      'core.toolbar.label': 'Outils', 'core.bubbleMenu.label': 'Sélection', 'core.floatingMenu.label': 'Insérer',
    } }); });
    expect(container.querySelector('.dm-toolbar')?.getAttribute('aria-label')).toBe('Outils');
    expect(container.querySelector('.dm-toolbar')?.getAttribute('lang')).toBe('fr');
    expect(container.querySelector('.dm-toolbar-group')?.getAttribute('aria-label')).toBe('Toolbar group fr');
    expect(container.querySelector('.dm-toolbar-group')?.getAttribute('lang')).toBe('fr');
    expect(container.querySelector('.dm-bubble-menu')?.getAttribute('aria-label')).toBe('Sélection');
    expect(container.querySelector('.dm-floating-menu')?.getAttribute('aria-label')).toBe('Insérer');
    expect(trigger.getAttribute('aria-label')).toBe('Menu fr');
    expect(trigger.lang).toBe('fr');
    expect(trigger.textContent).toBe('<b>fr</b>');
    expect(container.querySelector('.dm-toolbar .dm-toolbar-dropdown-panel')).toBe(panel);
    expect(container.querySelector('.dm-bubble-menu .dm-toolbar-dropdown-panel')).toBe(bubblePanel);
    expect(panel?.textContent.trim()).toBe('<b>fr</b>');
    expect(bubblePanel?.textContent.trim()).toBe('<b>fr</b>');
    expect(container.querySelector('.dm-floating-menu-group-label')?.textContent).toBe('Group fr');
    expect(container.querySelector('.dm-floating-menu-item-label')?.getAttribute('lang')).toBe('fr');
    expect(container.querySelector('b')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(editor.state).toBe(state);
    expect(editor.state.plugins).toBe(plugins);
    expect(subscriptions).toBe(activeSubscriptions);
    await update(() => { root.render(null); });
    expect(subscriptions).toBe(0);
    expect(editor.isDestroyed).toBe(false);
    expect(frames.size).toBe(0);
    await update(() => { editor.i18n.refresh(); });
    expect(frames.size).toBe(0);
  });

  it('localizes custom floating-menu chrome without replacing consumer content', async () => {
    const editor = new Editor({ extensions: [Document, Paragraph, Text], content: '<p>Hello</p>' });
    editors.push(editor);
    await update(() => { root.render(<DomternalFloatingMenu editor={editor}><button type="button">Custom action</button></DomternalFloatingMenu>); });
    const menu = container.querySelector('.dm-floating-menu');
    const button = menu?.querySelector('button');
    button?.focus();
    const state = editor.state;
    let label = 'Insérer';
    await update(() => { editor.i18n.set({ locale: 'fr', resolve: id => id === 'core.floatingMenu.label' ? label : undefined }); });
    expect(menu?.getAttribute('aria-label')).toBe('Insérer');
    label = 'Ajouter';
    await update(() => { editor.i18n.refresh(); });
    expect(menu?.getAttribute('aria-label')).toBe('Ajouter');
    expect(menu?.getAttribute('lang')).toBe('fr');
    expect(menu?.querySelector('button')).toBe(button);
    expect(button?.textContent).toBe('Custom action');
    expect(document.activeElement).toBe(button);
    expect(editor.state).toBe(state);
    await update(() => { root.render(null); });
    await update(() => { editor.i18n.refresh(); });
    expect(frames.size).toBe(0);
  });


  it('keeps floating group accessible names unique across independent editors', async () => {
    const first = new Editor({ extensions: [Document, Paragraph, Text, LocalizedControls], content: '<p>First</p>' });
    const second = new Editor({ extensions: [Document, Paragraph, Text, LocalizedControls], content: '<p>Second</p>', i18n: { locale: 'fr' } });
    editors.push(first, second);
    await update(() => { root.render(<><DomternalFloatingMenu editor={first} /><DomternalFloatingMenu editor={second} /></>); });
    const groups = Array.from(container.querySelectorAll('.dm-floating-menu-group'));
    const ids = groups.map(group => group.getAttribute('aria-labelledby'));
    expect(new Set(ids).size).toBe(2);
    expect(ids.map(id => document.getElementById(id ?? '')?.textContent)).toEqual(['Group en', 'Group fr']);
    await update(() => { second.i18n.set({ locale: 'de' }); });
    expect(groups.map(group => group.getAttribute('aria-labelledby'))).toEqual(ids);
    expect(ids.map(id => document.getElementById(id ?? '')?.textContent)).toEqual(['Group en', 'Group de']);
  });

});
