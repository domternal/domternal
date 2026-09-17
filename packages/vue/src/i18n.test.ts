import { createApp, defineComponent, h, nextTick, shallowRef, type App, type Component, type ShallowRef } from 'vue';
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
let app: App | undefined;
let editors: Editor[];
let frames: Map<number, FrameRequestCallback>;
let frameId: number;
const onCreate = (editor: Editor): void => { editors.push(editor); };

async function update(action: () => void): Promise<void> {
  action();
  await nextTick();
  for (let i = 0; i < 5 && frames.size; i++) {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(callback => { callback(performance.now()); });
    await nextTick();
  }
}
function liveEditor(): Editor {
  const editor = editors.find(value => !value.isDestroyed);
  if (!editor) throw new Error('Expected a live editor.');
  return editor;
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  editors = [];
  frames = new Map();
  frameId = 0;
  vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(callback => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id); });
});
afterEach(() => {
  app?.unmount();
  app = undefined;
  editors.forEach(editor => { editor.destroy(); });
  container.remove();
  vi.restoreAllMocks();
});

type Path = 'hook' | 'standalone' | 'compound' | 'all-in-one';
function host(path: Path, settings: ShallowRef<I18nOptions | undefined>, immediate: boolean): Component {
  return defineComponent({
    setup() {
      if (path === 'compound' || path === 'all-in-one') {
        return () => {
          const props = {
            ...(settings.value !== undefined ? { i18n: settings.value } : {}),
            immediatelyRender: immediate, content: '<p>Hello</p>', onCreate,
          };
          return path === 'compound'
            ? h(Domternal, props, { default: () => h(Domternal.Content) })
            : h(DomternalEditor, props);
        };
      }
      const { editor, editorRef } = useEditor({
        get i18n() { return settings.value; },
        immediatelyRender: immediate, content: '<p>Hello</p>', onCreate,
      });
      return () => path === 'standalone'
        ? h(EditorContent, { editor: editor.value })
        : h('div', { ref: editorRef });
    },
  });
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

const CallerControls = Extension.create({
  name: 'callerLanguageControls',
  addToolbarItems() {
    return [
      { type: 'button', name: 'caller-button', label: 'Caller button', icon: 'bold', group: 'caller',
        groupLabel: 'Caller group', command: 'testAction', emitEvent: 'testActionOpen' },
      { type: 'dropdown', name: 'dynamic-caller', label: 'Menu français', labelLanguage: 'fr', icon: 'bold', group: 'caller',
        dynamicLabel: true, items: [{ type: 'button', name: 'active-caller', label: 'Active caller', icon: 'bold', command: 'testAction', isActive: 'paragraph' }] },
      { type: 'dropdown', name: 'caller-dropdown', label: 'Caller dropdown', icon: 'bold', group: 'caller',
        groupLabel: 'Caller group', items: [
          { type: 'button', name: 'caller-child', label: 'Caller child', icon: 'bold', command: 'testAction', emitEvent: 'testActionOpen' },
          { type: 'button', name: 'known-child', label: 'Known child', labelLanguage: 'en', icon: 'bold', command: 'testAction', emitEvent: 'testActionOpen' },
        ] },
    ];
  },
  addFloatingMenuItems() {
    return [{ name: 'caller-block', label: 'Caller block', description: 'Caller description',
      group: 'caller', groupLabel: 'Caller blocks', command: () => undefined }];
  },
});


describe('Vue i18n integration', () => {
  it('keeps unknown caller label language independent of translated menu chrome', async () => {
    const editor = new Editor({ extensions: [Document, Paragraph, Text, CallerControls], content: '<p>Hello</p>' });
    editors.push(editor);
    app = createApp({ render: () => [h(DomternalToolbar, { editor }),
      h(DomternalBubbleMenu, { editor, items: ['caller-button', 'caller-dropdown'] }), h(DomternalFloatingMenu, { editor })] });
    await update(() => { app?.mount(container); });
    await update(() => {
      for (const trigger of Array.from(container.querySelectorAll<HTMLButtonElement>('[data-dropdown="caller-dropdown"]'))) trigger.click();
    });
    await update(() => { editor.i18n.set({ locale: 'hr', messages: {
      'core.toolbar.label': 'Alati', 'core.bubbleMenu.label': 'Oblikovanje', 'core.floatingMenu.label': 'Umetanje',
    } }); });
    for (const selector of ['[aria-label="Caller button"]', '[aria-label="Caller dropdown"]',
      '[aria-label="Caller child"]', '.dm-toolbar-group', '.dm-floating-menu-group-label',
      '.dm-floating-menu-item-label', '.dm-floating-menu-item-description']) {
      const labels = container.querySelectorAll(selector);
      expect(labels.length, selector).toBeGreaterThan(0);
      for (const label of Array.from(labels)) expect(label.getAttribute('lang'), selector).toBe('');
    }
    for (const label of Array.from(container.querySelectorAll('[aria-label="Known child"]'))) expect(label.getAttribute('lang')).toBe('en');
    expect(container.querySelector('[data-dropdown="dynamic-caller"]')?.getAttribute('lang')).toBe('fr');
    expect(container.querySelector('[data-dropdown="dynamic-caller"] .dm-toolbar-trigger-label')?.textContent).toBe('Active caller');
    expect(container.querySelector('[data-dropdown="dynamic-caller"] .dm-toolbar-trigger-label')?.getAttribute('lang')).toBe('');
    for (const selector of ['.dm-toolbar', '.dm-bubble-menu', '.dm-floating-menu']) {
      expect(container.querySelector(selector)?.getAttribute('lang')).toBe('hr');
    }
  });

  it.each((['hook', 'standalone', 'compound', 'all-in-one'] as const).flatMap(path => [false, true].map(immediate => ({ path, immediate }))))(
    'replaces and removes settings without recreating $path, immediate=$immediate', async ({ path, immediate }) => {
      const settings = shallowRef<I18nOptions>();
      settings.value = { locale: 'fr', timeZone: 'UTC' };
      app = createApp(host(path, settings, immediate));
      await update(() => { app?.mount(container); });
      const editor = liveEditor();
      const state = editor.state;
      const transaction = vi.fn();
      editor.on('transaction', transaction);
      const snapshot = editor.i18n.getSnapshot();
      await update(() => { settings.value = { locale: 'fr', timeZone: 'UTC' }; });
      expect(editor.i18n.getSnapshot()).toBe(snapshot);
      await update(() => { settings.value = { locale: 'de' }; });
      expect(editor.i18n.getSnapshot().locale).toBe('de');
      await update(() => { settings.value = undefined; });
      expect(editor.i18n.getSnapshot().locale).toBe('en');
      editor.i18n.set({ locale: 'hr' });
      await update(() => { settings.value = undefined; });
      expect(editor.i18n.getSnapshot().locale).toBe('hr');
      expect(liveEditor()).toBe(editor);
      expect(editors).toHaveLength(1);
      expect(editor.state).toBe(state);
      expect(transaction).not.toHaveBeenCalled();
      app.unmount();
      app = undefined;
      expect(editor.isDestroyed).toBe(true);
      expect(frames.size).toBe(0);
    },
  );

  it('leaves imperative settings intact when the prop has always been absent', async () => {
    const settings = shallowRef<I18nOptions>();
    app = createApp(host('hook', settings, false));
    await update(() => { app?.mount(container); });
    const editor = liveEditor();
    editor.i18n.set({ locale: 'hr' });
    await update(() => { settings.value = undefined; });
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
    const visible = shallowRef(true);
    app = createApp(defineComponent({
      setup: () => () => visible.value ? [
        h(DomternalToolbar, { editor }),
        h(DomternalBubbleMenu, { editor, items: bubbleItems }),
        h(DomternalFloatingMenu, { editor }),
      ] : [],
    }));
    await update(() => { app?.mount(container); });
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
    await update(() => { visible.value = false; });
    expect(subscriptions).toBe(0);
    expect(editor.isDestroyed).toBe(false);
    expect(frames.size).toBe(0);
    await update(() => { editor.i18n.refresh(); });
    expect(frames.size).toBe(0);
  });

  it('localizes custom floating-menu chrome without replacing consumer content', async () => {
    const editor = new Editor({ extensions: [Document, Paragraph, Text], content: '<p>Hello</p>' });
    editors.push(editor);
    const visible = shallowRef(true);
    app = createApp(defineComponent({
      setup: () => () => visible.value
        ? h(DomternalFloatingMenu, { editor }, { default: () => h('button', { type: 'button' }, 'Custom action') })
        : null,
    }));
    await update(() => { app?.mount(container); });
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
    await update(() => { visible.value = false; });
    await update(() => { editor.i18n.refresh(); });
    expect(frames.size).toBe(0);
  });


  it('keeps floating group accessible names unique across independent editors', async () => {
    const first = new Editor({ extensions: [Document, Paragraph, Text, LocalizedControls], content: '<p>First</p>' });
    const second = new Editor({ extensions: [Document, Paragraph, Text, LocalizedControls], content: '<p>Second</p>', i18n: { locale: 'fr' } });
    editors.push(first, second);
    app = createApp(defineComponent({
      setup: () => () => [h(DomternalFloatingMenu, { editor: first }), h(DomternalFloatingMenu, { editor: second })],
    }));
    await update(() => { app?.mount(container); });
    const groups = Array.from(container.querySelectorAll('.dm-floating-menu-group'));
    const ids = groups.map(group => group.getAttribute('aria-labelledby'));
    expect(new Set(ids).size).toBe(2);
    expect(ids.map(id => document.getElementById(id ?? '')?.textContent)).toEqual(['Group en', 'Group fr']);
    await update(() => { second.i18n.set({ locale: 'de' }); });
    expect(groups.map(group => group.getAttribute('aria-labelledby'))).toEqual(ids);
    expect(ids.map(id => document.getElementById(id ?? '')?.textContent)).toEqual(['Group en', 'Group de']);
  });

});
