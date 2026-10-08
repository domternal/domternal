/**
 * Word's hidden text in an editor paste: the hidden run is not in the document, and the default notice names it in
 * both policies, as the normalizer's own tests pin it for the standalone entry.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Document, Editor, Paragraph, Text } from '@domternal/core';
import { PasteCleanup } from './index.js';
import type { PasteOperationResult } from './index.js';

const hosts: HTMLElement[] = [];
const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors) editor.destroy();
  for (const host of hosts) host.remove();
  editors.length = 0; hosts.length = 0;
});

// English text variant of the recorded Word hidden-run shape, not a new native capture.
const HTML = '<html xmlns:o="urn:schemas-microsoft-com:office:office"><body><!--StartFragment-->'
  + "<p class=MsoNormal>B15 Visible part <span style='display:none;mso-hide:all'>HIDDEN</span>\nend.<o:p></o:p></p><!--EndFragment--></body></html>";

function paste(editor: Editor, html: string): void {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  const clipboard: Record<string, string> = { 'text/html': html, 'text/plain': 'B15 Visible part  end.' };
  Object.defineProperty(event, 'clipboardData', { value: { items: [], files: [], getData: (type: string) => clipboard[type] ?? '' } });
  editor.view.dom.dispatchEvent(event);
}

describe('PasteCleanup and hidden Word text', () => {
  for (const formatting of ['preserve', 'adapt'] as const) {
    it(`leaves Word's hidden run out of the document and names it in the notice, with ${formatting}`, async () => {
      const host = document.body.appendChild(document.createElement('div')); hosts.push(host);
      const completed = vi.fn<(result: PasteOperationResult) => void>();
      const editor = new Editor({ element: host, content: '<p></p>', extensions: [Document, Paragraph, Text, PasteCleanup.configure({ formatting, onPasteResult: completed })] });
      editors.push(editor);
      paste(editor, HTML);
      await new Promise(resolve => { setTimeout(resolve, 0); });
      expect(editor.getText()).toBe('B15 Visible part end.');
      expect(completed).toHaveBeenCalledTimes(1);
      expect(completed.mock.calls[0]?.[0].diagnostics.map(entry => entry.code)).toEqual(['hidden-text-removed']);
      const notice = host.querySelector<HTMLElement>('.dm-paste-feedback');
      expect(notice?.hidden).toBe(false);
      expect(Array.from(notice?.querySelectorAll('li') ?? [], node => node.textContent)).toEqual(['Hidden text from Word was not pasted.']);
    });
  }
});
