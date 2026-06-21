import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { refocusEditorAfterCommand } from './refocusEditorAfterCommand.js';

describe('refocusEditorAfterCommand', () => {
  let focusCount: number;
  let viewDom: HTMLElement;
  let view: { dom: Element; focus: () => void };

  beforeEach(() => {
    document.body.innerHTML = '';
    // Run the scheduled frame synchronously so assertions are deterministic.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback): number => {
      cb(0);
      return 0;
    });
    focusCount = 0;
    viewDom = document.createElement('div');
    viewDom.setAttribute('contenteditable', 'true');
    viewDom.tabIndex = -1;
    document.body.appendChild(viewDom);
    view = {
      dom: viewDom,
      focus: () => {
        focusCount += 1;
      },
    };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  function focusInside(html: string, selector: string): void {
    const host = document.createElement('div');
    host.innerHTML = html;
    document.body.appendChild(host);
    host.querySelector<HTMLElement>(selector)!.focus();
  }

  it('does NOT refocus when focus is in a popover surface (math popover)', () => {
    focusInside('<div class="dm-math-popover" data-dm-editor-ui><textarea></textarea></div>', 'textarea');
    refocusEditorAfterCommand(view);
    expect(focusCount).toBe(0);
  });

  it('refocuses when a toolbar button is focused (keyboard activation)', () => {
    focusInside('<div class="dm-toolbar" data-dm-editor-ui><button>B</button></div>', 'button');
    refocusEditorAfterCommand(view);
    expect(focusCount).toBe(1);
  });

  it('refocuses when focus is in the bubble menu', () => {
    focusInside('<div class="dm-bubble-menu" data-dm-editor-ui><button>B</button></div>', 'button');
    refocusEditorAfterCommand(view);
    expect(focusCount).toBe(1);
  });

  it('refocuses when focus is in the floating menu', () => {
    focusInside('<div class="dm-floating-menu" data-dm-editor-ui><button>B</button></div>', 'button');
    refocusEditorAfterCommand(view);
    expect(focusCount).toBe(1);
  });

  it('refocuses when focus is already inside the editor', () => {
    viewDom.focus();
    refocusEditorAfterCommand(view);
    expect(focusCount).toBe(1);
  });

  it('refocuses when focus is on the body / nowhere relevant', () => {
    // beforeEach clears the DOM, so nothing is focused (activeElement is body).
    refocusEditorAfterCommand(view);
    expect(focusCount).toBe(1);
  });

  it('refocuses when there is no active element', () => {
    const spy = vi.spyOn(document, 'activeElement', 'get').mockReturnValue(null);
    refocusEditorAfterCommand(view);
    expect(focusCount).toBe(1);
    spy.mockRestore();
  });
});
