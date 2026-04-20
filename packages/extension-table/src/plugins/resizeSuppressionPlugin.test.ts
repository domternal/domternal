import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { Document, Text, Paragraph, Editor } from '@domternal/core';
import { columnResizingPluginKey } from '@domternal/pm/tables';
import { Table } from '../Table.js';
import { TableRow } from '../TableRow.js';
import { TableCell } from '../TableCell.js';
import { TableHeader } from '../TableHeader.js';

const allExtensions = [Document, Text, Paragraph, Table, TableRow, TableCell, TableHeader];

describe('resizeSuppressionPlugin', () => {
  let editor: Editor;
  let host: HTMLElement;

  beforeEach(() => {
    // jsdom doesn't implement elementFromPoint, which ProseMirror's internal
    // mousedown handler uses. Shim it so dispatched mousedown events
    // don't crash the view's own handler (ours runs independently).
    (document as any).elementFromPoint = () => null;

    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    if (editor && !editor.isDestroyed) editor.destroy();
    host.remove();
  });

  describe('mousedown handler', () => {
    it('returns false when button is not 0 (right-click)', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const priorHasClass = editor.view.dom.classList.contains('dm-mouse-drag');

      // Fire mousedown with button=2 (right-click)
      const event = new MouseEvent('mousedown', { bubbles: true, button: 2 });
      editor.view.dom.dispatchEvent(event);

      // Should NOT add dm-mouse-drag class
      expect(editor.view.dom.classList.contains('dm-mouse-drag')).toBe(priorHasClass);
    });

    it('adds dm-mouse-drag class on left-click mousedown when not resizing', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });

      const event = new MouseEvent('mousedown', { bubbles: true, button: 0 });
      editor.view.dom.dispatchEvent(event);

      expect(editor.view.dom.classList.contains('dm-mouse-drag')).toBe(true);
    });

    it('removes dm-mouse-drag class on mouseup', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });

      const mousedown = new MouseEvent('mousedown', { bubbles: true, button: 0 });
      editor.view.dom.dispatchEvent(mousedown);
      expect(editor.view.dom.classList.contains('dm-mouse-drag')).toBe(true);

      const mouseup = new MouseEvent('mouseup', { bubbles: true });
      document.dispatchEvent(mouseup);
      expect(editor.view.dom.classList.contains('dm-mouse-drag')).toBe(false);
    });

    it('does not throw when resizeState is null (no columnResizing active)', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });

      // Normal mousedown with no resize in progress
      const event = new MouseEvent('mousedown', { bubbles: true, button: 0 });
      expect(() => editor.view.dom.dispatchEvent(event)).not.toThrow();
    });
  });

  describe('mousemove handler', () => {
    it('returns false when buttons is 0 (not dragging)', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });

      const event = new MouseEvent('mousemove', { bubbles: true, buttons: 0 });
      // Should not throw
      expect(() => editor.view.dom.dispatchEvent(event)).not.toThrow();
    });

    it('processes mousemove when button is pressed', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });

      const event = new MouseEvent('mousemove', { bubbles: true, buttons: 1 });
      expect(() => editor.view.dom.dispatchEvent(event)).not.toThrow();
    });

    it('allows columnResizing during active resize drag (dragging state)', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });

      // Directly manipulate state to simulate dragging
      editor.view.dispatch(
        editor.state.tr.setMeta(columnResizingPluginKey, {
          setDragging: { startX: 100, startWidth: 200 },
        }),
      );

      // mousemove during drag - should return false (allow columnResizing)
      const event = new MouseEvent('mousemove', { bubbles: true, buttons: 1 });
      expect(() => editor.view.dom.dispatchEvent(event)).not.toThrow();
    });
  });

  describe('createResizeSuppressionPlugin with different resize behaviors', () => {
    it('independent mode plugin instantiates and handles normal mousedown', () => {
      const TableIndependent = Table.configure({ resizeBehavior: 'independent' });
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, TableIndependent, TableRow, TableCell, TableHeader],
        content: '<table><tr><td data-colwidth="150"><p>A</p></td><td data-colwidth="150"><p>B</p></td></tr></table>',
      });

      const event = new MouseEvent('mousedown', { bubbles: true, button: 0 });
      expect(() => editor.view.dom.dispatchEvent(event)).not.toThrow();
      expect(editor.view.dom.classList.contains('dm-mouse-drag')).toBe(true);
    });

    it('redistribute mode plugin instantiates and handles normal mousedown', () => {
      const TableRedistribute = Table.configure({ resizeBehavior: 'redistribute' });
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, TableRedistribute, TableRow, TableCell, TableHeader],
        content: '<table><tr><td><p>A</p></td><td><p>B</p></td></tr></table>',
      });

      const event = new MouseEvent('mousedown', { bubbles: true, button: 0 });
      expect(() => editor.view.dom.dispatchEvent(event)).not.toThrow();
      expect(editor.view.dom.classList.contains('dm-mouse-drag')).toBe(true);
    });
  });
});
