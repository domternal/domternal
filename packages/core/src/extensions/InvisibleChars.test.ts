/**
 * Tests for InvisibleChars extension
 */
import { describe, it, expect, afterEach } from 'vitest';
import { InvisibleChars, invisibleCharsPluginKey } from './InvisibleChars.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { HardBreak } from '../nodes/HardBreak.js';
import { Editor } from '../Editor.js';
import { DecorationSet } from '@domternal/pm/view';
import { TextSelection } from '@domternal/pm/state';
import type { ToolbarButton } from '../types/Toolbar.js';

interface InvisibleCharsPluginState { visible: boolean; decorations: DecorationSet }

describe('InvisibleChars', () => {
  describe('configuration', () => {
    it('has correct name', () => {
      expect(InvisibleChars.name).toBe('invisibleChars');
    });

    it('has default options', () => {
      expect(InvisibleChars.options).toEqual({
        visible: false,
        paragraph: true,
        hardBreak: true,
        space: true,
        nbsp: true,
        className: 'invisible-char',
      });
    });

    it('can configure visible', () => {
      const CustomInvisibleChars = InvisibleChars.configure({
        visible: true,
      });
      expect(CustomInvisibleChars.options.visible).toBe(true);
    });

    it('can configure paragraph', () => {
      const CustomInvisibleChars = InvisibleChars.configure({
        paragraph: false,
      });
      expect(CustomInvisibleChars.options.paragraph).toBe(false);
    });

    it('can configure hardBreak', () => {
      const CustomInvisibleChars = InvisibleChars.configure({
        hardBreak: false,
      });
      expect(CustomInvisibleChars.options.hardBreak).toBe(false);
    });

    it('can configure space', () => {
      const CustomInvisibleChars = InvisibleChars.configure({
        space: false,
      });
      expect(CustomInvisibleChars.options.space).toBe(false);
    });

    it('can configure nbsp', () => {
      const CustomInvisibleChars = InvisibleChars.configure({
        nbsp: false,
      });
      expect(CustomInvisibleChars.options.nbsp).toBe(false);
    });

    it('can configure className', () => {
      const CustomInvisibleChars = InvisibleChars.configure({
        className: 'custom-invisible',
      });
      expect(CustomInvisibleChars.options.className).toBe('custom-invisible');
    });
  });

  describe('addStorage', () => {
    it('provides toggle function', () => {
      const storage = InvisibleChars.config.addStorage?.call(InvisibleChars);
      expect(typeof storage?.toggle).toBe('function');
    });

    it('provides isVisible function', () => {
      const storage = InvisibleChars.config.addStorage?.call(InvisibleChars);
      expect(typeof storage?.isVisible).toBe('function');
    });
  });

  describe('addCommands', () => {
    it('provides toggleInvisibleChars command', () => {
      const commands = InvisibleChars.config.addCommands?.call(InvisibleChars);
      expect(commands).toHaveProperty('toggleInvisibleChars');
      expect(typeof commands?.['toggleInvisibleChars']).toBe('function');
    });

    it('provides showInvisibleChars command', () => {
      const commands = InvisibleChars.config.addCommands?.call(InvisibleChars);
      expect(commands).toHaveProperty('showInvisibleChars');
      expect(typeof commands?.['showInvisibleChars']).toBe('function');
    });

    it('provides hideInvisibleChars command', () => {
      const commands = InvisibleChars.config.addCommands?.call(InvisibleChars);
      expect(commands).toHaveProperty('hideInvisibleChars');
      expect(typeof commands?.['hideInvisibleChars']).toBe('function');
    });
  });

  describe('addToolbarItems', () => {
    it('provides toolbar button with isActiveFn', () => {
      const items = InvisibleChars.config.addToolbarItems?.call(InvisibleChars);
      expect(items).toHaveLength(1);
      const btn = items![0] as ToolbarButton;
      expect(btn.type).toBe('button');
      expect(btn.name).toBe('invisibleChars');
      expect(typeof btn.isActiveFn).toBe('function');
    });

    it('isActiveFn returns false when hidden', () => {
      const editor = new Editor({
        extensions: [Document, Text, Paragraph, InvisibleChars],
        content: '<p>Test</p>',
      });
      const items = InvisibleChars.config.addToolbarItems?.call(InvisibleChars);
      const btn = items![0] as ToolbarButton;
      expect(btn.isActiveFn!(editor)).toBe(false);
      editor.destroy();
    });

    it('isActiveFn returns true when visible', () => {
      const editor = new Editor({
        extensions: [Document, Text, Paragraph, InvisibleChars],
        content: '<p>Test</p>',
      });
      editor.commands.toggleInvisibleChars();
      const items = InvisibleChars.config.addToolbarItems?.call(InvisibleChars);
      const btn = items![0] as ToolbarButton;
      expect(btn.isActiveFn!(editor)).toBe(true);
      editor.destroy();
    });
  });

  describe('commands dispatch guard', () => {
    let editor: Editor | undefined;

    afterEach(() => {
      if (editor && !editor.isDestroyed) editor.destroy();
    });

    it('toggleInvisibleChars does not toggle on can() dry-run', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, InvisibleChars],
        content: '<p>Test</p>',
      });
      const storage = editor.storage['invisibleChars'] as typeof InvisibleChars.storage;
      expect(storage.isVisible()).toBe(false);

      // can() should not trigger side effects
      const canProxy = editor.can();
      canProxy.toggleInvisibleChars();

      expect(storage.isVisible()).toBe(false);
    });

    it('showInvisibleChars does not toggle on can() dry-run', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, InvisibleChars],
        content: '<p>Test</p>',
      });
      const storage = editor.storage['invisibleChars'] as typeof InvisibleChars.storage;

      const canProxy = editor.can();
      canProxy.showInvisibleChars();

      expect(storage.isVisible()).toBe(false);
    });
  });

  describe('addProseMirrorPlugins', () => {
    it('returns plugins array', () => {
      const plugins = InvisibleChars.config.addProseMirrorPlugins?.call(
        InvisibleChars
      );

      expect(Array.isArray(plugins)).toBe(true);
      expect(plugins?.length).toBeGreaterThan(0);
    });
  });

  describe('integration', () => {
    let editor: Editor | undefined;

    afterEach(() => {
      if (editor && !editor.isDestroyed) {
        editor.destroy();
      }
    });

    it('works with Editor', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, InvisibleChars],
        content: '<p>Test content</p>',
      });

      expect(editor.getText()).toContain('Test content');
    });

    it('starts hidden by default', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, InvisibleChars],
        content: '<p>Test content</p>',
      });

      const storage = editor.storage['invisibleChars'] as typeof InvisibleChars.storage;
      expect(storage.isVisible()).toBe(false);
    });

    it('can start visible when configured', () => {
      const VisibleInvisibleChars = InvisibleChars.configure({
        visible: true,
      });

      editor = new Editor({
        extensions: [Document, Text, Paragraph, VisibleInvisibleChars],
        content: '<p>Test content</p>',
      });

      const storage = editor.storage['invisibleChars'] as typeof InvisibleChars.storage;
      expect(storage.isVisible()).toBe(true);
    });

    describe('storage.toggle', () => {
      it('toggles visibility from false to true', () => {
        editor = new Editor({
          extensions: [Document, Text, Paragraph, InvisibleChars],
          content: '<p>Test</p>',
        });

        const storage = editor.storage['invisibleChars'] as typeof InvisibleChars.storage;
        expect(storage.isVisible()).toBe(false);

        storage.toggle();
        expect(storage.isVisible()).toBe(true);
      });

      it('toggles visibility from true to false', () => {
        const VisibleInvisibleChars = InvisibleChars.configure({
          visible: true,
        });

        editor = new Editor({
          extensions: [Document, Text, Paragraph, VisibleInvisibleChars],
          content: '<p>Test</p>',
        });

        const storage = editor.storage['invisibleChars'] as typeof InvisibleChars.storage;
        expect(storage.isVisible()).toBe(true);

        storage.toggle();
        expect(storage.isVisible()).toBe(false);
      });
    });

    describe('toggleInvisibleChars command', () => {
      it('toggles visibility', () => {
        editor = new Editor({
          extensions: [Document, Text, Paragraph, InvisibleChars],
          content: '<p>Test</p>',
        });

        const storage = editor.storage['invisibleChars'] as typeof InvisibleChars.storage;
        expect(storage.isVisible()).toBe(false);

        editor.commands.toggleInvisibleChars();

        expect(storage.isVisible()).toBe(true);
      });
    });

    describe('showInvisibleChars command', () => {
      it('shows invisible chars when hidden', () => {
        editor = new Editor({
          extensions: [Document, Text, Paragraph, InvisibleChars],
          content: '<p>Test</p>',
        });

        const storage = editor.storage['invisibleChars'] as typeof InvisibleChars.storage;
        expect(storage.isVisible()).toBe(false);

        editor.commands.showInvisibleChars();

        expect(storage.isVisible()).toBe(true);
      });

      it('keeps visible when already visible', () => {
        const VisibleInvisibleChars = InvisibleChars.configure({
          visible: true,
        });

        editor = new Editor({
          extensions: [Document, Text, Paragraph, VisibleInvisibleChars],
          content: '<p>Test</p>',
        });

        const storage = editor.storage['invisibleChars'] as typeof InvisibleChars.storage;
        expect(storage.isVisible()).toBe(true);

        editor.commands.showInvisibleChars();

        expect(storage.isVisible()).toBe(true);
      });
    });

    describe('hideInvisibleChars command', () => {
      it('hides invisible chars when visible', () => {
        const VisibleInvisibleChars = InvisibleChars.configure({
          visible: true,
        });

        editor = new Editor({
          extensions: [Document, Text, Paragraph, VisibleInvisibleChars],
          content: '<p>Test</p>',
        });

        const storage = editor.storage['invisibleChars'] as typeof InvisibleChars.storage;
        expect(storage.isVisible()).toBe(true);

        editor.commands.hideInvisibleChars();

        expect(storage.isVisible()).toBe(false);
      });

      it('keeps hidden when already hidden', () => {
        editor = new Editor({
          extensions: [Document, Text, Paragraph, InvisibleChars],
          content: '<p>Test</p>',
        });

        const storage = editor.storage['invisibleChars'] as typeof InvisibleChars.storage;
        expect(storage.isVisible()).toBe(false);

        editor.commands.hideInvisibleChars();

        expect(storage.isVisible()).toBe(false);
      });
    });

    describe('plugin state', () => {
      it('tracks visibility in plugin state', () => {
        editor = new Editor({
          extensions: [Document, Text, Paragraph, InvisibleChars],
          content: '<p>Test</p>',
        });

        const pluginState = invisibleCharsPluginKey.getState(editor.state) as
          | { visible: boolean }
          | undefined;
        expect(pluginState?.visible).toBe(false);

        editor.commands.toggleInvisibleChars();

        const newPluginState = invisibleCharsPluginKey.getState(editor.state) as
          | { visible: boolean }
          | undefined;
        expect(newPluginState?.visible).toBe(true);
      });

      it('preserves state on unrelated transaction', () => {
        editor = new Editor({
          extensions: [Document, Text, Paragraph, InvisibleChars],
          content: '<p>Test</p>',
        });

        // Toggle to true
        editor.commands.toggleInvisibleChars();
        expect(
          (invisibleCharsPluginKey.getState(editor.state) as { visible: boolean }).visible
        ).toBe(true);

        // Dispatch an unrelated transaction (e.g., inserting text)
        editor.view.dispatch(editor.state.tr.insertText('x', 1));

        // State should remain true (apply returns value unchanged)
        expect(
          (invisibleCharsPluginKey.getState(editor.state) as { visible: boolean }).visible
        ).toBe(true);
      });
    });

    describe('with hardBreak', () => {
      it('works with hard breaks in content', () => {
        editor = new Editor({
          extensions: [Document, Text, Paragraph, HardBreak, InvisibleChars],
          content: '<p>Line 1<br>Line 2</p>',
        });

        expect(editor.getText()).toContain('Line 1');
        expect(editor.getText()).toContain('Line 2');
      });

      it('creates decorations for hardBreak when visible', () => {
        const VisibleInvisibleChars = InvisibleChars.configure({
          visible: true,
        });

        editor = new Editor({
          extensions: [Document, Text, Paragraph, HardBreak, VisibleInvisibleChars],
          content: '<p>Line 1<br>Line 2</p>',
        });

        // Plugin should create decorations (hardBreak + paragraph + spaces)
        const pluginState = invisibleCharsPluginKey.getState(editor.state) as { visible: boolean };
        expect(pluginState.visible).toBe(true);

        // Check that the view has the invisible char decorations rendered
        const html = editor.view.dom.innerHTML;
        expect(html).toContain('invisible-char');
      });
    });

    describe('with nbsp content', () => {
      it('creates decorations for non-breaking spaces when visible', () => {
        const VisibleInvisibleChars = InvisibleChars.configure({
          visible: true,
        });

        editor = new Editor({
          extensions: [Document, Text, Paragraph, VisibleInvisibleChars],
          content: '<p>Hello\u00A0world</p>',
        });

        const html = editor.view.dom.innerHTML;
        expect(html).toContain('invisible-char');
      });
    });

    describe('plugin state caching', () => {
      it('returns DecorationSet.empty when hidden', () => {
        editor = new Editor({
          extensions: [Document, Text, Paragraph, InvisibleChars],
          content: '<p>Hello world</p>',
        });

        const ps = invisibleCharsPluginKey.getState(editor.state) as InvisibleCharsPluginState;
        expect(ps.visible).toBe(false);
        expect(ps.decorations).toBe(DecorationSet.empty);
      });

      it('returns non-empty DecorationSet when visible', () => {
        editor = new Editor({
          extensions: [Document, Text, Paragraph, InvisibleChars.configure({ visible: true })],
          content: '<p>Hello world</p>',
        });

        const ps = invisibleCharsPluginKey.getState(editor.state) as InvisibleCharsPluginState;
        expect(ps.visible).toBe(true);
        expect(ps.decorations).not.toBe(DecorationSet.empty);
        // "Hello world" has 1 space + 1 paragraph = at least 2 decorations
        expect(ps.decorations.find().length).toBeGreaterThanOrEqual(2);
      });

      it('reuses cached state on selection-only transactions', () => {
        editor = new Editor({
          extensions: [Document, Text, Paragraph, InvisibleChars.configure({ visible: true })],
          content: '<p>Hello world</p>',
        });

        const ps1 = invisibleCharsPluginKey.getState(editor.state) as InvisibleCharsPluginState;

        // Move cursor — no doc change
        editor.view.dispatch(
          editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 3)),
        );

        const ps2 = invisibleCharsPluginKey.getState(editor.state) as InvisibleCharsPluginState;
        // Same object reference — cached, not rebuilt
        expect(ps2).toBe(ps1);
      });

      it('rebuilds decorations on doc change when visible', () => {
        editor = new Editor({
          extensions: [Document, Text, Paragraph, InvisibleChars.configure({ visible: true })],
          content: '<p>Hi</p>',
        });

        const ps1 = invisibleCharsPluginKey.getState(editor.state) as InvisibleCharsPluginState;
        const count1 = ps1.decorations.find().length;

        // Insert text — doc changes
        editor.view.dispatch(editor.state.tr.insertText(' there', 3));

        const ps2 = invisibleCharsPluginKey.getState(editor.state) as InvisibleCharsPluginState;
        // More decorations now (added a space)
        expect(ps2.decorations.find().length).toBeGreaterThan(count1);
        expect(ps2).not.toBe(ps1);
      });

      it('transitions from hidden to empty on toggle off', () => {
        editor = new Editor({
          extensions: [Document, Text, Paragraph, InvisibleChars.configure({ visible: true })],
          content: '<p>Hello world</p>',
        });

        const ps1 = invisibleCharsPluginKey.getState(editor.state) as InvisibleCharsPluginState;
        expect(ps1.decorations.find().length).toBeGreaterThan(0);

        editor.commands.toggleInvisibleChars();

        const ps2 = invisibleCharsPluginKey.getState(editor.state) as InvisibleCharsPluginState;
        expect(ps2.visible).toBe(false);
        expect(ps2.decorations).toBe(DecorationSet.empty);
      });

      it('does not rebuild when already hidden and receiving unrelated transaction', () => {
        editor = new Editor({
          extensions: [Document, Text, Paragraph, InvisibleChars],
          content: '<p>Hello</p>',
        });

        const ps1 = invisibleCharsPluginKey.getState(editor.state) as InvisibleCharsPluginState;
        expect(ps1.visible).toBe(false);

        // Non-doc transaction
        editor.view.dispatch(editor.state.tr);

        const ps2 = invisibleCharsPluginKey.getState(editor.state) as InvisibleCharsPluginState;
        // Same reference — nothing rebuilt
        expect(ps2).toBe(ps1);
      });
    });

    describe('selective character types', () => {
      it('only creates paragraph decorations when spaces disabled', () => {
        editor = new Editor({
          extensions: [Document, Text, Paragraph, InvisibleChars.configure({
            visible: true,
            space: false,
            nbsp: false,
            hardBreak: false,
            paragraph: true,
          })],
          content: '<p>Hello world</p>',
        });

        const ps = invisibleCharsPluginKey.getState(editor.state) as InvisibleCharsPluginState;
        // Only 1 paragraph widget, no space inline decorations
        expect(ps.decorations.find().length).toBe(1);
      });

      it('only creates space decorations when paragraph disabled', () => {
        editor = new Editor({
          extensions: [Document, Text, Paragraph, InvisibleChars.configure({
            visible: true,
            space: true,
            nbsp: false,
            hardBreak: false,
            paragraph: false,
          })],
          content: '<p>a b c</p>',
        });

        const ps = invisibleCharsPluginKey.getState(editor.state) as InvisibleCharsPluginState;
        // "a b c" has 2 spaces
        expect(ps.decorations.find().length).toBe(2);
      });

      it('creates no decorations when all types disabled', () => {
        editor = new Editor({
          extensions: [Document, Text, Paragraph, InvisibleChars.configure({
            visible: true,
            space: false,
            nbsp: false,
            hardBreak: false,
            paragraph: false,
          })],
          content: '<p>Hello world</p>',
        });

        const ps = invisibleCharsPluginKey.getState(editor.state) as InvisibleCharsPluginState;
        expect(ps.decorations.find().length).toBe(0);
      });

      it('creates hardBreak decorations separately', () => {
        editor = new Editor({
          extensions: [Document, Text, Paragraph, HardBreak, InvisibleChars.configure({
            visible: true,
            space: false,
            nbsp: false,
            hardBreak: true,
            paragraph: false,
          })],
          content: '<p>A<br>B</p>',
        });

        const ps = invisibleCharsPluginKey.getState(editor.state) as InvisibleCharsPluginState;
        // 1 hardBreak widget
        expect(ps.decorations.find().length).toBe(1);
      });

      it('creates nbsp decorations separately', () => {
        editor = new Editor({
          extensions: [Document, Text, Paragraph, InvisibleChars.configure({
            visible: true,
            space: false,
            nbsp: true,
            hardBreak: false,
            paragraph: false,
          })],
          content: '<p>A\u00A0B\u00A0C</p>',
        });

        const ps = invisibleCharsPluginKey.getState(editor.state) as InvisibleCharsPluginState;
        // 2 non-breaking spaces
        expect(ps.decorations.find().length).toBe(2);
      });
    });

    describe('decoration class names', () => {
      it('uses default className for space decorations', () => {
        editor = new Editor({
          extensions: [Document, Text, Paragraph, InvisibleChars.configure({ visible: true })],
          content: '<p>A B</p>',
        });

        const html = editor.view.dom.innerHTML;
        expect(html).toContain('invisible-char--space');
      });

      it('uses custom className for decorations', () => {
        editor = new Editor({
          extensions: [Document, Text, Paragraph, InvisibleChars.configure({
            visible: true,
            className: 'my-ic',
          })],
          content: '<p>A B</p>',
        });

        const html = editor.view.dom.innerHTML;
        expect(html).toContain('my-ic--space');
      });

      it('renders paragraph marker widget', () => {
        editor = new Editor({
          extensions: [Document, Text, Paragraph, InvisibleChars.configure({ visible: true })],
          content: '<p>Test</p>',
        });

        const html = editor.view.dom.innerHTML;
        expect(html).toContain('invisible-char--paragraph');
        // Paragraph marker is ¶
        expect(html).toContain('¶');
      });

      it('renders hardBreak marker widget', () => {
        editor = new Editor({
          extensions: [Document, Text, Paragraph, HardBreak, InvisibleChars.configure({ visible: true })],
          content: '<p>A<br>B</p>',
        });

        const html = editor.view.dom.innerHTML;
        expect(html).toContain('invisible-char--hardBreak');
        // HardBreak marker is ↵
        expect(html).toContain('↵');
      });
    });

    describe('keyboard shortcuts', () => {
      it('registers Mod-Shift-i shortcut', () => {
        const shortcuts = InvisibleChars.config.addKeyboardShortcuts?.call(InvisibleChars);
        expect(shortcuts).toHaveProperty('Mod-Shift-i');
      });

      it('shortcut returns false when no editor', () => {
        const shortcuts = InvisibleChars.config.addKeyboardShortcuts?.call({
          ...InvisibleChars,
          editor: undefined,
        } as unknown as typeof InvisibleChars);
        expect((shortcuts!['Mod-Shift-i'] as () => boolean)()).toBe(false);
      });
    });

    describe('multiple toggle cycles', () => {
      it('toggles on and off repeatedly with correct decoration state', () => {
        editor = new Editor({
          extensions: [Document, Text, Paragraph, InvisibleChars],
          content: '<p>A B</p>',
        });

        const storage = editor.storage['invisibleChars'] as typeof InvisibleChars.storage;

        // Off → On
        storage.toggle();
        let ps = invisibleCharsPluginKey.getState(editor.state) as InvisibleCharsPluginState;
        expect(ps.visible).toBe(true);
        expect(ps.decorations.find().length).toBeGreaterThan(0);

        // On → Off
        storage.toggle();
        ps = invisibleCharsPluginKey.getState(editor.state) as InvisibleCharsPluginState;
        expect(ps.visible).toBe(false);
        expect(ps.decorations).toBe(DecorationSet.empty);

        // Off → On again
        storage.toggle();
        ps = invisibleCharsPluginKey.getState(editor.state) as InvisibleCharsPluginState;
        expect(ps.visible).toBe(true);
        expect(ps.decorations.find().length).toBeGreaterThan(0);
      });
    });
  });
});
