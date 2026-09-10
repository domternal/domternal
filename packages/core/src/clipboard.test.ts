import { describe, expect, it } from 'vitest';
import * as clipboard from './clipboard.js';
import * as main from './index.js';
import * as bundle from './index.bundle.js';
import { getClipboardPasteBehavior, setClipboardPasteBehavior } from './helpers/clipboardPasteBehavior.js';
import { armClipboardPasteTransaction } from './helpers/clipboardPasteTransaction.js';
import { getClipboardImageDestination, registerClipboardImageDestination } from './helpers/clipboardImageDestination.js';
import { registerClipboardCopyAnnotation } from './helpers/clipboardCopyAnnotation.js';
import { getClipboardPasteAttemptEvent, registerClipboardHTMLPreparation } from './helpers/clipboardHTMLPreparation.js';
import { pasteClipboardImageFiles, pasteHasOwnText } from './helpers/clipboardImageFiles.js';

const functions = {
  armClipboardPasteTransaction,
  getClipboardImageDestination,
  getClipboardPasteAttemptEvent,
  getClipboardPasteBehavior,
  pasteClipboardImageFiles,
  pasteHasOwnText,
  registerClipboardCopyAnnotation,
  registerClipboardHTMLPreparation,
  registerClipboardImageDestination,
  setClipboardPasteBehavior,
};

describe('@domternal/core/clipboard source entry', () => {
  it('exposes exactly the clipboard coordination functions', () => {
    expect(Object.keys(clipboard).sort()).toEqual(Object.keys(functions).sort());
  });

  it("re-exports each helper module's own function, so source consumers share one registry", () => {
    for (const [name, value] of Object.entries(functions)) {
      expect(Reflect.get(clipboard, name), name).toBe(value);
    }
  });

  it('keeps the main entry free of clipboard coordination while writeToClipboard stays there', () => {
    for (const name of Object.keys(functions)) expect(name in main, name).toBe(false);
    expect(main.writeToClipboard).toBeTypeOf('function');
    expect('writeToClipboard' in clipboard).toBe(false);
  });

  it('builds the main runtime bundle from the main entry plus the clipboard entry and nothing else', () => {
    // dist/clipboard.* re-export these bindings from dist/index.*, so the bundle
    // must carry them even though dist/index.d.ts does not declare them.
    expect(Object.keys(bundle).sort()).toEqual([...Object.keys(main), ...Object.keys(clipboard)].sort());
    for (const [name, value] of Object.entries(functions)) expect(Reflect.get(bundle, name), name).toBe(value);
  });
});
