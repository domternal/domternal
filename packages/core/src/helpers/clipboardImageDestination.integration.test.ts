import { afterEach, describe, expect, it } from 'vitest';
import { Plugin } from '@domternal/pm/state';
import { Document, Editor, Node, Paragraph, Text } from '../index.js';
import { getClipboardImageDestination, registerClipboardImageDestination } from '../clipboard.js';
import type { ClipboardImageDestinationPolicy } from '../clipboard.js';

interface Registration { dispose?: () => void }

const editors: Editor[] = [];
afterEach(() => { for (const editor of editors) editor.destroy(); editors.length = 0; });

function policy(nodeTypeName: string): ClipboardImageDestinationPolicy {
  return {
    nodeTypeName, sourceAttribute: 'src', inline: false, allowEmbedded: true,
    allowedMimeTypes: ['image/png'], maxFileBytes: 1024, policyVersion: `${nodeTypeName}:1`,
  };
}

/** An image-like block node that registers its own clipboard destination from its plugin view. */
function imageLike(name: string, priority: number, registration: Registration): Node {
  return Node.create({
    name, priority, group: 'block', atom: true,
    addAttributes: () => ({ src: { default: null } }),
    parseHTML: () => [{ tag: `img[data-${name}]` }],
    renderHTML: () => ['img', { [`data-${name}`]: '' }],
    addProseMirrorPlugins: () => [new Plugin({
      view: view => {
        registration.dispose = registerClipboardImageDestination(view, () => policy(name));
        return { destroy: () => { registration.dispose?.(); } };
      },
    })],
  });
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Expected a value');
  return value;
}

/** Plugin views register in priority order, so the lower priority figure registers after the photo. */
function mount(): { editor: Editor; photo: Registration; figure: Registration } {
  const photo: Registration = {};
  const figure: Registration = {};
  const editor = new Editor({
    extensions: [Document, Paragraph, Text, imageLike('figure', 100, figure), imageLike('photo', 200, photo)],
  });
  editors.push(editor);
  return { editor, photo, figure };
}

describe('clipboard image destinations through the @domternal/core/clipboard subpath', () => {
  it('uses the later registration when a schema has two image-like node types', () => {
    const { editor } = mount();

    expect(Object.keys(editor.schema.nodes)).toEqual(expect.arrayContaining(['photo', 'figure']));
    expect(getClipboardImageDestination(editor.view)).toEqual(policy('figure'));
  });

  it('restores the earlier registration when the later one is disposed', () => {
    const { editor, figure } = mount();

    required(figure.dispose)();
    expect(getClipboardImageDestination(editor.view)).toEqual(policy('photo'));
  });

  it('keeps the later registration when an earlier one is disposed', () => {
    const { editor, photo, figure } = mount();

    required(photo.dispose)();
    expect(getClipboardImageDestination(editor.view)).toEqual(policy('figure'));
    required(figure.dispose)();
    expect(getClipboardImageDestination(editor.view)).toBeUndefined();
  });

  it('orders by registration time, so recreated plugin views register again above an application registration', () => {
    const { editor } = mount();
    const disposeApplication = registerClipboardImageDestination(editor.view, () => policy('application'));
    expect(getClipboardImageDestination(editor.view)).toEqual(policy('application'));

    const plugins = editor.state.plugins;
    editor.view.updateState(editor.state.reconfigure({ plugins: [] }));
    expect(getClipboardImageDestination(editor.view)).toEqual(policy('application'));
    editor.view.updateState(editor.state.reconfigure({ plugins }));
    expect(getClipboardImageDestination(editor.view)).toEqual(policy('figure'));

    disposeApplication();
    expect(getClipboardImageDestination(editor.view)).toEqual(policy('figure'));
  });
});
