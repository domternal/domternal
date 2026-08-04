import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from './Editor.js';
import { Document } from './nodes/Document.js';
import { Text } from './nodes/Text.js';
import { Paragraph } from './nodes/Paragraph.js';

/**
 * Editor.preset resolution and the dm-notion-mode painting that goes with
 * it. The option is the recommended way to declare Notion mode; the theme
 * class is the pre-option signal the getter keeps honoring.
 */
describe('Editor preset', () => {
  let editor: Editor | undefined;
  let host: HTMLElement | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) editor.destroy();
    editor = undefined;
    host?.remove();
    host = undefined;
  });

  /** A `.dm-editor` host in the document with a mount element inside it. */
  const buildHost = (className = 'dm-editor'): { host: HTMLElement; mount: HTMLElement } => {
    const outer = document.createElement('div');
    outer.className = className;
    const mount = document.createElement('div');
    outer.appendChild(mount);
    document.body.appendChild(outer);
    host = outer;
    return { host: outer, mount };
  };

  const extensions = [Document, Text, Paragraph];

  it('defaults to classic without the option or the class', () => {
    editor = new Editor({ extensions, content: '<p>x</p>' });
    expect(editor.preset).toBe('classic');
  });

  it('returns the explicit option, DOM or not', () => {
    editor = new Editor({ extensions, content: '<p>x</p>', preset: 'notion' });
    expect(editor.preset).toBe('notion');
  });

  it('paints dm-notion-mode on the .dm-editor host and removes it on destroy', () => {
    const { host: outer, mount } = buildHost();
    editor = new Editor({ extensions, content: '<p>x</p>', element: mount, preset: 'notion' });
    expect(outer.classList.contains('dm-notion-mode')).toBe(true);

    editor.destroy();
    expect(outer.classList.contains('dm-notion-mode')).toBe(false);
  });

  it('never removes a class the consumer wrote', () => {
    const { host: outer, mount } = buildHost('dm-editor dm-notion-mode');
    editor = new Editor({ extensions, content: '<p>x</p>', element: mount, preset: 'notion' });

    editor.destroy();
    expect(outer.classList.contains('dm-notion-mode')).toBe(true);
  });

  it('resolves notion from the theme class alone', () => {
    const { mount } = buildHost('dm-editor dm-notion-mode');
    editor = new Editor({ extensions, content: '<p>x</p>', element: mount });
    expect(editor.preset).toBe('notion');
  });

  it('picks up a class toggled at runtime', () => {
    const { host: outer, mount } = buildHost();
    editor = new Editor({ extensions, content: '<p>x</p>', element: mount });
    expect(editor.preset).toBe('classic');

    outer.classList.add('dm-notion-mode');
    expect(editor.preset).toBe('notion');
  });

  it('an explicit classic overrides even the class', () => {
    const { mount } = buildHost('dm-editor dm-notion-mode');
    editor = new Editor({ extensions, content: '<p>x</p>', element: mount, preset: 'classic' });
    expect(editor.preset).toBe('classic');
  });

  it('adoptPresetClass paints the host reached only after adoption', () => {
    // Framework wrappers construct the editor in a detached element and move
    // the view's DOM into the real host later.
    editor = new Editor({ extensions, content: '<p>x</p>', preset: 'notion' });

    const { host: outer, mount } = buildHost();
    mount.appendChild(editor.view.dom);
    editor.adoptPresetClass();
    expect(outer.classList.contains('dm-notion-mode')).toBe(true);

    editor.destroy();
    expect(outer.classList.contains('dm-notion-mode')).toBe(false);
  });

  it('survives having no .dm-editor host at all', () => {
    editor = new Editor({ extensions, content: '<p>x</p>', preset: 'notion' });
    expect(editor.preset).toBe('notion');
    expect(() => editor?.adoptPresetClass()).not.toThrow();
  });
});
