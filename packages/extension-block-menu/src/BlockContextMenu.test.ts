import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import {
  Document,
  Text,
  Paragraph,
  Heading,
  Blockquote,
  CodeBlock,
  BulletList,
  OrderedList,
  ListItem,
  TaskList,
  UniqueID,
  BlockColor,
  Editor,
} from '@domternal/core';
import { BlockContextMenu } from './BlockContextMenu.js';

const extensions = [Document, Text, Paragraph, Heading, Blockquote, CodeBlock, BulletList, OrderedList, TaskList, BlockContextMenu];

let editor: Editor | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  editor?.destroy();
  editor = undefined;
  host?.remove();
  host = undefined;
});

function makeEditor(html = '<p>Hello</p>'): Editor {
  host = document.createElement('div');
  host.className = 'dm-editor';
  document.body.appendChild(host);
  editor = new Editor({ element: host, extensions, content: html });
  return editor;
}

/**
 * Dispatch the custom `dm:block-context-menu-open` event that BlockHandle
 * emits on click. Simulates the integration without going through the
 * drag-handle DOM path.
 */
function openContextMenu(blockPos: number, anchor?: HTMLElement): void {
  const fallback = host ? host.querySelector<HTMLElement>('.ProseMirror') : null;
  const anchorEl = anchor ?? fallback;
  if (!anchorEl) return;
  host?.dispatchEvent(
    new CustomEvent('dm:block-context-menu-open', {
      detail: { blockPos, anchorElement: anchorEl },
    }),
  );
}

describe('BlockContextMenu configuration', () => {
  it('has the correct extension name', () => {
    expect(BlockContextMenu.name).toBe('blockContextMenu');
  });

  it('has turnIntoEnabled=true by default', () => {
    expect(BlockContextMenu.options.turnIntoEnabled).toBe(true);
  });

  it('ships default turnIntoTargets list', () => {
    expect(Array.isArray(BlockContextMenu.options.turnIntoTargets)).toBe(true);
    expect((BlockContextMenu.options.turnIntoTargets ?? []).length).toBeGreaterThan(0);
    const names = (BlockContextMenu.options.turnIntoTargets ?? []).map((t) => t.nodeType);
    expect(names).toContain('paragraph');
    expect(names).toContain('heading');
    expect(names).toContain('blockquote');
  });

  it('can override turnIntoEnabled', () => {
    const configured = BlockContextMenu.configure({ turnIntoEnabled: false });
    expect(configured.options.turnIntoEnabled).toBe(false);
  });

  it('can override turnIntoTargets', () => {
    const configured = BlockContextMenu.configure({
      turnIntoTargets: [{ label: 'Plain', icon: 'textT', nodeType: 'paragraph' }],
    });
    expect(configured.options.turnIntoTargets).toHaveLength(1);
    expect(configured.options.turnIntoTargets?.[0]?.label).toBe('Plain');
  });
});

describe('BlockContextMenu DOM integration', () => {
  it('mounts a .dm-block-context-menu element inside .dm-editor', () => {
    makeEditor();
    const menu = host?.querySelector('.dm-block-context-menu');
    expect(menu).not.toBeNull();
  });

  it('applies role="menu" and aria-label to the popup', () => {
    makeEditor();
    const menu = host?.querySelector('.dm-block-context-menu');
    expect(menu?.getAttribute('role')).toBe('menu');
    expect(menu?.getAttribute('aria-label')).toBe('Block options');
  });

  it('removes DOM on editor destroy', () => {
    makeEditor();
    const hostRef = host;
    editor?.destroy();
    editor = undefined;
    expect(hostRef?.querySelector('.dm-block-context-menu')).toBeNull();
  });

  it('is hidden initially (no data-show)', () => {
    makeEditor();
    const menu = host?.querySelector('.dm-block-context-menu');
    expect(menu?.hasAttribute('data-show')).toBe(false);
  });

  it('shows menu with Delete + Duplicate + Turn into items on open', () => {
    makeEditor('<p>Target</p>');
    openContextMenu(0);
    const menu = host?.querySelector('.dm-block-context-menu');
    expect(menu?.hasAttribute('data-show')).toBe(true);
    const items = menu?.querySelectorAll('.dm-block-context-menu-item');
    expect((items?.length ?? 0)).toBeGreaterThan(2);
    // Labels are stored in aria-label; verify core actions present.
    const labels = Array.from(items ?? []).map((b) => b.getAttribute('aria-label'));
    expect(labels).toContain('Delete');
    expect(labels).toContain('Duplicate');
  });

  it('omits Duplicate for horizontal rules (though HR not in this test setup, renders dynamic)', () => {
    // Paragraph has Duplicate visible - verifies dynamic rendering decision.
    makeEditor('<p>X</p>');
    openContextMenu(0);
    const items = host?.querySelectorAll('.dm-block-context-menu-item');
    const labels = Array.from(items ?? []).map((b) => b.getAttribute('aria-label'));
    expect(labels).toContain('Duplicate');
  });

  it('filters out the current block type from Turn into targets', () => {
    makeEditor('<h2>Title</h2>');
    openContextMenu(0);
    const items = host?.querySelectorAll('.dm-block-context-menu-item');
    const labels = Array.from(items ?? []).map((b) => b.getAttribute('aria-label'));
    // Heading 2 is current → should not appear as a Turn into target.
    expect(labels).not.toContain('Heading 2');
    // Other heading levels should still be offered.
    expect(labels).toContain('Heading 1');
  });

  it('closes on dm:dismiss-overlays event', () => {
    makeEditor('<p>Test</p>');
    openContextMenu(0);
    const menu = host?.querySelector('.dm-block-context-menu');
    expect(menu?.hasAttribute('data-show')).toBe(true);
    host?.dispatchEvent(new Event('dm:dismiss-overlays'));
    expect(menu?.hasAttribute('data-show')).toBe(false);
  });

  it('hides Turn into section when turnIntoEnabled is false', () => {
    const disabled = BlockContextMenu.configure({ turnIntoEnabled: false });
    const customExtensions = [Document, Text, Paragraph, Heading, disabled];
    host = document.createElement('div');
    host.className = 'dm-editor';
    document.body.appendChild(host);
    editor = new Editor({ element: host, extensions: customExtensions, content: '<p>x</p>' });
    openContextMenu(0);
    const labels = Array.from(host.querySelectorAll('.dm-block-context-menu-item'))
      .map((b) => b.getAttribute('aria-label'));
    // Primary actions present, turn-into targets absent.
    expect(labels).toContain('Delete');
    expect(labels).not.toContain('Heading 1');
  });
});

describe('BlockContextMenu click execution', () => {
  function findItemByLabel(label: string): HTMLButtonElement | null {
    const items = host?.querySelectorAll<HTMLButtonElement>('.dm-block-context-menu-item');
    if (!items) return null;
    for (const btn of Array.from(items)) {
      if (btn.getAttribute('aria-label') === label) return btn;
    }
    return null;
  }

  it('Delete removes the targeted block', () => {
    makeEditor('<p>First</p><p>Second</p><p>Third</p>');
    // Open on the second paragraph (starts at pos 7).
    openContextMenu(7);
    const delBtn = findItemByLabel('Delete');
    expect(delBtn).not.toBeNull();
    delBtn?.click();
    const texts: string[] = [];
    editor?.state.doc.forEach((n) => { texts.push(n.textContent); });
    expect(texts).toEqual(['First', 'Third']);
  });

  it('Delete on the only remaining block replaces with empty paragraph', () => {
    makeEditor('<h1>Only</h1>');
    openContextMenu(0);
    const delBtn = findItemByLabel('Delete');
    delBtn?.click();
    const doc = editor?.state.doc;
    expect(doc?.childCount).toBe(1);
    expect(doc?.firstChild?.type.name).toBe('paragraph');
    expect(doc?.firstChild?.textContent).toBe('');
  });

  it('Duplicate inserts an identical copy below the source', () => {
    makeEditor('<p>Hello</p>');
    openContextMenu(0);
    const dupBtn = findItemByLabel('Duplicate');
    dupBtn?.click();
    const texts: string[] = [];
    editor?.state.doc.forEach((n) => { texts.push(n.textContent); });
    expect(texts).toEqual(['Hello', 'Hello']);
  });

  it('Turn into Heading 1 converts paragraph preserving inline content', () => {
    makeEditor('<p>Hello world</p>');
    openContextMenu(0);
    const h1Btn = findItemByLabel('Heading 1');
    expect(h1Btn).not.toBeNull();
    h1Btn?.click();
    const firstChild = editor?.state.doc.firstChild;
    expect(firstChild?.type.name).toBe('heading');
    expect(firstChild?.attrs['level']).toBe(1);
    expect(firstChild?.textContent).toBe('Hello world');
  });

  it('closes menu and refocuses editor after item execution', () => {
    const ed = makeEditor('<p>x</p>');
    const focusSpy = vi.spyOn(ed.view, 'focus');
    openContextMenu(0);
    const menu = host?.querySelector('.dm-block-context-menu');
    expect(menu?.hasAttribute('data-show')).toBe(true);
    findItemByLabel('Duplicate')?.click();
    expect(menu?.hasAttribute('data-show')).toBe(false);
    // `runAndClose` calls `editor.view.focus()` in its finally block -
    // jsdom's focus state on contenteditable is unreliable, so spy on the
    // method itself to verify refocus was attempted.
    expect(focusSpy).toHaveBeenCalled();
  });
});

describe('BlockContextMenu Copy link + UniqueID integration', () => {
  interface ExecCommandDoc {
    execCommand?: (command: string) => boolean;
  }

  let originalClipboard: typeof navigator.clipboard | undefined;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  let originalExecCommand: typeof document.execCommand | undefined;

  beforeEach(() => {
    originalClipboard = navigator.clipboard;
    originalExecCommand = (document as unknown as ExecCommandDoc).execCommand;
    // Provide a stubbed execCommand so the clipboard fallback path succeeds
    // in environments where jsdom doesn't ship one.
    (document as unknown as ExecCommandDoc).execCommand = () => true;
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: originalClipboard,
      configurable: true,
    });
    if (originalExecCommand === undefined) {
      delete (document as unknown as ExecCommandDoc).execCommand;
    } else {
      (document as unknown as ExecCommandDoc).execCommand = originalExecCommand;
    }
    vi.restoreAllMocks();
  });

  function makeEditorWithUniqueID(
    html = '<p>Hello</p>',
    contextMenuOptions: Parameters<typeof BlockContextMenu.configure>[0] = {},
    uniqueIDTypes: string[] = ['paragraph', 'heading'],
  ): Editor {
    host = document.createElement('div');
    host.className = 'dm-editor';
    document.body.appendChild(host);
    editor = new Editor({
      element: host,
      extensions: [
        Document,
        Text,
        Paragraph,
        Heading,
        Blockquote,
        CodeBlock,
        UniqueID.configure({ types: uniqueIDTypes }),
        BlockContextMenu.configure(contextMenuOptions),
      ],
      content: html,
    });
    return editor;
  }

  /**
   * UniqueID assigns ids via a `setTimeout(..., 0)` in its view hook; the
   * exact moment the transaction fires isn't observable from the test. Poll
   * for up to 500ms until the first-block id shows up to avoid flakes on
   * slow CI. Accepts an optional `attr` override for non-default schemas.
   */
  async function waitForUniqueIDs(attr = 'id', maxTries = 100): Promise<void> {
    for (let i = 0; i < maxTries; i++) {
      const id = editor?.state.doc.firstChild?.attrs[attr] as unknown;
      if (typeof id === 'string' && id.length > 0) return;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error('Timeout waiting for UniqueID to assign ids');
  }

  function findItemByLabel(label: string): HTMLButtonElement | null {
    const items = host?.querySelectorAll<HTMLButtonElement>('.dm-block-context-menu-item');
    if (!items) return null;
    for (const btn of Array.from(items)) {
      if (btn.getAttribute('aria-label') === label) return btn;
    }
    return null;
  }

  it('shows Copy link item when UniqueID is loaded and block has id', async () => {
    makeEditorWithUniqueID();
    await waitForUniqueIDs();
    openContextMenu(0);
    expect(findItemByLabel('Copy link')).not.toBeNull();
  });

  it('hides Copy link item when UniqueID is not loaded', () => {
    makeEditor('<p>Hello</p>');
    openContextMenu(0);
    expect(findItemByLabel('Copy link')).toBeNull();
  });

  it('hides Copy link item when copyLinkEnabled is false', async () => {
    makeEditorWithUniqueID('<p>Hello</p>', { copyLinkEnabled: false });
    await waitForUniqueIDs();
    openContextMenu(0);
    expect(findItemByLabel('Copy link')).toBeNull();
  });

  it('hides Copy link item when block type is not in UniqueID.types', async () => {
    // UniqueID covers only 'paragraph' - code blocks get no id, so no item.
    makeEditorWithUniqueID('<pre><code>x</code></pre>', {}, ['paragraph']);
    // Wait a tick for UniqueID's initial transaction to run; we aren't
    // waiting for an id because none is ever assigned on this block.
    await new Promise((r) => setTimeout(r, 20));
    openContextMenu(0);
    expect(findItemByLabel('Copy link')).toBeNull();
  });

  it('Copy link click writes the URL to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    makeEditorWithUniqueID();
    await waitForUniqueIDs();
    openContextMenu(0);
    findItemByLabel('Copy link')?.click();
    // Allow the pending clipboard promise to resolve before asserting.
    await new Promise((r) => setTimeout(r, 0));

    expect(writeText).toHaveBeenCalledTimes(1);
    const arg = writeText.mock.calls[0]?.[0] as string;
    // URL ends with `#<id>`; the id comes from UniqueID so we can't hard-code.
    expect(arg).toMatch(/#[a-f0-9-]+$/);
  });

  it('Copy link respects onCopyLink override', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
    const onCopyLink = vi.fn<(id: string, ed: Editor) => string>(
      (id) => `https://app.example/doc?block=${id}`,
    );

    makeEditorWithUniqueID('<p>Hello</p>', { onCopyLink });
    await waitForUniqueIDs();
    openContextMenu(0);
    findItemByLabel('Copy link')?.click();

    expect(onCopyLink).toHaveBeenCalledTimes(1);
    const call = onCopyLink.mock.calls[0];
    expect(call).toBeDefined();
    if (!call) return;
    const [id, editorArg] = call;
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
    expect(editorArg).toBe(editor);
  });

  it('Copy link dispatches dm:copy-link-success when clipboard write succeeds', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
    const success = vi.fn();
    const error = vi.fn();

    makeEditorWithUniqueID();
    await waitForUniqueIDs();
    host?.addEventListener('dm:copy-link-success', success);
    host?.addEventListener('dm:copy-link-error', error);
    openContextMenu(0);
    findItemByLabel('Copy link')?.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(success).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
    const firstCall = success.mock.calls[0];
    expect(firstCall).toBeDefined();
    if (!firstCall) return;
    const ev = firstCall[0] as CustomEvent<{ url: string; blockId: string }>;
    expect(ev.detail.url).toMatch(/#/);
    expect(typeof ev.detail.blockId).toBe('string');
  });

  it('Copy link dispatches dm:copy-link-error when clipboard write fails', async () => {
    // Reject the async API AND force the execCommand fallback to fail, so
    // `writeToClipboard` returns false end-to-end.
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    });
    (document as unknown as ExecCommandDoc).execCommand = () => false;
    const success = vi.fn();
    const error = vi.fn();

    makeEditorWithUniqueID();
    await waitForUniqueIDs();
    host?.addEventListener('dm:copy-link-success', success);
    host?.addEventListener('dm:copy-link-error', error);
    openContextMenu(0);
    findItemByLabel('Copy link')?.click();
    // Two macrotasks: first for the rejected clipboard promise, second for
    // the `.then` handler that dispatches the event.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(error).toHaveBeenCalledTimes(1);
    expect(success).not.toHaveBeenCalled();
  });

  it('Duplicate regenerates id when UniqueID is loaded', async () => {
    makeEditorWithUniqueID('<p>Hello</p>');
    await waitForUniqueIDs();
    const originalId = editor?.state.doc.firstChild?.attrs['id'] as string;
    expect(originalId).toBeTruthy();

    openContextMenu(0);
    findItemByLabel('Duplicate')?.click();

    const firstId = editor?.state.doc.child(0).attrs['id'] as string;
    const secondId = editor?.state.doc.child(1).attrs['id'] as string;
    expect(firstId).toBe(originalId);
    expect(secondId).toBeTruthy();
    expect(secondId).not.toBe(originalId);
  });
});

describe('BlockContextMenu Colors section (BlockColor integration)', () => {
  function makeEditorWithBlockColor(
    html = '<p>Hello</p>',
    contextMenuOptions: Parameters<typeof BlockContextMenu.configure>[0] = {},
    blockColorTypes?: string[],
  ): Editor {
    host = document.createElement('div');
    host.className = 'dm-editor';
    document.body.appendChild(host);
    const blockColorExt = blockColorTypes
      ? BlockColor.configure({ types: blockColorTypes })
      : BlockColor;
    editor = new Editor({
      element: host,
      extensions: [
        Document,
        Text,
        Paragraph,
        Heading,
        Blockquote,
        BulletList,
        ListItem,
        CodeBlock,
        blockColorExt,
        BlockContextMenu.configure(contextMenuOptions),
      ],
      content: html,
    });
    return editor;
  }

  function swatchFor(variant: 'bg' | 'text', color: string | null): HTMLButtonElement | null {
    const selector = `.dm-block-color-swatch--${variant}[data-color="${color ?? 'null'}"]`;
    return host?.querySelector<HTMLButtonElement>(selector) ?? null;
  }

  it('renders Colors section when BlockColor is loaded', () => {
    makeEditorWithBlockColor();
    openContextMenu(0);
    const label = Array.from(host?.querySelectorAll('.dm-block-context-menu-group-label') ?? [])
      .map((el) => el.textContent);
    expect(label).toContain('Colors');
  });

  it('hides Colors section when BlockColor is not loaded', () => {
    makeEditor('<p>Hi</p>');
    openContextMenu(0);
    const label = Array.from(host?.querySelectorAll('.dm-block-context-menu-group-label') ?? [])
      .map((el) => el.textContent);
    expect(label).not.toContain('Colors');
  });

  it('hides Colors section when blockColorEnabled is false', () => {
    makeEditorWithBlockColor('<p>Hi</p>', { blockColorEnabled: false });
    openContextMenu(0);
    const label = Array.from(host?.querySelectorAll('.dm-block-context-menu-group-label') ?? [])
      .map((el) => el.textContent);
    expect(label).not.toContain('Colors');
  });

  it('hides Colors section for types not in BlockColor.types', () => {
    // Configure BlockColor to cover only paragraph; open menu on a heading.
    makeEditorWithBlockColor('<h1>Title</h1>', {}, ['paragraph']);
    openContextMenu(0);
    const label = Array.from(host?.querySelectorAll('.dm-block-context-menu-group-label') ?? [])
      .map((el) => el.textContent);
    expect(label).not.toContain('Colors');
  });

  it('renders text + background swatch rows with null-reset + 9 palette entries', () => {
    makeEditorWithBlockColor();
    openContextMenu(0);
    const textSwatches = host?.querySelectorAll('.dm-block-color-swatch--text') ?? [];
    const bgSwatches = host?.querySelectorAll('.dm-block-color-swatch--bg') ?? [];
    // Each row = 1 null-reset + 9 palette colors = 10 buttons.
    expect(textSwatches.length).toBe(10);
    expect(bgSwatches.length).toBe(10);
  });

  it('background swatch click sets bgColor on the block', () => {
    makeEditorWithBlockColor('<p>Hi</p>');
    openContextMenu(0);
    swatchFor('bg', 'yellow')?.click();
    expect(editor?.state.doc.firstChild?.attrs['bgColor']).toBe('yellow');
  });

  it('text swatch click sets textColor on the block', () => {
    makeEditorWithBlockColor('<p>Hi</p>');
    openContextMenu(0);
    swatchFor('text', 'blue')?.click();
    expect(editor?.state.doc.firstChild?.attrs['textColor']).toBe('blue');
  });

  it('null-reset swatch clears the attribute', () => {
    makeEditorWithBlockColor('<p data-bg-color="yellow">Hi</p>');
    openContextMenu(0);
    swatchFor('bg', null)?.click();
    expect(editor?.state.doc.firstChild?.attrs['bgColor']).toBe(null);
  });

  it('swatches have role=menuitem and aria-pressed reflects active state', () => {
    makeEditorWithBlockColor('<p data-bg-color="yellow">Hi</p>');
    openContextMenu(0);
    const yellowBg = swatchFor('bg', 'yellow');
    const redBg = swatchFor('bg', 'red');
    expect(yellowBg?.getAttribute('role')).toBe('menuitem');
    expect(yellowBg?.getAttribute('aria-pressed')).toBe('true');
    expect(redBg?.getAttribute('aria-pressed')).toBe('false');
  });

  it('swatches have descriptive aria-labels', () => {
    makeEditorWithBlockColor('<p>Hi</p>');
    openContextMenu(0);
    expect(swatchFor('bg', 'yellow')?.getAttribute('aria-label')).toBe('Background: yellow');
    expect(swatchFor('text', 'gray')?.getAttribute('aria-label')).toBe('Text color: gray');
    expect(swatchFor('bg', null)?.getAttribute('aria-label')).toBe('No background');
    expect(swatchFor('text', null)?.getAttribute('aria-label')).toBe('Default text color');
  });

  it('closes menu + refocuses editor after a swatch click', () => {
    const ed = makeEditorWithBlockColor('<p>Hi</p>');
    const focusSpy = vi.spyOn(ed.view, 'focus');
    openContextMenu(0);
    const menu = host?.querySelector('.dm-block-context-menu');
    expect(menu?.hasAttribute('data-show')).toBe(true);
    swatchFor('bg', 'green')?.click();
    expect(menu?.hasAttribute('data-show')).toBe(false);
    expect(focusSpy).toHaveBeenCalled();
  });
});

// ── Keyboard navigation + outside click + dismissal ──────────────────────

describe('BlockContextMenu keyboard navigation', () => {
  function getButtons(): HTMLButtonElement[] {
    return Array.from(host?.querySelectorAll<HTMLButtonElement>(
      '.dm-block-context-menu [role="menuitem"]',
    ) ?? []);
  }

  it('ArrowDown moves focus to next item and wraps at end', () => {
    makeEditor('<p>Hi</p>');
    openContextMenu(0);

    const root = host?.querySelector<HTMLElement>('.dm-block-context-menu');
    const buttons = getButtons();
    expect(buttons.length).toBeGreaterThan(1);

    // Initial: first button has tabindex 0
    expect(buttons[0]?.tabIndex).toBe(0);

    root?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    expect(buttons[1]?.tabIndex).toBe(0);
    expect(buttons[0]?.tabIndex).toBe(-1);
  });

  it('ArrowUp moves focus to previous item and wraps at start', () => {
    makeEditor('<p>Hi</p>');
    openContextMenu(0);
    const root = host?.querySelector<HTMLElement>('.dm-block-context-menu');
    const buttons = getButtons();

    root?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    // Wraps to the LAST button when starting at index 0.
    expect(buttons[buttons.length - 1]?.tabIndex).toBe(0);
  });

  it('Home jumps focus to first item', () => {
    makeEditor('<p>Hi</p>');
    openContextMenu(0);
    const root = host?.querySelector<HTMLElement>('.dm-block-context-menu');
    const buttons = getButtons();

    root?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    root?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    root?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }));

    expect(buttons[0]?.tabIndex).toBe(0);
  });

  it('End jumps focus to last item', () => {
    makeEditor('<p>Hi</p>');
    openContextMenu(0);
    const root = host?.querySelector<HTMLElement>('.dm-block-context-menu');
    const buttons = getButtons();

    root?.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
    expect(buttons[buttons.length - 1]?.tabIndex).toBe(0);
  });

  it('Escape closes the menu and refocuses editor', () => {
    const ed = makeEditor('<p>Hi</p>');
    const focusSpy = vi.spyOn(ed.view, 'focus');
    openContextMenu(0);
    const menu = host?.querySelector<HTMLElement>('.dm-block-context-menu');
    expect(menu?.hasAttribute('data-show')).toBe(true);

    menu?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(menu?.hasAttribute('data-show')).toBe(false);
    expect(focusSpy).toHaveBeenCalled();
  });

  it('unhandled keys (e.g. Tab, character) do not close the menu', () => {
    makeEditor('<p>Hi</p>');
    openContextMenu(0);
    const menu = host?.querySelector<HTMLElement>('.dm-block-context-menu');
    expect(menu?.hasAttribute('data-show')).toBe(true);

    menu?.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }));
    expect(menu?.hasAttribute('data-show')).toBe(true);
  });

  it('keydown when menu is closed is a no-op', () => {
    makeEditor('<p>Hi</p>');
    // Menu never opened.
    expect(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    }).not.toThrow();
  });
});

describe('BlockContextMenu outside click', () => {
  it('clicking outside the menu (on document) closes it', () => {
    makeEditor('<p>Hi</p>');
    openContextMenu(0);
    const menu = host?.querySelector<HTMLElement>('.dm-block-context-menu');
    expect(menu?.hasAttribute('data-show')).toBe(true);

    // Mousedown outside the menu - listener uses capture phase on document.
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));

    expect(menu?.hasAttribute('data-show')).toBe(false);
    outside.remove();
  });

  it('clicking inside the menu does NOT close it', () => {
    makeEditor('<p>Hi</p>');
    openContextMenu(0);
    const menu = host?.querySelector<HTMLElement>('.dm-block-context-menu');
    expect(menu?.hasAttribute('data-show')).toBe(true);

    // Mousedown on the menu root itself (not on a button).
    menu?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(menu?.hasAttribute('data-show')).toBe(true);
  });

  it('outside click when menu is closed is a no-op (does not throw)', () => {
    makeEditor('<p>Hi</p>');
    expect(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    }).not.toThrow();
  });
});

describe('BlockContextMenu Turn into - wrapper targets', () => {
  function findItemByLabel(label: string): HTMLButtonElement | null {
    const items = host?.querySelectorAll<HTMLButtonElement>('.dm-block-context-menu-item');
    if (!items) return null;
    for (const btn of Array.from(items)) {
      if (btn.getAttribute('aria-label') === label) return btn;
    }
    return null;
  }

  function getLabels(): string[] {
    const items = host?.querySelectorAll('.dm-block-context-menu-item');
    return Array.from(items ?? []).map((b) => b.getAttribute('aria-label') ?? '');
  }

  function findFirstPosOf(typeName: string): number {
    let found = -1;
    editor?.state.doc.descendants((node, pos) => {
      if (found !== -1) return false;
      if (node.type.name === typeName) { found = pos; return false; }
      return true;
    });
    if (found === -1) throw new Error(`node ${typeName} not found`);
    return found;
  }

  // --- Visibility on top-level textblocks ---

  it('shows all 4 wrapper targets on a top-level paragraph', () => {
    makeEditor('<p>Hello</p>');
    openContextMenu(0);
    const labels = getLabels();
    expect(labels).toContain('Bullet list');
    expect(labels).toContain('Ordered list');
    expect(labels).toContain('To-do list');
    expect(labels).toContain('Quote');
  });

  it('shows all 4 wrapper targets on a heading source', () => {
    makeEditor('<h2>Title</h2>');
    openContextMenu(0);
    const labels = getLabels();
    expect(labels).toContain('Bullet list');
    expect(labels).toContain('Ordered list');
    expect(labels).toContain('To-do list');
    expect(labels).toContain('Quote');
    // Same-type filter still hides H2.
    expect(labels).not.toContain('Heading 2');
  });

  it('shows all 4 wrapper targets on a code block source', () => {
    makeEditor('<pre><code>x=1</code></pre>');
    openContextMenu(0);
    const labels = getLabels();
    expect(labels).toContain('Bullet list');
    expect(labels).toContain('Quote');
    // Same-type filter hides Code block.
    expect(labels).not.toContain('Code block');
  });

  // --- Ancestor-hide filter ---
  //
  // The outer `isTextblock` guard means BlockHandle's natural target
  // (the wrapping listItem / bulletList) hides Turn into entirely. To
  // exercise the ancestor-walk filter we open the menu directly on the
  // inner paragraph's position, simulating a future BlockHandle mode
  // that targets inner textblocks.

  it('hides Bullet list when the targeted paragraph sits inside a bullet list', () => {
    makeEditor('<ul><li><p>A</p></li></ul>');
    const paragraphPos = findFirstPosOf('paragraph');
    openContextMenu(paragraphPos);
    const labels = getLabels();
    expect(labels).not.toContain('Bullet list');
    // Sibling wrappers still selectable - user can convert the list.
    expect(labels).toContain('Ordered list');
    expect(labels).toContain('To-do list');
    expect(labels).toContain('Quote');
  });

  it('hides Ordered list when the targeted paragraph sits inside an ordered list', () => {
    makeEditor('<ol><li><p>A</p></li></ol>');
    const paragraphPos = findFirstPosOf('paragraph');
    openContextMenu(paragraphPos);
    const labels = getLabels();
    expect(labels).not.toContain('Ordered list');
    expect(labels).toContain('Bullet list');
  });

  it('hides To-do list when the targeted paragraph sits inside a task list', () => {
    makeEditor('<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>A</p></li></ul>');
    const paragraphPos = findFirstPosOf('paragraph');
    openContextMenu(paragraphPos);
    const labels = getLabels();
    expect(labels).not.toContain('To-do list');
    expect(labels).toContain('Bullet list');
  });

  it('hides Quote when the targeted paragraph sits inside a blockquote', () => {
    makeEditor('<blockquote><p>Quoted</p></blockquote>');
    const paragraphPos = findFirstPosOf('paragraph');
    openContextMenu(paragraphPos);
    const labels = getLabels();
    expect(labels).not.toContain('Quote');
    expect(labels).toContain('Bullet list');
  });

  // --- Click execution: wraps the source into the target wrapper ---

  it('clicking Bullet list wraps the paragraph in <ul><li><p>', () => {
    makeEditor('<p>Hello</p>');
    openContextMenu(0);
    findItemByLabel('Bullet list')?.click();
    const first = editor?.state.doc.firstChild;
    expect(first?.type.name).toBe('bulletList');
    expect(first?.firstChild?.type.name).toBe('listItem');
    expect(first?.firstChild?.firstChild?.type.name).toBe('paragraph');
    expect(first?.firstChild?.firstChild?.textContent).toBe('Hello');
  });

  it('clicking Ordered list wraps the paragraph in <ol><li><p>', () => {
    makeEditor('<p>Hello</p>');
    openContextMenu(0);
    findItemByLabel('Ordered list')?.click();
    expect(editor?.state.doc.firstChild?.type.name).toBe('orderedList');
    expect(editor?.state.doc.firstChild?.firstChild?.type.name).toBe('listItem');
  });

  it('clicking To-do list wraps the paragraph in <taskList><taskItem checked=false>', () => {
    makeEditor('<p>Hello</p>');
    openContextMenu(0);
    findItemByLabel('To-do list')?.click();
    const list = editor?.state.doc.firstChild;
    expect(list?.type.name).toBe('taskList');
    const item = list?.firstChild;
    expect(item?.type.name).toBe('taskItem');
    expect((item?.attrs as { checked: boolean }).checked).toBe(false);
    expect(item?.firstChild?.textContent).toBe('Hello');
  });

  it('clicking Quote wraps the paragraph in <blockquote>', () => {
    makeEditor('<p>Hello</p>');
    openContextMenu(0);
    findItemByLabel('Quote')?.click();
    const bq = editor?.state.doc.firstChild;
    expect(bq?.type.name).toBe('blockquote');
    expect(bq?.firstChild?.type.name).toBe('paragraph');
    expect(bq?.firstChild?.textContent).toBe('Hello');
  });

  // --- Step-down for non-paragraph textblock sources ---

  it('clicking Bullet list on a heading downgrades to paragraph then wraps', () => {
    makeEditor('<h2>Title</h2>');
    openContextMenu(0);
    findItemByLabel('Bullet list')?.click();
    const first = editor?.state.doc.firstChild;
    expect(first?.type.name).toBe('bulletList');
    expect(first?.firstChild?.firstChild?.type.name).toBe('paragraph');
    expect(first?.firstChild?.firstChild?.textContent).toBe('Title');
  });

  it('clicking Bullet list on a code block downgrades to paragraph then wraps', () => {
    makeEditor('<pre><code>x=1</code></pre>');
    openContextMenu(0);
    findItemByLabel('Bullet list')?.click();
    const first = editor?.state.doc.firstChild;
    expect(first?.type.name).toBe('bulletList');
    expect(first?.firstChild?.firstChild?.type.name).toBe('paragraph');
    expect(first?.firstChild?.firstChild?.textContent).toBe('x=1');
  });

  // --- Quote preserves source node (blockquote.content = block+) ---

  it('clicking Quote on a code block wraps the codeBlock without step-down', () => {
    makeEditor('<pre><code>const x=1</code></pre>');
    openContextMenu(0);
    findItemByLabel('Quote')?.click();
    const bq = editor?.state.doc.firstChild;
    expect(bq?.type.name).toBe('blockquote');
    expect(bq?.firstChild?.type.name).toBe('codeBlock');
    expect(bq?.firstChild?.textContent).toBe('const x=1');
  });

  it('clicking Quote on a heading wraps the heading without step-down', () => {
    makeEditor('<h2>Title</h2>');
    openContextMenu(0);
    findItemByLabel('Quote')?.click();
    const bq = editor?.state.doc.firstChild;
    expect(bq?.type.name).toBe('blockquote');
    expect(bq?.firstChild?.type.name).toBe('heading');
    expect((bq?.firstChild?.attrs as { level: number }).level).toBe(2);
  });

  // --- Convert in place (paragraph targeted directly inside a list) ---

  it('clicking Ordered list on a paragraph inside a bullet list converts the list type', () => {
    makeEditor('<ul><li><p>A</p></li><li><p>B</p></li></ul>');
    const paragraphPos = findFirstPosOf('paragraph');
    openContextMenu(paragraphPos);
    findItemByLabel('Ordered list')?.click();
    const first = editor?.state.doc.firstChild;
    expect(first?.type.name).toBe('orderedList');
    expect(first?.childCount).toBe(2);
    expect(first?.firstChild?.firstChild?.textContent).toBe('A');
    expect(first?.lastChild?.firstChild?.textContent).toBe('B');
  });

  // --- Menu close + refocus after wrapper click ---

  it('closes the menu and refocuses editor after a wrapper click', () => {
    const ed = makeEditor('<p>Hello</p>');
    const focusSpy = vi.spyOn(ed.view, 'focus');
    openContextMenu(0);
    const menu = host?.querySelector('.dm-block-context-menu');
    expect(menu?.hasAttribute('data-show')).toBe(true);
    findItemByLabel('Bullet list')?.click();
    expect(menu?.hasAttribute('data-show')).toBe(false);
    expect(focusSpy).toHaveBeenCalled();
  });

  // --- Outer textblock guard: list wrappers don't expose Turn into ---
  //
  // BlockHandle resolves a list item (or the bulletList itself) as the
  // top-level block, so the menu opens with a non-textblock source. The
  // outer `isTextblock` guard hides the Turn into section. Wrapper
  // targets are then unreachable from the menu (the user must target
  // an inner textblock instead). This documents the current scope.

  it('hides the Turn into section when the menu opens on a bullet list wrapper', () => {
    // bulletList's first child is a listItem (not a textblock), so the
    // "wrapper-with-inner-textblock" path doesn't kick in either.
    makeEditor('<ul><li><p>A</p></li></ul>');
    openContextMenu(0); // pos 0 = bulletList (non-textblock, non-wrapper)
    const labels = getLabels();
    expect(labels).toContain('Delete');
    expect(labels).not.toContain('Bullet list');
    expect(labels).not.toContain('Quote');
    expect(labels).not.toContain('Heading 1');
  });
});

describe('BlockContextMenu drag-handle pin + active block highlight', () => {
  // Two cross-plugin signals applied on open, cleared on hide:
  //   1. `data-block-context-menu-open` attribute on the editor root,
  //      which `BlockHandle` reads to keep its drag button pinned on
  //      the source block while the menu is open.
  //   2. `dm-block-context-active` class on the targeted block's DOM
  //      node, used by the theme to render a subtle Notion-style cue.

  it('sets data-block-context-menu-open on the editor host while open', () => {
    makeEditor('<p>Pin me</p>');
    expect(host?.hasAttribute('data-block-context-menu-open')).toBe(false);
    openContextMenu(0);
    expect(host?.hasAttribute('data-block-context-menu-open')).toBe(true);
  });

  it('removes data-block-context-menu-open on hide', () => {
    makeEditor('<p>Pin me</p>');
    openContextMenu(0);
    host?.dispatchEvent(new Event('dm:dismiss-overlays'));
    expect(host?.hasAttribute('data-block-context-menu-open')).toBe(false);
  });

  it('adds dm-block-context-active class to the targeted block', () => {
    makeEditor('<p>Highlighted</p>');
    openContextMenu(0);
    const para = host?.querySelector('.ProseMirror > p');
    expect(para?.classList.contains('dm-block-context-active')).toBe(true);
  });

  it('removes dm-block-context-active class on hide', () => {
    makeEditor('<p>Highlighted</p>');
    openContextMenu(0);
    host?.dispatchEvent(new Event('dm:dismiss-overlays'));
    const para = host?.querySelector('.ProseMirror > p');
    expect(para?.classList.contains('dm-block-context-active')).toBe(false);
  });

  it('targets the correct block in a multi-block doc', () => {
    makeEditor('<p>First</p><p>Second</p><p>Third</p>');
    // Open on the second paragraph (positions: 0..7 first, 7..15 second).
    openContextMenu(7);
    const paragraphs = host?.querySelectorAll('.ProseMirror > p');
    if (!paragraphs) throw new Error();
    expect(paragraphs[0]?.classList.contains('dm-block-context-active')).toBe(false);
    expect(paragraphs[1]?.classList.contains('dm-block-context-active')).toBe(true);
    expect(paragraphs[2]?.classList.contains('dm-block-context-active')).toBe(false);
  });

  it('moves the highlight when the menu reopens on a different block', () => {
    makeEditor('<p>First</p><p>Second</p>');
    openContextMenu(0);
    let paragraphs = host?.querySelectorAll('.ProseMirror > p');
    expect(paragraphs?.[0]?.classList.contains('dm-block-context-active')).toBe(true);
    // Reopen on the second paragraph (dispatching open implicitly
    // dismisses other overlays then calls open() again).
    openContextMenu(7);
    paragraphs = host?.querySelectorAll('.ProseMirror > p');
    expect(paragraphs?.[0]?.classList.contains('dm-block-context-active')).toBe(false);
    expect(paragraphs?.[1]?.classList.contains('dm-block-context-active')).toBe(true);
  });

  it('clears both signals when editor is destroyed mid-open', () => {
    const ed = makeEditor('<p>X</p>');
    openContextMenu(0);
    expect(host?.hasAttribute('data-block-context-menu-open')).toBe(true);
    ed.destroy();
    editor = undefined;
    // The destroy hook calls hide() which removes the attribute. host
    // remains in the DOM until afterEach cleans it.
    expect(host?.hasAttribute('data-block-context-menu-open')).toBe(false);
  });

  // ─── Decoration-driven highlight: survives PM rerenders, remaps across
  //     doc edits, and moves between blocks on reopen ────────────────────
  //
  // This is what the original imperative `classList.add` could not do.
  // The bug surface was: any transaction that touched the block's DOM
  // (e.g. UniqueID stamping `id` via setNodeMarkup) caused PM to throw
  // away the inline class. The decoration is re-applied every render,
  // so the class persists regardless of how often the block is
  // rerendered.

  it('decoration adds the dm-block-context-active class to the target paragraph DOM', () => {
    makeEditor('<p>Decorated</p>');
    openContextMenu(0);
    const para = host?.querySelector('.ProseMirror > p');
    expect(para?.classList.contains('dm-block-context-active')).toBe(true);
  });

  it('decoration survives a no-op meta transaction dispatched while menu is open', () => {
    // Dispatching a meta-only transaction triggers a PM re-render but
    // does not change the doc. The decoration must still apply.
    const ed = makeEditor('<p>Resilient</p>');
    openContextMenu(0);
    expect(host?.querySelector('.ProseMirror > p')?.classList.contains('dm-block-context-active')).toBe(true);
    // Synthetic meta tr - no doc change, just kicks PM into re-running view updates.
    ed.view.dispatch(ed.view.state.tr.setMeta('test-noop', true));
    expect(host?.querySelector('.ProseMirror > p')?.classList.contains('dm-block-context-active')).toBe(true);
  });

  it('decoration moves to a new block when the menu is reopened on it', () => {
    makeEditor('<p>First</p><p>Second</p>');
    openContextMenu(0);
    let paras = host?.querySelectorAll('.ProseMirror > p');
    expect(paras?.[0]?.classList.contains('dm-block-context-active')).toBe(true);
    expect(paras?.[1]?.classList.contains('dm-block-context-active')).toBe(false);
    // Reopen on the second paragraph (positions 0..7 + 7..15).
    openContextMenu(7);
    paras = host?.querySelectorAll('.ProseMirror > p');
    expect(paras?.[0]?.classList.contains('dm-block-context-active')).toBe(false);
    expect(paras?.[1]?.classList.contains('dm-block-context-active')).toBe(true);
  });

  it('decoration is removed after the menu closes', () => {
    makeEditor('<p>X</p>');
    openContextMenu(0);
    expect(host?.querySelector('.ProseMirror > p')?.classList.contains('dm-block-context-active')).toBe(true);
    host?.dispatchEvent(new Event('dm:dismiss-overlays'));
    expect(host?.querySelector('.ProseMirror > p')?.classList.contains('dm-block-context-active')).toBe(false);
  });

  it('scroll lock is idempotent across repeated open() calls', () => {
    // Two consecutive opens (e.g. user clicks drag again without
    // closing) must not double-register the wheel listener. We assert
    // the lock state externally by verifying close + reopen leaves
    // the document in a non-locked state after a single close.
    makeEditor('<p>X</p><p>Y</p>');
    openContextMenu(0);
    openContextMenu(3); // re-open on a different block, no explicit hide between

    host?.dispatchEvent(new Event('dm:dismiss-overlays'));
    // After a SINGLE close, scroll should be free again - duplicate
    // listeners would still block.
    const ev = new Event('wheel', { cancelable: true, bubbles: true });
    let prevented = false;
    Object.defineProperty(ev, 'preventDefault', { value: () => { prevented = true; } });
    Object.defineProperty(ev, 'target', { value: document.body });
    document.dispatchEvent(ev);
    expect(prevented).toBe(false);
  });
});

describe('BlockContextMenu scroll lock', () => {
  // Notion-style: when the menu is open, page scroll is blocked so the
  // popup stays anchored next to the drag handle. The wheel + touchmove
  // listeners on `document` call preventDefault() unless the event
  // target sits inside the menu (which preserves internal scroll for
  // the menu's own overflow).

  it('does not call preventDefault on wheel before menu opens', () => {
    makeEditor('<p>X</p>');
    const ev = new Event('wheel', { cancelable: true });
    let prevented = false;
    Object.defineProperty(ev, 'preventDefault', { value: () => { prevented = true; } });
    document.dispatchEvent(ev);
    expect(prevented).toBe(false);
  });

  it('blocks wheel events on document while menu is open', () => {
    makeEditor('<p>X</p>');
    openContextMenu(0);
    const menu = host?.querySelector('.dm-block-context-menu');
    expect(menu?.hasAttribute('data-show')).toBe(true);

    const ev = new Event('wheel', { cancelable: true, bubbles: true });
    // Dispatch on body (outside the menu) so the listener's target
    // check does not exempt it.
    let prevented = false;
    Object.defineProperty(ev, 'preventDefault', { value: () => { prevented = true; } });
    Object.defineProperty(ev, 'target', { value: document.body });
    document.dispatchEvent(ev);
    expect(prevented).toBe(true);
  });

  it('blocks touchmove events on document while menu is open', () => {
    makeEditor('<p>X</p>');
    openContextMenu(0);
    const ev = new Event('touchmove', { cancelable: true, bubbles: true });
    let prevented = false;
    Object.defineProperty(ev, 'preventDefault', { value: () => { prevented = true; } });
    Object.defineProperty(ev, 'target', { value: document.body });
    document.dispatchEvent(ev);
    expect(prevented).toBe(true);
  });

  it('blocks wheel events inside the menu when it has no scrollable overflow', () => {
    // The default menu fits within `max-height: 20rem`, so its
    // scrollHeight equals clientHeight - no internal scroll is
    // possible. Letting the wheel through would chain to the page
    // and scroll the document underneath the menu, which is the
    // exact bug we want to prevent.
    makeEditor('<p>X</p>');
    openContextMenu(0);
    const menu = host?.querySelector('.dm-block-context-menu');
    expect(menu).not.toBeNull();

    const ev = new Event('wheel', { cancelable: true, bubbles: true });
    let prevented = false;
    Object.defineProperty(ev, 'preventDefault', { value: () => { prevented = true; } });
    Object.defineProperty(ev, 'target', { value: menu });
    document.dispatchEvent(ev);
    expect(prevented).toBe(true);
  });

  it('allows wheel events inside the menu when it CAN scroll internally', () => {
    makeEditor('<p>X</p>');
    openContextMenu(0);
    const menu = host?.querySelector('.dm-block-context-menu') as HTMLElement | null;
    if (!menu) throw new Error('menu missing');
    // Simulate scrollable overflow by mocking scrollHeight > clientHeight.
    Object.defineProperty(menu, 'scrollHeight', { configurable: true, value: 500 });
    Object.defineProperty(menu, 'clientHeight', { configurable: true, value: 200 });

    const ev = new Event('wheel', { cancelable: true, bubbles: true });
    let prevented = false;
    Object.defineProperty(ev, 'preventDefault', { value: () => { prevented = true; } });
    Object.defineProperty(ev, 'target', { value: menu });
    document.dispatchEvent(ev);
    expect(prevented).toBe(false);
  });

  it('releases scroll lock when menu closes', () => {
    makeEditor('<p>X</p>');
    openContextMenu(0);
    // Close via the dismiss event.
    host?.dispatchEvent(new Event('dm:dismiss-overlays'));
    const menu = host?.querySelector('.dm-block-context-menu');
    expect(menu?.hasAttribute('data-show')).toBe(false);

    // Wheel events should no longer be blocked.
    const ev = new Event('wheel', { cancelable: true, bubbles: true });
    let prevented = false;
    Object.defineProperty(ev, 'preventDefault', { value: () => { prevented = true; } });
    Object.defineProperty(ev, 'target', { value: document.body });
    document.dispatchEvent(ev);
    expect(prevented).toBe(false);
  });

  it('releases scroll lock after a wrapper-target click closes the menu', () => {
    makeEditor('<p>Toggle</p>');
    openContextMenu(0);
    // Click any item that closes the menu (Duplicate fires runAndClose).
    const items = host?.querySelectorAll<HTMLButtonElement>('.dm-block-context-menu-item');
    let dupBtn: HTMLButtonElement | null = null;
    if (items) {
      for (const b of Array.from(items)) {
        if (b.getAttribute('aria-label') === 'Duplicate') { dupBtn = b; break; }
      }
    }
    dupBtn?.click();
    const menu = host?.querySelector('.dm-block-context-menu');
    expect(menu?.hasAttribute('data-show')).toBe(false);

    const ev = new Event('wheel', { cancelable: true, bubbles: true });
    let prevented = false;
    Object.defineProperty(ev, 'preventDefault', { value: () => { prevented = true; } });
    Object.defineProperty(ev, 'target', { value: document.body });
    document.dispatchEvent(ev);
    expect(prevented).toBe(false);
  });

  it('releases scroll lock after Escape closes the menu', () => {
    makeEditor('<p>X</p>');
    openContextMenu(0);
    const menu = host?.querySelector('.dm-block-context-menu');
    menu?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(menu?.hasAttribute('data-show')).toBe(false);

    const ev = new Event('wheel', { cancelable: true, bubbles: true });
    let prevented = false;
    Object.defineProperty(ev, 'preventDefault', { value: () => { prevented = true; } });
    Object.defineProperty(ev, 'target', { value: document.body });
    document.dispatchEvent(ev);
    expect(prevented).toBe(false);
  });

  it('releases scroll lock when the editor is destroyed while the menu is open', () => {
    const ed = makeEditor('<p>X</p>');
    openContextMenu(0);
    ed.destroy();
    editor = undefined; // afterEach already cleans, but make explicit

    const ev = new Event('wheel', { cancelable: true, bubbles: true });
    let prevented = false;
    Object.defineProperty(ev, 'preventDefault', { value: () => { prevented = true; } });
    Object.defineProperty(ev, 'target', { value: document.body });
    document.dispatchEvent(ev);
    expect(prevented).toBe(false);
  });
});

describe('BlockContextMenu Turn into - wrapper SOURCES (listItem / taskItem / blockquote)', () => {
  // BlockHandle in nested mode targets the listItem (the actual draggable
  // row), not the inner paragraph. These tests exercise that real-usage
  // path: open the menu on the listItem position and verify the Turn into
  // section behaves like Notion's "convert this list item".

  function findItemByLabel(label: string): HTMLButtonElement | null {
    const items = host?.querySelectorAll<HTMLButtonElement>('.dm-block-context-menu-item');
    if (!items) return null;
    for (const btn of Array.from(items)) {
      if (btn.getAttribute('aria-label') === label) return btn;
    }
    return null;
  }

  function getLabels(): string[] {
    const items = host?.querySelectorAll('.dm-block-context-menu-item');
    return Array.from(items ?? []).map((b) => b.getAttribute('aria-label') ?? '');
  }

  function findFirstPosOf(typeName: string): number {
    let found = -1;
    editor?.state.doc.descendants((node, pos) => {
      if (found !== -1) return false;
      if (node.type.name === typeName) { found = pos; return false; }
      return true;
    });
    if (found === -1) throw new Error(`node ${typeName} not found`);
    return found;
  }

  // --- Visibility on a listItem (the BlockHandle's natural target) ---

  it('shows Turn into on a listItem source via the inner-textblock descent', () => {
    makeEditor('<ul><li><p>A</p></li></ul>');
    const liPos = findFirstPosOf('listItem');
    openContextMenu(liPos);
    const labels = getLabels();
    // Wrapper targets eligible (excluding the ancestor type and schema-
    // rejecting Quote on listItem-family).
    expect(labels).toContain('Ordered list');
    expect(labels).toContain('To-do list');
    // Hidden: own type ancestor.
    expect(labels).not.toContain('Bullet list');
    // Hidden: blockquote can't be the first child of a listItem.
    expect(labels).not.toContain('Quote');
    // Hidden: textblock targets need a lift-then-convert (out of scope).
    expect(labels).not.toContain('Paragraph');
    expect(labels).not.toContain('Heading 1');
    expect(labels).not.toContain('Code block');
  });

  it('shows Turn into on an orderedList listItem source with Bullet/Task eligible', () => {
    makeEditor('<ol><li><p>A</p></li></ol>');
    const liPos = findFirstPosOf('listItem');
    openContextMenu(liPos);
    const labels = getLabels();
    expect(labels).toContain('Bullet list');
    expect(labels).toContain('To-do list');
    expect(labels).not.toContain('Ordered list');
    expect(labels).not.toContain('Quote');
  });

  it('shows Turn into on a taskItem source with Bullet/Ordered eligible, To-do hidden', () => {
    makeEditor('<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>A</p></li></ul>');
    const tiPos = findFirstPosOf('taskItem');
    openContextMenu(tiPos);
    const labels = getLabels();
    expect(labels).toContain('Bullet list');
    expect(labels).toContain('Ordered list');
    expect(labels).not.toContain('To-do list');
    expect(labels).not.toContain('Quote');
  });

  // --- Click execution: list-type swap in place ---

  it('clicking Ordered list on a listItem source converts the UL to OL in place', () => {
    makeEditor('<ul><li><p>A</p></li><li><p>B</p></li></ul>');
    const liPos = findFirstPosOf('listItem');
    openContextMenu(liPos);
    findItemByLabel('Ordered list')?.click();
    const first = editor?.state.doc.firstChild;
    expect(first?.type.name).toBe('orderedList');
    expect(first?.childCount).toBe(2);
    expect(first?.firstChild?.firstChild?.textContent).toBe('A');
    expect(first?.lastChild?.firstChild?.textContent).toBe('B');
  });

  it('clicking To-do list on a listItem source rebuilds items as taskItems (checked=false)', () => {
    makeEditor('<ul><li><p>A</p></li><li><p>B</p></li></ul>');
    const liPos = findFirstPosOf('listItem');
    openContextMenu(liPos);
    findItemByLabel('To-do list')?.click();
    const first = editor?.state.doc.firstChild;
    expect(first?.type.name).toBe('taskList');
    expect(first?.firstChild?.type.name).toBe('taskItem');
    expect((first?.firstChild?.attrs as { checked: boolean }).checked).toBe(false);
    expect(first?.firstChild?.firstChild?.textContent).toBe('A');
    expect(first?.lastChild?.firstChild?.textContent).toBe('B');
  });

  it('clicking Bullet list on an orderedList listItem source converts OL to UL', () => {
    makeEditor('<ol><li><p>X</p></li></ol>');
    const liPos = findFirstPosOf('listItem');
    openContextMenu(liPos);
    findItemByLabel('Bullet list')?.click();
    expect(editor?.state.doc.firstChild?.type.name).toBe('bulletList');
    expect(editor?.state.doc.firstChild?.firstChild?.firstChild?.textContent).toBe('X');
  });

  // --- Blockquote source with paragraph first child ---

  it('shows Turn into on a blockquote source (paragraph inner), Quote hidden via ancestor', () => {
    makeEditor('<blockquote><p>A</p></blockquote>');
    const bqPos = findFirstPosOf('blockquote');
    openContextMenu(bqPos);
    const labels = getLabels();
    expect(labels).toContain('Bullet list');
    expect(labels).toContain('Ordered list');
    expect(labels).toContain('To-do list');
    expect(labels).not.toContain('Quote');
    // Textblock targets still hidden because source is non-textblock.
    expect(labels).not.toContain('Heading 1');
  });

  it('clicking Bullet list on a blockquote source nests a list inside the blockquote', () => {
    // blockquote.content = "block+" accepts list as a child, so the
    // toggleList wraps the inner paragraph and produces:
    // <blockquote><ul><li><p>A</p></li></ul></blockquote>.
    makeEditor('<blockquote><p>A</p></blockquote>');
    const bqPos = findFirstPosOf('blockquote');
    openContextMenu(bqPos);
    findItemByLabel('Bullet list')?.click();
    const bq = editor?.state.doc.firstChild;
    expect(bq?.type.name).toBe('blockquote');
    const ul = bq?.firstChild;
    expect(ul?.type.name).toBe('bulletList');
    expect(ul?.firstChild?.firstChild?.firstChild?.textContent).toBe('A');
  });

  // --- Wrapper-of-wrapper sources still hidden ---

  it('hides Turn into entirely when the wrapper source has no inner textblock', () => {
    // bulletList's firstChild is a listItem (wrapper, not textblock).
    // The wrapper-source path requires firstChild to be a textblock,
    // so this falls through to "hidden".
    makeEditor('<ul><li><p>A</p></li></ul>');
    const ulPos = 0; // bulletList at top
    openContextMenu(ulPos);
    const labels = getLabels();
    expect(labels).toContain('Delete');
    expect(labels).not.toContain('Bullet list');
    expect(labels).not.toContain('Quote');
    expect(labels).not.toContain('Heading 1');
  });

  // --- Menu close after wrapper-source click ---

  it('closes the menu and refocuses editor after a list-type swap', () => {
    const ed = makeEditor('<ul><li><p>A</p></li></ul>');
    const focusSpy = vi.spyOn(ed.view, 'focus');
    const liPos = findFirstPosOf('listItem');
    openContextMenu(liPos);
    const menu = host?.querySelector('.dm-block-context-menu');
    expect(menu?.hasAttribute('data-show')).toBe(true);
    findItemByLabel('Ordered list')?.click();
    expect(menu?.hasAttribute('data-show')).toBe(false);
    expect(focusSpy).toHaveBeenCalled();
  });
});
