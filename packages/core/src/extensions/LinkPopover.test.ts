/**
 * Tests for LinkPopover extension
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { TextSelection } from '@domternal/pm/state';
import { LinkPopover } from './LinkPopover.js';
import { Link } from '../marks/Link.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Editor } from '../Editor.js';

const allExtensions = [Document, Text, Paragraph, Link, LinkPopover];

// Shim for floating-ui in jsdom (ProseMirror uses it for positioning)
Element.prototype.getClientRects = function () {
  return [] as unknown as DOMRectList;
};

describe('LinkPopover', () => {
  let editor: Editor | undefined;
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    if (editor && !editor.isDestroyed) editor.destroy();
    host.remove();
    document.querySelectorAll('.dm-link-popover').forEach((el) => { el.remove(); });
  });

  describe('configuration', () => {
    it('has correct name', () => {
      expect(LinkPopover.name).toBe('linkPopover');
    });

    it('is an extension type', () => {
      expect(LinkPopover.type).toBe('extension');
    });

    it('has default options', () => {
      expect(LinkPopover.options).toEqual({
        protocols: ['http:', 'https:', 'mailto:', 'tel:'],
      });
    });

    it('can configure protocols', () => {
      const Custom = LinkPopover.configure({ protocols: ['https:'] });
      expect(Custom.options.protocols).toEqual(['https:']);
    });
  });

  describe('plugin creates DOM elements', () => {
    it('creates a .dm-link-popover container', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<p>Hello</p>',
      });
      const popover = document.querySelector('.dm-link-popover');
      expect(popover).not.toBeNull();
    });

    it('popover contains URL input, apply button, remove button', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<p>Hello</p>',
      });
      const popover = document.querySelector('.dm-link-popover')!;
      expect(popover.querySelector('input[type="url"]')).not.toBeNull();
      expect(popover.querySelector<HTMLButtonElement>('.dm-link-popover-apply')).not.toBeNull();
      expect(popover.querySelector<HTMLButtonElement>('.dm-link-popover-remove')).not.toBeNull();
    });

    it('input has aria-label "URL"', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<p>Hello</p>',
      });
      const input = document.querySelector<HTMLInputElement>('.dm-link-popover-input');
      expect(input?.getAttribute('aria-label')).toBe('URL');
    });
  });

  describe('show/hide via linkEdit event', () => {
    it('show fires on linkEdit event', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<p>Hello</p>',
      });

      // Pass anchorElement so floating-ui uses a real element (jsdom-compatible)
      const anchor = document.createElement('button');
      host.appendChild(anchor);
      (editor as any).emit('linkEdit', { anchorElement: anchor });

      const popover = document.querySelector('.dm-link-popover')!;
      expect(popover.getAttribute('data-show')).toBe('');
    });

    it('hide fires on second linkEdit event (toggle)', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<p>Hello</p>',
      });

      // Pass anchorElement so floating-ui uses a real element (jsdom-compatible)
      const anchor = document.createElement('button');
      host.appendChild(anchor);
      (editor as any).emit('linkEdit', { anchorElement: anchor });
      const popover = document.querySelector('.dm-link-popover')!;
      expect(popover.getAttribute('data-show')).toBe('');

      // Toggle off (same anchor)
      (editor as any).emit('linkEdit', { anchorElement: anchor });
      expect(popover.hasAttribute('data-show')).toBe(false);
    });

    it('shows existing link URL when cursor is on a link', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<p><a href="https://example.com">link</a></p>',
      });

      // Cursor inside the link
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 3)));

      // Pass anchorElement so floating-ui uses a real element (jsdom-compatible)
      const anchor = document.createElement('button');
      host.appendChild(anchor);
      (editor as any).emit('linkEdit', { anchorElement: anchor });

      const input = document.querySelector<HTMLInputElement>('.dm-link-popover-input')!;
      expect(input.value).toBe('https://example.com');
    });

    it('shows empty input when no existing link', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<p>Hello</p>',
      });

      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 3)));

      // Pass anchorElement so floating-ui uses a real element (jsdom-compatible)
      const anchor = document.createElement('button');
      host.appendChild(anchor);
      (editor as any).emit('linkEdit', { anchorElement: anchor });

      const input = document.querySelector<HTMLInputElement>('.dm-link-popover-input')!;
      expect(input.value).toBe('');
    });

    it('shows remove button when link exists', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<p><a href="https://example.com">link</a></p>',
      });

      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 3)));

      // Pass anchorElement so floating-ui uses a real element (jsdom-compatible)
      const anchor = document.createElement('button');
      host.appendChild(anchor);
      (editor as any).emit('linkEdit', { anchorElement: anchor });

      const removeBtn = document.querySelector<HTMLButtonElement>('.dm-link-popover-remove')!;
      expect(removeBtn.style.display).not.toBe('none');
    });

    it('hides remove button when no link', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<p>Hello</p>',
      });

      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 3)));

      // Pass anchorElement so floating-ui uses a real element (jsdom-compatible)
      const anchor = document.createElement('button');
      host.appendChild(anchor);
      (editor as any).emit('linkEdit', { anchorElement: anchor });

      const removeBtn = document.querySelector<HTMLButtonElement>('.dm-link-popover-remove')!;
      expect(removeBtn.style.display).toBe('none');
    });

    it('detects link in range selection', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<p>Hello <a href="https://example.com">world</a></p>',
      });

      // Selection covers the link
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 12)));

      // Pass anchorElement so floating-ui uses a real element (jsdom-compatible)
      const anchor = document.createElement('button');
      host.appendChild(anchor);
      (editor as any).emit('linkEdit', { anchorElement: anchor });

      const input = document.querySelector<HTMLInputElement>('.dm-link-popover-input')!;
      expect(input.value).toBe('https://example.com');
    });
  });

  describe('apply button', () => {
    it('applies a new link with valid URL', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<p>Hello world</p>',
      });

      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 6)));
      // Pass anchorElement so floating-ui uses a real element (jsdom-compatible)
      const anchor = document.createElement('button');
      host.appendChild(anchor);
      (editor as any).emit('linkEdit', { anchorElement: anchor });

      const input = document.querySelector<HTMLInputElement>('.dm-link-popover-input')!;
      const applyBtn = document.querySelector<HTMLButtonElement>('.dm-link-popover-apply')!;
      input.value = 'https://example.com/new';
      applyBtn.click();

      expect(editor.getHTML()).toContain('https://example.com/new');
    });

    it('does not apply invalid URL', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<p>Hello world</p>',
      });

      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 6)));
      // Pass anchorElement so floating-ui uses a real element (jsdom-compatible)
      const anchor = document.createElement('button');
      host.appendChild(anchor);
      (editor as any).emit('linkEdit', { anchorElement: anchor });

      const input = document.querySelector<HTMLInputElement>('.dm-link-popover-input')!;
      const applyBtn = document.querySelector<HTMLButtonElement>('.dm-link-popover-apply')!;
      input.value = 'javascript:alert(1)';
      applyBtn.click();

      expect(editor.getHTML()).not.toContain('javascript:');
    });
  });

  describe('remove button', () => {
    it('removes existing link', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<p><a href="https://example.com">link</a></p>',
      });

      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 3)));
      // Pass anchorElement so floating-ui uses a real element (jsdom-compatible)
      const anchor = document.createElement('button');
      host.appendChild(anchor);
      (editor as any).emit('linkEdit', { anchorElement: anchor });

      const removeBtn = document.querySelector<HTMLButtonElement>('.dm-link-popover-remove')!;
      removeBtn.click();

      expect(editor.getHTML()).not.toContain('href');
    });
  });

  describe('keyboard navigation', () => {
    it('Escape hides popover', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<p>Hello</p>',
      });

      // Pass anchorElement so floating-ui uses a real element (jsdom-compatible)
      const anchor = document.createElement('button');
      host.appendChild(anchor);
      (editor as any).emit('linkEdit', { anchorElement: anchor });
      const popover = document.querySelector('.dm-link-popover')!;
      const input = document.querySelector<HTMLInputElement>('.dm-link-popover-input')!;

      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      input.dispatchEvent(event);

      expect(popover.hasAttribute('data-show')).toBe(false);
    });

    it('Enter applies URL', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<p>Hello world</p>',
      });

      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 6)));
      // Pass anchorElement so floating-ui uses a real element (jsdom-compatible)
      const anchor = document.createElement('button');
      host.appendChild(anchor);
      (editor as any).emit('linkEdit', { anchorElement: anchor });

      const input = document.querySelector<HTMLInputElement>('.dm-link-popover-input')!;
      input.value = 'https://example.com';

      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      input.dispatchEvent(event);

      expect(editor.getHTML()).toContain('https://example.com');
    });

    it('Tab in input moves focus', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<p>Hello</p>',
      });

      // Pass anchorElement so floating-ui uses a real element (jsdom-compatible)
      const anchor = document.createElement('button');
      host.appendChild(anchor);
      (editor as any).emit('linkEdit', { anchorElement: anchor });
      const input = document.querySelector<HTMLInputElement>('.dm-link-popover-input')!;

      const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      input.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
    });
  });

  describe('click outside', () => {
    it('clicking outside hides popover', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<p>Hello</p>',
      });

      // Pass anchorElement so floating-ui uses a real element (jsdom-compatible)
      const anchor = document.createElement('button');
      host.appendChild(anchor);
      (editor as any).emit('linkEdit', { anchorElement: anchor });
      const popover = document.querySelector('.dm-link-popover')!;

      const outside = document.createElement('div');
      document.body.appendChild(outside);
      const event = new MouseEvent('mousedown', { bubbles: true });
      outside.dispatchEvent(event);

      expect(popover.hasAttribute('data-show')).toBe(false);
      outside.remove();
    });

    it('clicking inside popover does not hide it', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<p>Hello</p>',
      });

      // Pass anchorElement so floating-ui uses a real element (jsdom-compatible)
      const anchor = document.createElement('button');
      host.appendChild(anchor);
      (editor as any).emit('linkEdit', { anchorElement: anchor });
      const popover = document.querySelector('.dm-link-popover')!;
      const input = popover.querySelector('input')!;

      const event = new MouseEvent('mousedown', { bubbles: true });
      input.dispatchEvent(event);

      expect(popover.hasAttribute('data-show')).toBe(true);
    });
  });

  describe('additional coverage', () => {
    it('applyLink with empty input hides popover', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<p>Hello</p>',
      });
      const anchor = document.createElement('button');
      host.appendChild(anchor);
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 6)));
      (editor as any).emit('linkEdit', { anchorElement: anchor });
      const popover = document.querySelector('.dm-link-popover')!;
      const input = popover.querySelector('input')!;
      const applyBtn = popover.querySelector<HTMLButtonElement>('.dm-link-popover-apply')!;
      input.value = '';
      applyBtn.click();
      expect(popover.hasAttribute('data-show')).toBe(false);
    });

    it('applyLink with invalid URL after protocol check hides popover', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<p>Hello</p>',
      });
      const anchor = document.createElement('button');
      host.appendChild(anchor);
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 6)));
      (editor as any).emit('linkEdit', { anchorElement: anchor });
      const popover = document.querySelector('.dm-link-popover')!;
      const input = popover.querySelector('input')!;
      const applyBtn = popover.querySelector<HTMLButtonElement>('.dm-link-popover-apply')!;
      input.value = 'javascript:alert(1)';
      applyBtn.click();
      expect(popover.hasAttribute('data-show')).toBe(false);
    });

    it('applyLink on existing link with empty selection updates range', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<p><a href="https://old.com">linked</a></p>',
      });
      const anchor = document.createElement('button');
      host.appendChild(anchor);
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 3)));
      (editor as any).emit('linkEdit', { anchorElement: anchor });
      const popover = document.querySelector('.dm-link-popover')!;
      const input = popover.querySelector('input')!;
      const applyBtn = popover.querySelector<HTMLButtonElement>('.dm-link-popover-apply')!;
      input.value = 'https://new.com';
      applyBtn.click();
      expect(editor.getHTML()).toContain('https://new.com');
    });

    it('Enter key on input triggers applyLink', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<p>Hello</p>',
      });
      const anchor = document.createElement('button');
      host.appendChild(anchor);
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 6)));
      (editor as any).emit('linkEdit', { anchorElement: anchor });
      const popover = document.querySelector('.dm-link-popover')!;
      const input = popover.querySelector('input')!;
      input.value = 'https://example.com';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(editor.getHTML()).toContain('https://example.com');
    });

    it('Escape on input closes popover', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<p>Hello</p>',
      });
      const anchor = document.createElement('button');
      host.appendChild(anchor);
      (editor as any).emit('linkEdit', { anchorElement: anchor });
      const popover = document.querySelector('.dm-link-popover')!;
      const input = popover.querySelector('input')!;
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(popover.hasAttribute('data-show')).toBe(false);
    });

    it('Tab on input focuses apply button', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<p>Hello</p>',
      });
      const anchor = document.createElement('button');
      host.appendChild(anchor);
      (editor as any).emit('linkEdit', { anchorElement: anchor });
      const popover = document.querySelector('.dm-link-popover')!;
      const input = popover.querySelector('input')!;
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      expect(popover).toBeTruthy();
    });

    it('Shift+Tab on input focuses apply button (no existing link)', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<p>Hello</p>',
      });
      const anchor = document.createElement('button');
      host.appendChild(anchor);
      (editor as any).emit('linkEdit', { anchorElement: anchor });
      const popover = document.querySelector('.dm-link-popover')!;
      const input = popover.querySelector('input')!;
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
      expect(popover).toBeTruthy();
    });

    it('Shift+Tab on input focuses remove button when existing link', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<p><a href="https://old.com">linked</a></p>',
      });
      const anchor = document.createElement('button');
      host.appendChild(anchor);
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 3)));
      (editor as any).emit('linkEdit', { anchorElement: anchor });
      const popover = document.querySelector('.dm-link-popover')!;
      const input = popover.querySelector('input')!;
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
      expect(popover).toBeTruthy();
    });

    it('Escape on button closes popover', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<p>Hello</p>',
      });
      const anchor = document.createElement('button');
      host.appendChild(anchor);
      (editor as any).emit('linkEdit', { anchorElement: anchor });
      const popover = document.querySelector('.dm-link-popover')!;
      const applyBtn = popover.querySelector<HTMLButtonElement>('.dm-link-popover-apply')!;
      applyBtn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(popover.hasAttribute('data-show')).toBe(false);
    });

    it('Tab on apply button with existing link focuses remove button', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<p><a href="https://old.com">linked</a></p>',
      });
      const anchor = document.createElement('button');
      host.appendChild(anchor);
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 3)));
      (editor as any).emit('linkEdit', { anchorElement: anchor });
      const popover = document.querySelector('.dm-link-popover')!;
      const applyBtn = popover.querySelector<HTMLButtonElement>('.dm-link-popover-apply')!;
      applyBtn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      expect(popover).toBeTruthy();
    });

    it('Tab on apply button without existing link focuses input', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<p>Hello</p>',
      });
      const anchor = document.createElement('button');
      host.appendChild(anchor);
      (editor as any).emit('linkEdit', { anchorElement: anchor });
      const popover = document.querySelector('.dm-link-popover')!;
      const applyBtn = popover.querySelector<HTMLButtonElement>('.dm-link-popover-apply')!;
      applyBtn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      expect(popover).toBeTruthy();
    });

    it('Shift+Tab on apply button focuses input', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<p>Hello</p>',
      });
      const anchor = document.createElement('button');
      host.appendChild(anchor);
      (editor as any).emit('linkEdit', { anchorElement: anchor });
      const popover = document.querySelector('.dm-link-popover')!;
      const applyBtn = popover.querySelector<HTMLButtonElement>('.dm-link-popover-apply')!;
      applyBtn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
      expect(popover).toBeTruthy();
    });

    it('Shift+Tab on remove button focuses apply button', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<p><a href="https://old.com">linked</a></p>',
      });
      const anchor = document.createElement('button');
      host.appendChild(anchor);
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 3)));
      (editor as any).emit('linkEdit', { anchorElement: anchor });
      const popover = document.querySelector('.dm-link-popover')!;
      const removeBtn = popover.querySelector<HTMLButtonElement>('.dm-link-popover-remove')!;
      removeBtn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
      expect(popover).toBeTruthy();
    });

    it('Enter on apply button triggers click', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<p>Hello</p>',
      });
      const anchor = document.createElement('button');
      host.appendChild(anchor);
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 6)));
      (editor as any).emit('linkEdit', { anchorElement: anchor });
      const popover = document.querySelector('.dm-link-popover')!;
      const input = popover.querySelector('input')!;
      const applyBtn = popover.querySelector<HTMLButtonElement>('.dm-link-popover-apply')!;
      input.value = 'https://example.com';
      applyBtn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(editor.getHTML()).toContain('https://example.com');
    });

    it('linkEdit while open hides popover (toggle)', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<p>Hello</p>',
      });
      const anchor = document.createElement('button');
      host.appendChild(anchor);
      (editor as any).emit('linkEdit', { anchorElement: anchor });
      const popover = document.querySelector('.dm-link-popover')!;
      expect(popover.hasAttribute('data-show')).toBe(true);
      (editor as any).emit('linkEdit', { anchorElement: anchor });
      expect(popover.hasAttribute('data-show')).toBe(false);
    });

    it('applyLink auto-prepends https:// when no protocol', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<p>Hello</p>',
      });
      const anchor = document.createElement('button');
      host.appendChild(anchor);
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 6)));
      (editor as any).emit('linkEdit', { anchorElement: anchor });
      const popover = document.querySelector('.dm-link-popover')!;
      const input = popover.querySelector('input')!;
      const applyBtn = popover.querySelector<HTMLButtonElement>('.dm-link-popover-apply')!;
      input.value = 'example.com';
      applyBtn.click();
      expect(editor.getHTML()).toContain('https://example.com');
    });
  });
});
