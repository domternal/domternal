import { afterEach, describe, expect, it, vi } from 'vitest';
import { Document, Editor, History, Paragraph, Text } from '@domternal/core';
import { undoDepth } from '@domternal/pm/history';
import { PasteCleanup } from './PasteCleanup.js';
import type { PasteCleanupOptions } from './PasteCleanup.js';
import type { PasteOperationResult } from './operations.js';

const editors: Editor[] = [];
const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const editor of editors) if (!editor.isDestroyed) editor.destroy();
  for (const host of hosts) host.remove();
  editors.length = 0; hosts.length = 0;
});

describe('destination refusal independent of clipboard image policy', () => {
  it.each(['native', 'programmatic'] as const)('keeps the table refusal when Image is absent and diagnostics are full: %s', async route => {
    const normalized = vi.fn<NonNullable<PasteCleanupOptions['onResult']>>();
    const completed = vi.fn<(result: PasteOperationResult) => void>();
    const progress = vi.fn();
    const match = vi.fn(() => []);
    const transaction = vi.fn();
    const host = document.createElement('div'); document.body.append(host); hosts.push(host);
    const editor = new Editor({
      element: host, content: '<p>Original selection</p>', onTransaction: transaction,
      extensions: [Document, Paragraph, Text, History, PasteCleanup.configure({
        imageAssets: { mode: 'embedded', match }, limits: { maxDiagnostics: 1 },
        onResult: normalized, onPasteResult: completed, onPasteProgress: progress,
      })],
    });
    editors.push(editor);
    editor.commands.selectAll();
    const original = editor.getJSON();
    const selection = editor.state.selection.toJSON();
    transaction.mockClear();
    const html = '<span onclick="PRIVATE_SOURCE">Before</span><table><tr><td>Cell</td></tr></table>';
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: {
      items: [], files: [], getData: (type: string): string => type === 'text/html' ? html : '',
    } });
    if (route === 'native') editor.view.dom.dispatchEvent(event);
    else editor.view.pasteHTML(html, event as ClipboardEvent);
    await Promise.resolve(); await Promise.resolve();

    expect(normalized).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      status: 'rejected', html: '', diagnostics: [{ code: 'unsafe-content-removed', severity: 'warning', offset: 0 }],
      diagnosticsTruncated: true,
    }));
    expect(completed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      status: 'rejected', reason: 'unsupported-content', diagnosticsTruncated: true,
    }));
    expect(completed.mock.calls[0]?.[0].operationId).toBe(normalized.mock.calls[0]?.[0].operationId);
    expect(editor.getJSON()).toEqual(original);
    expect(editor.state.selection.toJSON()).toEqual(selection);
    expect(undoDepth(editor.state)).toBe(0);
    expect(transaction).not.toHaveBeenCalled();
    expect(match).not.toHaveBeenCalled(); expect(progress).not.toHaveBeenCalled();
    const notice = host.querySelector('.dm-paste-feedback');
    expect(notice?.textContent).toContain('Use an editor with table support, or paste as plain text.');
    expect(notice?.textContent).not.toContain('image insertion');
    expect(notice?.textContent).not.toContain('PRIVATE_SOURCE');
  });
});
