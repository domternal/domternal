import { afterEach, describe, expect, it, vi } from 'vitest';
import { annotateOwnCopy, isOwnCopyNonce, OWN_COPY_ATTRIBUTE } from './ownCopy.js';

afterEach(() => { vi.unstubAllGlobals(); });

function fragment(html: string): DocumentFragment {
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content;
}

function annotate(html = '<p>Copy</p><p>Second</p>'): { fragment: DocumentFragment; nonce: string | undefined } {
  const copy = fragment(html);
  annotateOwnCopy(copy);
  const value = copy.firstElementChild?.getAttribute(OWN_COPY_ATTRIBUTE) ?? undefined;
  return { fragment: copy, nonce: value?.slice(3) };
}

describe('own-copy registry', () => {
  it('marks only the first copied element with a fresh versioned base64url nonce', () => {
    const first = annotate();
    const second = annotate();
    expect(first.fragment.firstElementChild?.getAttribute(OWN_COPY_ATTRIBUTE)).toMatch(/^v1\.[A-Za-z0-9_-]{22}$/);
    expect(first.fragment.querySelectorAll(`[${OWN_COPY_ATTRIBUTE}]`)).toHaveLength(1);
    expect(first.nonce).not.toBe(second.nonce);
    expect(isOwnCopyNonce(first.nonce ?? '')).toBe(true);
    expect(isOwnCopyNonce(second.nonce ?? '')).toBe(true);
  });

  it('does not mark a copy that starts with text', () => {
    const copy = fragment('Inline <strong>text</strong>');
    annotateOwnCopy(copy);
    expect(copy.querySelector(`[${OWN_COPY_ATTRIBUTE}]`)).toBeNull();
  });

  it('remembers only the most recent copies', () => {
    const oldest = annotate().nonce ?? '';
    for (let index = 0; index < 31; index++) annotate();
    expect(isOwnCopyNonce(oldest)).toBe(true);
    const newest = annotate().nonce ?? '';
    expect(isOwnCopyNonce(oldest)).toBe(false);
    expect(isOwnCopyNonce(newest)).toBe(true);
  });

  it('leaves copies unmarked without a secure random source', () => {
    vi.stubGlobal('crypto', undefined);
    expect(annotate().nonce).toBeUndefined();
  });

  it('never accepts values that were not issued', () => {
    expect(isOwnCopyNonce('AAAAAAAAAAAAAAAAAAAAAA')).toBe(false);
    expect(isOwnCopyNonce('')).toBe(false);
  });
});
