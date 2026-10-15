import { afterEach, describe, expect, it, vi } from 'vitest';
import { TextSelection } from '@domternal/pm/state';
import { Document, Editor, Paragraph, Text } from '../index.js';
import { BubbleMenu } from './BubbleMenu.js';

const positioning = vi.hoisted(() => ({ calls: [] as {
  reference: { getBoundingClientRect(): DOMRect }; dispose: ReturnType<typeof vi.fn>;
}[] }));
vi.mock('../utils/positionFloating.js', () => ({
  positionFloatingOnce(reference: { getBoundingClientRect(): DOMRect }) {
    const dispose = vi.fn();
    positioning.calls.push({ reference, dispose });
    return dispose;
  },
}));
const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) if (!editor.isDestroyed) editor.destroy();
  positioning.calls.length = 0;
});
function mount(): { editor: Editor; coordinates: ReturnType<typeof vi.fn> } {
  const editor = new Editor({ content: '<p>Long selected content</p>', extensions: [Document, Paragraph, Text,
    BubbleMenu.configure({ element: document.createElement('div') }),
  ] });
  editors.push(editor);
  const coordinates = vi.fn((pos: number) => {
    editor.state.doc.resolve(pos);
    return { left: pos, right: pos + 1, top: 2, bottom: 12 };
  });
  editor.view.coordsAtPos = coordinates;
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 14)));
  return { editor, coordinates };
}

describe('BubbleMenu asynchronous reference lifetime', () => {
  it('measures the current selected range normally', () => {
    const { coordinates } = mount();
    const reference = positioning.calls.at(-1)!.reference;
    expect(reference.getBoundingClientRect()).toEqual(new DOMRect(1, 2, 14, 10));
    expect(coordinates.mock.calls.map(([pos]) => pos)).toEqual([1, 14]);
  });

  it.each(['shorter-document', 'same-document-selection', 'destroy'] as const)(
    'does not resolve stale positions after %s', change => {
      const { editor, coordinates } = mount();
      const old = positioning.calls.at(-1)!;
      if (change === 'shorter-document') editor.setContent('<p>x</p>', false);
      else if (change === 'same-document-selection') editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2, 4)));
      else editor.destroy();
      coordinates.mockClear();
      expect(old.dispose).toHaveBeenCalledOnce();
      expect(() => old.reference.getBoundingClientRect()).not.toThrow();
      expect(old.reference.getBoundingClientRect()).toEqual(new DOMRect());
      expect(coordinates).not.toHaveBeenCalled();
      if (change === 'same-document-selection') {
        expect(positioning.calls.at(-1)!.reference.getBoundingClientRect()).toEqual(new DOMRect(2, 2, 3, 10));
        expect(coordinates.mock.calls.map(([pos]) => pos)).toEqual([2, 4]);
      }
    },
  );
});
