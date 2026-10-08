/**
 * Turn into follows the Heading configuration: a textblock target is offered only when the
 * configuration supports every attribute value it sets, so the default Heading 1 to 3 targets
 * become the configured levels among them, as in the slash menu. The target a block already
 * renders as is hidden, comparing the rendered value, so a stored level the configuration lacks
 * hides the target of the level it renders at.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Blockquote, BulletList, CodeBlock, Document, Editor, Heading, ListItem, Paragraph, Text } from '@domternal/core';
import type { AnyExtension } from '@domternal/core';
import { BlockContextMenu } from './BlockContextMenu.js';
import type { TurnIntoTarget } from './BlockContextMenu.js';

let editor: Editor | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  editor?.destroy();
  editor = undefined;
  host?.remove();
  host = undefined;
});

interface MountOptions {
  levels?: number[];
  targets?: TurnIntoTarget[];
  extra?: AnyExtension[];
}

function mount(content: string, { levels, targets, extra = [] }: MountOptions = {}): Editor {
  host = document.createElement('div');
  host.className = 'dm-editor';
  document.body.appendChild(host);
  editor = new Editor({
    element: host,
    extensions: [
      Document, Text, Paragraph, CodeBlock, Blockquote, BulletList, ListItem, ...extra,
      levels ? Heading.configure({ levels }) : Heading,
      targets ? BlockContextMenu.configure({ turnIntoTargets: targets }) : BlockContextMenu,
    ],
    content,
  });
  return editor;
}

function open(blockPos = 0): void {
  const anchor = host?.querySelector<HTMLElement>('.ProseMirror');
  if (!anchor) throw new Error('No editor view');
  // Close a menu that is still open, as a click outside it does.
  host?.dispatchEvent(new Event('dm:dismiss-overlays'));
  host?.dispatchEvent(new CustomEvent('dm:block-context-menu-open', { detail: { blockPos, anchorElement: anchor } }));
}

/** The labels offered by the Turn into group, in order. */
function turnInto(): string[] {
  const group = Array.from(host?.querySelectorAll<HTMLElement>('.dm-block-context-menu-group') ?? [])
    .find(element => element.getAttribute('aria-label') === 'Turn into');
  return Array.from(group?.querySelectorAll('.dm-block-context-menu-item') ?? [], item => item.getAttribute('aria-label') ?? '');
}

const headings = (): string[] => turnInto().filter(label => label.startsWith('Heading'));

function choose(label: string): void {
  const item = Array.from(host?.querySelectorAll<HTMLButtonElement>('.dm-block-context-menu-item') ?? [])
    .find(button => button.getAttribute('aria-label') === label);
  if (!item) throw new Error(`No item ${label}`);
  item.click();
}

/** Stores a heading level without validation, as a collaborator's client writes it. */
function store(pos: number, level: unknown): void {
  if (!editor) throw new Error('No editor');
  editor.view.dispatch(editor.state.tr.setNodeAttribute(pos, 'level', level));
}

describe('Turn into offers the configured heading levels', () => {
  it.each([
    [undefined, ['Heading 1', 'Heading 2', 'Heading 3']],
    [[1, 2, 3, 4, 5, 6], ['Heading 1', 'Heading 2', 'Heading 3']],
    [[2, 3], ['Heading 2', 'Heading 3']],
    [[1, 2], ['Heading 1', 'Heading 2']],
    [[3, 1, 2], ['Heading 1', 'Heading 2', 'Heading 3']],
    [[4, 2, 2], ['Heading 2']],
    [[4, 5, 6], []],
  ] as const)('with levels %j on a paragraph', (levels, expected) => {
    mount('<p>Text</p>', levels === undefined ? {} : { levels: [...levels] });
    open();
    expect(headings()).toEqual(expected);
    expect(turnInto()).toEqual(expect.arrayContaining(['Bullet list', 'Quote', 'Code block']));
  });

  it('hides the level a heading renders at and every level the configuration lacks', () => {
    mount('<h2>Two</h2>', { levels: [2, 3] });
    open();
    expect(headings()).toEqual(['Heading 3']);
    expect(turnInto()).toContain('Paragraph');
  });

  it('offers only the other configured level on an h2 with levels 1 and 2', () => {
    mount('<h2>Two</h2>', { levels: [1, 2] });
    open();
    expect(headings()).toEqual(['Heading 1']);
  });

  it('offers the configured levels on a list item, which is lifted out and converted', () => {
    mount('<ul><li><p>Item</p></li></ul>', { levels: [2, 3] });
    open(1);
    expect(headings()).toEqual(['Heading 2', 'Heading 3']);
    choose('Heading 3');
    expect(editor?.getJSON().content?.[0]).toMatchObject({ type: 'heading', attrs: { level: 3 } });
  });
});

describe('Turn into reads the level a heading renders at', () => {
  it('offers Heading 1 to 3 on a stored 5 rendered as h4, and stores the chosen level', () => {
    mount('<h1>Five</h1>');
    store(0, 5);
    expect(editor?.getHTML()).toBe('<h4>Five</h4>');
    open();
    expect(headings()).toEqual(['Heading 1', 'Heading 2', 'Heading 3']);
    choose('Heading 3');
    expect(editor?.getJSON().content?.[0]).toMatchObject({ type: 'heading', attrs: { level: 3 } });
  });

  it('hides Heading 1 and Heading 2 on a stored 1 that a [2, 3] editor renders as h2', () => {
    mount('<h2>One</h2>', { levels: [2, 3] });
    store(0, 1);
    expect(editor?.getHTML()).toBe('<h2>One</h2>');
    open();
    expect(headings()).toEqual(['Heading 3']);
  });

  it.each([['3', ['Heading 1', 'Heading 2']], ['x', ['Heading 2', 'Heading 3']], [9, ['Heading 1', 'Heading 2', 'Heading 3']]] as const)(
    'hides the target a stored %j renders as', (stored, expected) => {
      mount('<h1>Stored</h1>');
      store(0, stored);
      open();
      expect(headings()).toEqual(expected);
    });
});

describe('custom Turn into targets', () => {
  const heading = (level: unknown): TurnIntoTarget => ({ label: `Level ${String(level)}`, icon: 'textH', nodeType: 'heading', attrs: { level } });

  it('hides a target whose value the configuration does not support, or validation rejects', () => {
    mount('<p>Text</p>', { targets: [heading(4), heading(5), heading(9), heading('2'), heading(null)] });
    open();
    expect(turnInto()).toEqual(['Level 4']);
  });

  it('hides a Heading 4 target on a stored 5 that renders as h4, and offers it on a stored 3', () => {
    mount('<h1>Five</h1><h3>Three</h3>', { targets: [heading(4), heading(3)] });
    store(0, 5);
    open(editor?.state.doc.child(0).nodeSize);
    expect(turnInto()).toEqual(['Level 4']);
    open(0);
    expect(turnInto()).toEqual(['Level 3']);
    choose('Level 3');
    expect(editor?.getJSON().content?.map(node => node.attrs?.['level'])).toEqual([3, 3]);
  });

  it('keeps a target for an attribute the editor does not normalize', () => {
    const code: TurnIntoTarget = { label: 'JavaScript', icon: 'codeBlock', nodeType: 'codeBlock', attrs: { language: 'javascript' } };
    mount('<p>Text</p><pre><code class="language-javascript">x</code></pre><pre><code>y</code></pre>', { targets: [code] });
    open(0);
    expect(turnInto()).toEqual(['JavaScript']);
    open(editor?.state.doc.child(0).nodeSize);
    expect(turnInto()).toEqual([]);
    const third = (editor?.state.doc.child(0).nodeSize ?? 0) + (editor?.state.doc.child(1).nodeSize ?? 0);
    open(third);
    expect(turnInto()).toEqual(['JavaScript']);
  });

  it('keeps a target that sets no attributes, and hides it on a block of its own type', () => {
    const plain: TurnIntoTarget = { label: 'Plain heading', icon: 'textH', nodeType: 'heading' };
    mount('<p>Text</p><h2>Two</h2>', { targets: [plain] });
    open(0);
    expect(turnInto()).toEqual(['Plain heading']);
    open(editor?.state.doc.child(0).nodeSize);
    expect(turnInto()).toEqual([]);
  });
});
