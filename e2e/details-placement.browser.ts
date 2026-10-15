import { expect } from '@playwright/test';
import type { Editor } from '@domternal/core';
import { test } from './fixtures.js';

interface ProbeWindow { __pasteCleanup: { ready: boolean; editor: Editor; select: (from: number, to?: number) => void; closeHistory: () => void; selectNode: (pos: number) => void } }
const source = '<details><summary>Title</summary><div data-details-content><p>body</p><p>after</p></div></details>';

for (const framework of ['vanilla', 'react', 'vue', 'angular']) {
  test(`${framework} replaces a summary to body selection without splitting the disclosure`, async ({ page }) => {
    for (const cleanup of ['on', 'off']) {
      await page.goto(`http://127.0.0.1:5895/?framework=${framework}&details=1&unique-id=off&paste-cleanup=${cleanup}`);
      await page.waitForFunction(() => (window as unknown as Partial<ProbeWindow>).__pasteCleanup?.ready);
      for (const clipboard of [{ html: '<p>a</p><p>b</p>', text: 'a\nb' }, { html: '', text: '# Head\n\n- one' }]) {
        const result = await page.evaluate(({ seed, clipboard }) => {
          const { editor, select, closeHistory } = (window as unknown as ProbeWindow).__pasteCleanup;
          editor.setContent(seed, false);
          select(4, 12);
          closeHistory();
          const before = JSON.stringify(editor.state.doc.toJSON());
          const selection = JSON.stringify(editor.state.selection.toJSON());
          const data = new DataTransfer();
          if (clipboard.html) data.setData('text/html', clipboard.html);
          data.setData('text/plain', clipboard.text);
          const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data });
          if (event.clipboardData !== data) Object.defineProperty(event, 'clipboardData', { value: data });
          editor.view.dom.dispatchEvent(event);
          editor.state.doc.check();
          const doc = editor.state.doc.toString();
          const open = editor.view.dom.querySelector('[data-type="details"]')?.classList.contains('is-open');
          const count = editor.view.dom.querySelectorAll('[data-type="details"]').length;
          const undo = editor.commands.undo();
          const restored = JSON.stringify(editor.state.doc.toJSON());
          const restoredSelection = JSON.stringify(editor.state.selection.toJSON());
          const redo = editor.commands.redo();
          return { doc, open, count, undo, redo, before, selection, restored, restoredSelection, replayed: editor.state.doc.toString() };
        }, { seed: source, clipboard });
        const expected = clipboard.html
          ? 'doc(details(detailsSummary("Ti"), detailsContent(paragraph("a"), paragraph("bdy"), paragraph("after"))))'
          : 'doc(details(detailsSummary("Ti"), detailsContent(heading("Head"), bulletList(listItem(paragraph("one"))), paragraph("dy"), paragraph("after"))))';
        expect(result.doc, `${cleanup} ${clipboard.text}`).toBe(expected);
        expect(result).toMatchObject({ open: true, count: 1, undo: true, redo: true });
        expect(result.restored).toEqual(result.before);
        expect(result.restoredSelection).toEqual(result.selection);
        expect(result.replayed).toBe(expected);
      }
    }
  });

  test(`${framework} copies and moves dropped blocks into the disclosure body in one undo`, async ({ page }) => {
    await page.goto(`http://127.0.0.1:5895/?framework=${framework}&details=1&unique-id=off`);
    await page.waitForFunction(() => (window as unknown as Partial<ProbeWindow>).__pasteCleanup?.ready);
    for (const mode of ['copy', 'move']) {
      const result = await page.evaluate(({ seed, mode }) => {
        const { editor, select, selectNode, closeHistory } = (window as unknown as ProbeWindow).__pasteCleanup;
        editor.setContent('<p>moved</p>' + seed, false);
        if (mode === 'move') {
          selectNode(0);
          editor.view.dragging = { slice: editor.state.selection.content(), move: true };
        } else select(1, 6);
        closeHistory();
        const before = JSON.stringify(editor.state.doc.toJSON());
        const summary = editor.view.dom.querySelector('summary');
        if (summary === null) throw new Error('Missing fixture summary');
        const box = summary.getBoundingClientRect();
        const data = new DataTransfer();
        data.setData('text/html', '<p>a</p><p>b</p>');
        data.setData('text/plain', 'a\nb');
        const event = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data,
          clientX: box.left + Math.min(15, box.width / 2), clientY: box.top + box.height / 2 });
        editor.view.dom.dispatchEvent(event);
        editor.state.doc.check();
        const doc = editor.state.doc.toString();
        const open = editor.view.dom.querySelector('[data-type="details"]')?.classList.contains('is-open');
        const undo = editor.commands.undo();
        const restored = JSON.stringify(editor.state.doc.toJSON());
        const redo = editor.commands.redo();
        return { doc, open, handled: event.defaultPrevented, undo, redo, before, restored, replayed: editor.state.doc.toString() };
      }, { seed: source, mode });
      const expected = mode === 'copy'
        ? 'doc(paragraph("moved"), details(detailsSummary("Title"), detailsContent(paragraph("a"), paragraph("b"), paragraph("body"), paragraph("after"))))'
        : 'doc(details(detailsSummary("Title"), detailsContent(paragraph("moved"), paragraph("body"), paragraph("after"))))';
      expect(result.doc, mode).toBe(expected);
      expect(result).toMatchObject({ open: true, handled: true, undo: true, redo: true });
      expect(result.restored).toEqual(result.before);
      expect(result.replayed).toBe(expected);
    }
  });
}
