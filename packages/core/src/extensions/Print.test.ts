/**
 * The Print extension's contract.
 *
 * Most of what makes printing look right is CSS, and CSS is covered by the
 * e2e matrix against a real print rendering. What lives here is the part
 * that is pure behaviour: the command must not dispatch, it must not open a
 * dialog during a `can()` probe, it must mark exactly the ancestor chain the
 * stylesheet keys off, and it must leave the DOM as it found it afterwards,
 * including when `window.print()` throws.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Editor } from '../Editor.js';
import { Document } from '../nodes/Document.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Text } from '../nodes/Text.js';
import { Print } from './Print.js';

const editors: Editor[] = [];

/**
 * Builds the shape a framework wrapper produces: a host element, a
 * `.dm-editor` wrapper inside it, and the ProseMirror element inside that.
 */
function createEditor(options: { isolateNativePrint?: boolean } = {}): {
  editor: Editor;
  host: HTMLElement;
  wrapper: HTMLElement;
} {
  const host = document.createElement('div');
  host.className = 'app-shell';
  const sibling = document.createElement('nav');
  sibling.className = 'app-sidebar';
  const wrapper = document.createElement('div');
  wrapper.className = 'dm-editor';
  host.append(sibling, wrapper);
  document.body.appendChild(host);

  const editor = new Editor({
    element: wrapper,
    extensions: [
      Document,
      Paragraph,
      Text,
      options.isolateNativePrint === true
        ? Print.configure({ isolateNativePrint: true })
        : Print,
    ],
    content: '<p>Paper</p>',
  });
  editors.push(editor);
  return { editor, host, wrapper };
}

afterEach(() => {
  while (editors.length > 0) editors.pop()?.destroy();
  document.body.innerHTML = '';
  document.body.className = '';
  vi.restoreAllMocks();
});

describe('configuration', () => {
  it('is an extension named print', () => {
    expect(Print.name).toBe('print');
    expect(Print.type).toBe('extension');
  });

  it('offers a toolbar button that survives a read-only editor', () => {
    const items = Print.config.addToolbarItems?.call({
      options: { toolbar: true },
    } as never);
    expect(items).toHaveLength(1);
    const button = items?.[0];
    expect(button?.type).toBe('button');
    if (button?.type === 'button') {
      expect(button.name).toBe('print');
      expect(button.command).toBe('printDocument');
      expect(button.icon).toBe('printer');
      // Reading a document out to paper is not editing it.
      expect(button.allowReadOnly).toBe(true);
    }
  });

  it('contributes no toolbar item when the host turns it off', () => {
    const items = Print.config.addToolbarItems?.call({
      options: { toolbar: false },
    } as never);
    expect(items).toEqual([]);
  });
});

describe('printDocument', () => {
  it('opens the print dialog and reports success', () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { editor } = createEditor();

    expect(editor.commands.printDocument()).toBe(true);
    expect(print).toHaveBeenCalledTimes(1);
  });

  it('leaves the document untouched', () => {
    vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { editor } = createEditor();
    const before = editor.getJSON();

    editor.commands.printDocument();

    expect(editor.getJSON()).toEqual(before);
  });

  it('does not print during a can() probe', () => {
    // A dry run decides whether the button is enabled. If it printed, merely
    // rendering a toolbar would open a dialog.
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { editor } = createEditor();

    expect(editor.can().printDocument()).toBe(true);
    expect(print).not.toHaveBeenCalled();
  });

  it('marks the editor, every ancestor and the body while printing', () => {
    const { editor, host, wrapper } = createEditor();
    let seen: string[] = [];
    vi.spyOn(window, 'print').mockImplementation(() => {
      seen = [
        wrapper.classList.contains('dm-print-root') ? 'root' : '',
        host.classList.contains('dm-print-ancestor') ? 'host' : '',
        document.body.classList.contains('dm-print-ancestor') ? 'body-ancestor' : '',
        document.documentElement.classList.contains('dm-print-ancestor') ? 'html' : '',
        document.body.classList.contains('dm-printing') ? 'printing' : '',
      ].filter(Boolean);
    });

    editor.commands.printDocument();

    expect(seen).toEqual(['root', 'host', 'body-ancestor', 'html', 'printing']);
  });

  it('never marks a sibling of the editor', () => {
    // The whole isolation trick is that unmarked children of a marked
    // ancestor are the ones the stylesheet hides.
    const { editor, host } = createEditor();
    const sidebar = host.querySelector('.app-sidebar');
    let marked = true;
    vi.spyOn(window, 'print').mockImplementation(() => {
      marked =
        sidebar?.classList.contains('dm-print-ancestor') === true ||
        sidebar?.classList.contains('dm-print-root') === true;
    });

    editor.commands.printDocument();

    expect(marked).toBe(false);
  });

  it('removes every mark once the dialog closes', () => {
    vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { editor } = createEditor();

    editor.commands.printDocument();

    expect(document.querySelectorAll('.dm-print-root, .dm-print-ancestor')).toHaveLength(0);
    expect(document.body.classList.contains('dm-printing')).toBe(false);
  });

  it('removes every mark even when the dialog throws', () => {
    // A browser that blocks printing must not leave the page in the state
    // where everything but the editor is hidden.
    vi.spyOn(window, 'print').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { editor } = createEditor();

    expect(() => editor.commands.printDocument()).toThrow('blocked');

    expect(document.querySelectorAll('.dm-print-root, .dm-print-ancestor')).toHaveLength(0);
    expect(document.body.classList.contains('dm-printing')).toBe(false);
  });

  it('removes every mark even when a beforePrint listener throws', () => {
    // The pro export package hangs page rules off this event. A listener that
    // fails must not leave the page in the state where everything but the
    // editor is hidden.
    vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { editor } = createEditor();
    editor.on('beforePrint', () => {
      throw new Error('listener blew up');
    });

    expect(() => editor.commands.printDocument()).toThrow('listener blew up');

    expect(document.querySelectorAll('.dm-print-root, .dm-print-ancestor')).toHaveLength(0);
    expect(document.body.classList.contains('dm-printing')).toBe(false);
  });

  it('announces beforePrint with the root, then afterPrint', () => {
    vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { editor, wrapper } = createEditor();
    const order: string[] = [];
    let announcedRoot: HTMLElement | null = null;
    editor.on('beforePrint', (payload) => {
      order.push('before');
      announcedRoot = payload.root;
    });
    editor.on('afterPrint', () => order.push('after'));

    editor.commands.printDocument();

    expect(order).toEqual(['before', 'after']);
    expect(announcedRoot).toBe(wrapper);
  });

  it('lets a host name its own print root', () => {
    const custom = document.createElement('section');
    document.body.appendChild(custom);
    const element = document.createElement('div');
    element.className = 'dm-editor';
    custom.appendChild(element);
    const editor = new Editor({
      element,
      extensions: [Document, Paragraph, Text, Print.configure({ root: () => custom })],
      content: '<p>Paper</p>',
    });
    editors.push(editor);

    let wasRoot = false;
    vi.spyOn(window, 'print').mockImplementation(() => {
      wasRoot = custom.classList.contains('dm-print-root');
    });

    editor.commands.printDocument();

    expect(wasRoot).toBe(true);
  });
});

describe('native print isolation', () => {
  it('stays out of the browser dialog by default', () => {
    createEditor();

    window.dispatchEvent(new Event('beforeprint'));

    // An editor embedded in an article must not erase the article when the
    // reader prints the page.
    expect(document.body.classList.contains('dm-printing')).toBe(false);
  });

  it('isolates on the browser dialog when the host opts in', () => {
    const { wrapper } = createEditor({ isolateNativePrint: true });

    window.dispatchEvent(new Event('beforeprint'));
    expect(wrapper.classList.contains('dm-print-root')).toBe(true);
    expect(document.body.classList.contains('dm-printing')).toBe(true);

    window.dispatchEvent(new Event('afterprint'));
    expect(document.body.classList.contains('dm-printing')).toBe(false);
  });

  it('announces beforePrint once per print, not twice', () => {
    // window.print() fires the window's own beforeprint event, so the native
    // listener runs INSIDE a command-driven print. A second announcement is
    // not cosmetic: the pro export package saves document.title on that
    // event, and a second save captures the title it just wrote.
    const { editor } = createEditor({ isolateNativePrint: true });
    let announced = 0;
    editor.on('beforePrint', () => {
      announced += 1;
    });
    vi.spyOn(window, 'print').mockImplementation(() => {
      window.dispatchEvent(new Event('beforeprint'));
    });

    editor.commands.printDocument();

    expect(announced).toBe(1);
    expect(document.body.classList.contains('dm-printing')).toBe(false);
  });

  it('ignores a stray afterprint that follows no print', () => {
    createEditor({ isolateNativePrint: true });

    window.dispatchEvent(new Event('afterprint'));

    // Nothing to clean up, and nothing to announce.
    expect(document.body.classList.contains('dm-printing')).toBe(false);
  });

  it('stops listening once the editor is destroyed', () => {
    const { editor, wrapper } = createEditor({ isolateNativePrint: true });

    editor.destroy();
    editors.pop();
    window.dispatchEvent(new Event('beforeprint'));

    expect(wrapper.classList.contains('dm-print-root')).toBe(false);
    expect(document.body.classList.contains('dm-printing')).toBe(false);
  });
});
