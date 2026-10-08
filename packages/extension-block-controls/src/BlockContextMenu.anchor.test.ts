import { afterEach, describe, expect, it, vi } from 'vitest';
import { Document, Editor, Paragraph, Text, positionFloatingOnce } from '@domternal/core';
import type * as CoreExports from '@domternal/core';
import { BlockContextMenu } from './BlockContextMenu.js';

vi.mock('@domternal/core', async importOriginal => ({
  ...await importOriginal<typeof CoreExports>(),
  positionFloatingOnce: vi.fn(() => () => undefined),
}));

let editor: Editor | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  editor?.destroy();
  host?.remove();
  editor = undefined;
  host = undefined;
  vi.clearAllMocks();
});

function button(label: string | null, x: number, className = ''): HTMLButtonElement {
  const element = document.createElement('button');
  if (label !== null) element.setAttribute('aria-label', label);
  element.className = className;
  element.getBoundingClientRect = () => new DOMRect(x, 10, 20, 20);
  return element;
}

function open(anchor: HTMLButtonElement): { bubble: HTMLDivElement; reference: Parameters<typeof positionFloatingOnce>[0] } {
  host = document.body.appendChild(document.createElement('div'));
  host.className = 'dm-editor';
  editor = new Editor({ element: host, extensions: [Document, Paragraph, Text, BlockContextMenu], content: '<p>Hello</p>' });
  const bubble = host.appendChild(document.createElement('div'));
  bubble.className = 'dm-bubble-menu';
  bubble.appendChild(anchor);
  host.dispatchEvent(new CustomEvent('dm:block-context-menu-open', { detail: { blockPos: 0, anchorElement: anchor } }));
  const reference = vi.mocked(positionFloatingOnce).mock.calls.at(-1)?.[0];
  if (!reference) throw new Error('The context menu did not request positioning');
  return { bubble, reference };
}

describe('BlockContextMenu replacement anchor', () => {
  it.each([
    'Block "options"',
    String.raw`Path\Block\Options`,
    String.raw`Path\"Options`,
    'First\nSecond\rThird\fEnd',
    String.raw`Options\"], button[aria-label="Decoy`,
  ])('matches the complete label literally: %j', label => {
    const { bubble, reference } = open(button(label, 10));
    const replacement = button(label, 70);
    bubble.replaceChildren(button('Decoy', 30), button(`${label} suffix`, 40), replacement);
    expect(reference.getBoundingClientRect().x).toBe(70);
    replacement.getBoundingClientRect = () => new DOMRect(90, 10, 20, 20);
    expect(reference.getBoundingClientRect().x).toBe(90);
  });

  it.each(['dm-bcm-trigger', 'dm-block-handle-drag'])('prefers the stable %s class when its label changes', className => {
    const { bubble, reference } = open(button('Old label', 10, className));
    bubble.replaceChildren(button('Old label', 30), button('New label', 70, className));
    expect(reference.getBoundingClientRect().x).toBe(70);
  });

  it('retains the last rectangle when the only matching button is outside the original bubble menu', () => {
    const { bubble, reference } = open(button('Options', 10));
    host?.appendChild(button('Options', 70));
    bubble.replaceChildren(button('Other', 30));
    expect(reference.getBoundingClientRect().x).toBe(10);
  });

  it('retains the last rectangle for an anchor without an identifying class or label', () => {
    const { bubble, reference } = open(button(null, 10));
    bubble.replaceChildren(button(null, 70));
    expect(reference.getBoundingClientRect().x).toBe(10);
  });
});
